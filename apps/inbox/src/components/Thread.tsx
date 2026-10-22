import { MAX_MESSAGE_LENGTH } from 'hailbox/protocol';
import { useEffect, useLayoutEffect, useRef, useState, type SubmitEvent, type KeyboardEvent } from 'react';
import { messageTime } from '@/lib/format';
import { visitorLabel, type InboxConversation, type OperatorInfo, type WireMessage } from '@/lib/inbox-protocol';
import { Avatar, Button, Linkified } from './ui';

interface Group {
  key: string;
  author: WireMessage['author'];
  authorName: string | null;
  messages: WireMessage[];
}

function group(messages: WireMessage[]): Group[] {
  const groups: Group[] = [];
  for (const message of messages) {
    const current = groups.at(-1);
    const previous = current?.messages.at(-1);
    if (
      current &&
      previous &&
      current.author === message.author &&
      current.authorName === message.authorName &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000
    ) {
      current.messages.push(message);
    } else {
      groups.push({ key: `g${message.id}`, author: message.author, authorName: message.authorName, messages: [message] });
    }
  }
  return groups;
}

export function Thread({
  conversation,
  messages,
  operator,
  onSend,
  onStatusChange,
  onBack,
}: {
  conversation: InboxConversation;
  messages: WireMessage[] | undefined;
  operator: OperatorInfo;
  onSend: (body: string) => Promise<void>;
  onStatusChange: (status: 'open' | 'closed') => Promise<void>;
  onBack: () => void;
}) {
  const { visitor } = conversation;
  const label = visitorLabel(visitor);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [statusBusy, setStatusBusy] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  const lastOperatorMessage = messages?.findLast((m) => m.author === 'operator');
  const seen =
    lastOperatorMessage && (conversation.visitorLastReadMessageId ?? 0) >= lastOperatorMessage.id
      ? lastOperatorMessage.id
      : null;

  const toggleStatus = async () => {
    setStatusBusy(true);
    try {
      await onStatusChange(conversation.status === 'open' ? 'closed' : 'open');
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover md:hidden"
          aria-label="Back to conversations"
        >
          ←
        </button>
        <Avatar id={visitor.id} label={label} size={32} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{label}</div>
          <div className="truncate text-xs text-muted">
            {[label === visitor.email ? null : (visitor.email ?? 'No email'), visitor.location]
              .filter(Boolean)
              .join(' · ') || 'Anonymous visitor'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {conversation.status === 'closed' && (
            <span className="rounded-full bg-hover px-2 py-0.5 text-xs font-medium text-muted">Closed</span>
          )}
          <Button onClick={toggleStatus} disabled={statusBusy}>
            {conversation.status === 'open' ? 'Close' : 'Reopen'}
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {!messages && <p className="text-center text-sm text-muted">Loading messages…</p>}
          {messages &&
            group(messages).map((g) => {
              const mine = g.author === 'operator';
              return (
                <div key={g.key} className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                  <div className="px-1 text-xs text-muted">
                    {mine ? (g.authorName ?? 'Support') : label} · {messageTime(g.messages[0]!.createdAt)}
                  </div>
                  {g.messages.map((m) => (
                    <div
                      key={m.id}
                      title={messageTime(m.createdAt)}
                      className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                        mine ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md bg-surface shadow-sm ring-1 ring-line'
                      }`}
                    >
                      <Linkified text={m.body} />
                    </div>
                  ))}
                  {g.messages.some((m) => m.id === seen) && <div className="px-1 text-xs text-muted">Seen</div>}
                </div>
              );
            })}
        </div>
      </div>

      <Composer
        key={conversation.id}
        onSend={async (body) => {
          stick.current = true;
          await onSend(body);
        }}
        hint={
          visitor.email && visitor.notifyByEmail
            ? `If they don't see your reply soon, it will be emailed to ${visitor.email}.`
            : "No email on file. They'll see your reply the next time they visit."
        }
        operatorName={operator.displayName}
      />
    </section>
  );
}

function Composer({
  onSend,
  hint,
  operatorName,
}: {
  onSend: (body: string) => Promise<void>;
  hint: string;
  operatorName: string;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`;
  }, [draft]);

  const submit = async (event?: SubmitEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-line bg-surface px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2">
          <label htmlFor="reply" className="sr-only">
            Reply
          </label>
          <textarea
            id="reply"
            ref={ref}
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Reply as ${operatorName}…`}
            className="min-h-10 flex-1 resize-none rounded-xl border border-line bg-bg px-3.5 py-2 text-[15px] outline-none focus:border-accent"
          />
          <Button type="submit" variant="primary" className="h-10 px-4" disabled={!draft.trim() || sending}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        <p className={`mt-1.5 text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error ?? `${hint} Enter to send, Shift+Enter for a new line.`}
        </p>
      </div>
    </form>
  );
}
