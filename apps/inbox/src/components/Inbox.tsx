'use client';

import { ReconnectingSocket } from 'hailbox/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationDetailResponse,
  ConversationListResponse,
  InboxConversation,
  InboxServerFrame,
  OperatorInfo,
  WireMessage,
} from '@/lib/inbox-protocol';
import { inboxApi } from '@/lib/inbox-api';
import { AccountBar } from './AccountBar';
import { ConversationList } from './ConversationList';
import { Thread } from './Thread';
import { VisitorDetails } from './VisitorDetails';

type Status = 'open' | 'closed';
const PAGE_SIZE = 50;

function socketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function mergeMessages(existing: WireMessage[], incoming: WireMessage[]): WireMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export function Inbox({ operator: initialOperator }: { operator: OperatorInfo }) {
  const [operator, setOperator] = useState(initialOperator);
  const [status, setStatus] = useState<Status>('open');
  const [conversations, setConversations] = useState<Record<string, InboxConversation>>({});
  const [loaded, setLoaded] = useState<Record<Status, boolean>>({ open: false, closed: false });
  const [hasMore, setHasMore] = useState<Record<Status, boolean>>({ open: false, closed: false });
  // "Load older" continues from the last page the server sent, not from whatever happens to be
  // oldest locally (live updates and ?c= links can add conversations from much further back).
  const cursors = useRef<Record<Status, string | undefined>>({ open: undefined, closed: undefined });
  const [threads, setThreads] = useState<Record<string, WireMessage[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = usePageVisible();

  const upsert = useCallback((list: InboxConversation[]) => {
    if (list.length === 0) return;
    setConversations((prev) => {
      const next = { ...prev };
      for (const c of list) next[c.id] = c;
      return next;
    });
  }, []);

  const loadList = useCallback(
    async (which: Status, before?: string) => {
      try {
        const query = new URLSearchParams({ status: which });
        if (before) query.set('before', before);
        const { conversations: list } = await inboxApi<ConversationListResponse>(`/api/inbox/conversations?${query}`);
        upsert(list);
        setLoaded((prev) => ({ ...prev, [which]: true }));
        // A refresh of the first page doesn't move the cursor back once older pages are loaded.
        const oldest = list.at(-1)?.lastMessageAt;
        if (before || !cursors.current[which]) {
          cursors.current[which] = oldest;
          setHasMore((prev) => ({ ...prev, [which]: list.length === PAGE_SIZE }));
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [upsert],
  );

  const loadThread = useCallback(
    async (id: string) => {
      try {
        const detail = await inboxApi<ConversationDetailResponse>(`/api/inbox/conversations/${id}`);
        upsert([detail.conversation]);
        setThreads((prev) => ({ ...prev, [id]: mergeMessages(prev[id] ?? [], detail.messages) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [upsert],
  );

  // The selected conversation lives in the URL (?c=), so Slack's "Open in inbox" links work.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('c');
    if (fromUrl) setSelectedId(fromUrl);
    const onPop = () => setSelectedId(new URLSearchParams(window.location.search).get('c'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('c', id);
    else url.searchParams.delete('c');
    window.history.pushState(null, '', url);
  }, []);

  useEffect(() => {
    void loadList(status);
  }, [status, loadList]);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
  }, [selectedId, loadThread]);

  // Live updates. Every (re)connect re-fetches, so nothing is lost while disconnected.
  const latest = useRef({ status, selectedId });
  useEffect(() => {
    latest.current = { status, selectedId };
  }, [status, selectedId]);

  useEffect(() => {
    const socket = new ReconnectingSocket<InboxServerFrame>({
      url: socketUrl('/api/inbox/ws'),
      onOpen: () => {},
      onFrame: (frame) => {
        switch (frame.type) {
          case 'ready':
            setConnected(true);
            void loadList(latest.current.status);
            if (latest.current.selectedId) void loadThread(latest.current.selectedId);
            break;
          case 'conversation':
            upsert([frame.conversation]);
            break;
          case 'message': {
            const { message } = frame;
            setThreads((prev) => {
              const thread = prev[message.conversationId];
              // Keep messages for the open conversation even if its history is still loading;
              // they merge with it when it arrives.
              if (!thread && message.conversationId !== latest.current.selectedId) return prev;
              return { ...prev, [message.conversationId]: mergeMessages(thread ?? [], [message]) };
            });
            break;
          }
        }
      },
      onDisconnect: () => {
        setConnected(false);
        // If the session ended, this redirects to sign-in instead of reconnecting forever.
        inboxApi('/api/inbox/me').catch(() => {});
      },
      onUnauthorized: () => window.location.assign('/login'),
    });
    socket.start();
    return () => socket.stop();
  }, [loadList, loadThread, upsert]);

  const selected = selectedId ? (conversations[selectedId] ?? null) : null;
  const thread = selectedId ? threads[selectedId] : undefined;
  const lastMessageId = thread?.at(-1)?.id;

  // Reading a conversation marks it read for every operator. Each mark is posted once: if the
  // server still counts something unread (say, a message we haven't received yet), re-posting
  // the same id wouldn't help, and would loop.
  const postedReadMarks = useRef(new Map<string, number>());
  useEffect(() => {
    if (!selected || !lastMessageId || selected.unreadCount === 0 || !visible) return;
    if ((postedReadMarks.current.get(selected.id) ?? 0) >= lastMessageId) return;
    postedReadMarks.current.set(selected.id, lastMessageId);
    upsert([{ ...selected, unreadCount: 0 }]);
    inboxApi(`/api/inbox/conversations/${selected.id}/read`, {
      method: 'POST',
      json: { lastMessageId },
    }).catch(() => {});
  }, [selected, lastMessageId, visible, upsert]);

  const list = useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => c.status === status)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    [conversations, status],
  );

  const unreadTotal = useMemo(
    () => Object.values(conversations).reduce((sum, c) => sum + (c.status === 'open' ? c.unreadCount : 0), 0),
    [conversations],
  );
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Inbox · Hailbox` : 'Inbox · Hailbox';
  }, [unreadTotal]);

  const send = useCallback(async (conversationId: string, body: string) => {
    const { message } = await inboxApi<{ message: WireMessage }>(
      `/api/inbox/conversations/${conversationId}/messages`,
      { method: 'POST', json: { body } },
    );
    setThreads((prev) => ({ ...prev, [conversationId]: mergeMessages(prev[conversationId] ?? [], [message]) }));
  }, []);

  const setConversationStatus = useCallback(
    async (conversationId: string, next: Status) => {
      const { conversation } = await inboxApi<{ conversation: InboxConversation }>(
        `/api/inbox/conversations/${conversationId}`,
        { method: 'PATCH', json: { status: next } },
      );
      upsert([conversation]);
    },
    [upsert],
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={`${selected ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-line bg-surface md:w-80 lg:w-96`}
      >
        <ConversationList
          conversations={list}
          status={status}
          onStatusChange={setStatus}
          selectedId={selectedId}
          onSelect={select}
          loaded={loaded[status]}
          hasMore={hasMore[status]}
          onLoadMore={() => void loadList(status, cursors.current[status])}
          connected={connected}
          unreadTotal={unreadTotal}
        />
        <AccountBar operator={operator} onOperatorChange={setOperator} />
      </aside>

      <main className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1`}>
        {error && (
          <div className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-lg">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {selected ? (
          <>
            <Thread
              key={selected.id}
              conversation={selected}
              messages={thread}
              operator={operator}
              onSend={(body) => send(selected.id, body)}
              onStatusChange={(next) => setConversationStatus(selected.id, next)}
              onBack={() => select(null)}
            />
            <VisitorDetails conversation={selected} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
            {selectedId && !selected ? 'Loading conversation…' : 'Select a conversation to read it.'}
          </div>
        )}
      </main>
    </div>
  );
}
