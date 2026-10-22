import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { HailboxApi, HailboxApiError, normalizeApiUrl, socketUrl } from './api';
import type {
  MessageAuthor,
  VisitorServerFrame,
  VisitorStateResponse,
  WireConversation,
  WireMessage,
  WireVisitor,
} from './protocol';
import { ReconnectingSocket } from './socket';
import { clearSession, loadSession, saveSession, type StoredSession } from './storage';

export interface DisplayMessage {
  key: string;
  id: number | null;
  author: MessageAuthor;
  authorName: string | null;
  body: string;
  createdAt: string;
  status: 'sent' | 'sending' | 'failed';
  clientId?: string;
}

interface PendingMessage {
  clientId: string;
  body: string;
  createdAt: string;
  failed: boolean;
}

export interface WidgetState {
  loaded: boolean;
  visitor: WireVisitor | null;
  conversation: WireConversation | null;
  messages: WireMessage[];
  pending: PendingMessage[];
  /** Highest operator message id the visitor has read. */
  lastReadId: number;
}

export type WidgetAction =
  | { type: 'reset' }
  | { type: 'state'; response: VisitorStateResponse; incremental: boolean }
  | { type: 'merge'; messages: WireMessage[] }
  | { type: 'visitor'; visitor: WireVisitor }
  | { type: 'conversation'; conversation: WireConversation }
  | { type: 'pending'; clientId: string; body: string }
  | { type: 'pendingFailed'; clientId: string }
  | { type: 'pendingRetry'; clientId: string }
  | { type: 'confirmed'; clientId: string; message: WireMessage }
  | { type: 'read'; lastMessageId: number };

export const initialWidgetState: WidgetState = {
  loaded: false,
  visitor: null,
  conversation: null,
  messages: [],
  pending: [],
  lastReadId: 0,
};

function mergeMessages(existing: WireMessage[], incoming: WireMessage[]): WireMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function withoutConfirmed(pending: PendingMessage[], messages: WireMessage[]): PendingMessage[] {
  const confirmed = new Set(messages.map((m) => m.clientId).filter(Boolean));
  return pending.filter((p) => !confirmed.has(p.clientId));
}

export function widgetReducer(state: WidgetState, action: WidgetAction): WidgetState {
  switch (action.type) {
    case 'reset':
      return { ...initialWidgetState, loaded: true, pending: state.pending };
    case 'state': {
      const { response } = action;
      const messages = action.incremental
        ? mergeMessages(state.messages, response.messages)
        : response.messages;
      return {
        ...state,
        loaded: true,
        visitor: response.visitor,
        conversation: response.conversation,
        messages,
        pending: withoutConfirmed(state.pending, messages),
        lastReadId: Math.max(state.lastReadId, response.conversation?.visitorLastReadMessageId ?? 0),
      };
    }
    case 'merge': {
      const messages = mergeMessages(state.messages, action.messages);
      return { ...state, messages, pending: withoutConfirmed(state.pending, messages) };
    }
    case 'visitor':
      return { ...state, visitor: action.visitor };
    case 'conversation':
      return {
        ...state,
        conversation: action.conversation,
        lastReadId: Math.max(state.lastReadId, action.conversation.visitorLastReadMessageId ?? 0),
      };
    case 'pending':
      return {
        ...state,
        pending: [
          ...state.pending,
          {
            clientId: action.clientId,
            body: action.body,
            createdAt: new Date().toISOString(),
            failed: false,
          },
        ],
      };
    case 'pendingFailed':
    case 'pendingRetry':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.clientId === action.clientId ? { ...p, failed: action.type === 'pendingFailed' } : p,
        ),
      };
    case 'confirmed': {
      const messages = mergeMessages(state.messages, [{ ...action.message, clientId: action.clientId }]);
      return { ...state, messages, pending: withoutConfirmed(state.pending, messages) };
    }
    case 'read':
      return { ...state, lastReadId: Math.max(state.lastReadId, action.lastMessageId) };
  }
}

export function toDisplayMessages(state: WidgetState): DisplayMessage[] {
  const confirmed: DisplayMessage[] = state.messages.map((m) => ({
    key: m.clientId ? `c${m.clientId}` : `m${m.id}`,
    id: m.id,
    author: m.author,
    authorName: m.authorName,
    body: m.body,
    createdAt: m.createdAt,
    status: 'sent',
    clientId: m.clientId,
  }));
  const pending: DisplayMessage[] = state.pending.map((p) => ({
    key: `c${p.clientId}`,
    id: null,
    author: 'visitor',
    authorName: null,
    body: p.body,
    createdAt: p.createdAt,
    status: p.failed ? 'failed' : 'sending',
    clientId: p.clientId,
  }));
  return [...confirmed, ...pending];
}

function latestOperatorMessage(messages: WireMessage[]): WireMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.author === 'operator') return messages[i]!;
  }
  return null;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function currentPageUrl(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.href;
}

export interface HailboxUser {
  name?: string;
  email?: string;
}

export interface UseHailboxOptions {
  apiUrl: string;
  /** Whether the chat panel is currently open; read receipts are only sent while it is. */
  open: boolean;
  /** The host's signed-in user; null means signed out, undefined means unknown (or no accounts). */
  user?: HailboxUser | null;
}

/**
 * Decides whether a stored session may be used now that the host says `signedInAs` is signed in
 * (an email, null for nobody, or undefined for unknown). Returns null to discard it, or the
 * session to use, which is a new object when it should be re-saved.
 */
export function sessionForUser(
  stored: StoredSession | null,
  signedInAs: string | null | undefined,
): StoredSession | null {
  if (!stored || signedInAs === undefined) return stored;
  if (stored.userEmail) return stored.userEmail === signedInAs ? stored : null;
  // An anonymous visitor who then signs in keeps their conversation, now tied to them.
  return signedInAs ? { ...stored, userEmail: signedInAs } : stored;
}

/** Dispatched on window by resetHailbox(). */
export const RESET_EVENT = 'hailbox:reset';

export function useHailbox({ apiUrl, open, user }: UseHailboxOptions) {
  const base = normalizeApiUrl(apiUrl);
  const sessionRef = useRef<StoredSession | null>(null);
  const creatingRef = useRef<Promise<void> | null>(null);
  // Mirrors sessionRef.current?.token, so effects can depend on which visitor we are.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [emailPromptDismissed, setEmailPromptDismissed] = useState(false);
  const [state, dispatch] = useReducer(widgetReducer, initialWidgetState);
  const [visible, setVisible] = useState(true);
  const [connected, setConnected] = useState(false);
  const api = useMemo(() => new HailboxApi(base, () => sessionRef.current?.token ?? null), [base]);
  const userName = user?.name;
  const userEmail = user?.email?.trim().toLowerCase() || undefined;
  // Who the host says is signed in: an email, null for "nobody", or undefined for "can't say"
  // (e.g. their auth state is still loading), which must not discard anything.
  const signedInAs = user === null ? null : (userEmail ?? (user ? null : undefined));

  const lastIdRef = useRef(0);
  useEffect(() => {
    lastIdRef.current = state.messages.at(-1)?.id ?? 0;
  }, [state.messages]);

  const adopt = useCallback((session: StoredSession | null) => {
    sessionRef.current = session;
    setSessionToken(session?.token ?? null);
    setEmailPromptDismissed(!!session?.emailPromptDismissed);
  }, []);

  /** Drops the visitor. Given a token, only if it's still the current one, so stale 401s are ignored. */
  const forget = useCallback(
    (token?: string) => {
      if (token !== undefined && sessionRef.current?.token !== token) return;
      clearSession(base);
      adopt(null);
      dispatch({ type: 'reset' });
    },
    [base, adopt],
  );

  const refresh = useCallback(async () => {
    const token = sessionRef.current?.token;
    if (!token) return;
    const after = lastIdRef.current;
    try {
      const response = await api.getState(after > 0 ? after : undefined);
      // Ignore the answer if we've become a different visitor while it was in flight.
      if (sessionRef.current?.token === token) dispatch({ type: 'state', response, incremental: after > 0 });
    } catch (err) {
      if (err instanceof HailboxApiError && err.isUnauthorized) forget(token);
    }
  }, [api, forget]);

  // Restore the visitor from a previous visit. A session belongs to the signed-in user (by
  // `user.email`) it was created under, so when someone else signs in on this browser, or they
  // sign out, we start fresh rather than showing them the previous person's conversation.
  useEffect(() => {
    const loaded = loadSession(base);
    const stored = sessionForUser(loaded, signedInAs);
    if (!stored) clearSession(base);
    else if (stored !== loaded) saveSession(base, stored);
    adopt(stored);
    if (stored) void refresh();
    else dispatch({ type: 'reset' });
  }, [base, signedInAs, adopt, refresh]);

  useEffect(() => {
    const onReset = () => forget();
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, [forget]);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Live updates. Only worth holding a socket once there's a conversation to hear about,
  // and not while the tab is in the background (we catch up when it becomes visible).
  const conversationId = state.conversation?.id ?? null;
  useEffect(() => {
    if (!sessionToken || !conversationId || !visible) return;
    const socket = new ReconnectingSocket<VisitorServerFrame>({
      url: socketUrl(base, '/api/v1/ws'),
      onOpen: (send) => send({ type: 'auth', token: sessionToken }),
      onFrame: (frame) => {
        switch (frame.type) {
          case 'ready':
            setConnected(true);
            void refresh();
            break;
          case 'message':
            dispatch({ type: 'merge', messages: [frame.message] });
            break;
          case 'read':
            dispatch({ type: 'read', lastMessageId: frame.lastMessageId });
            break;
          case 'visitor':
            dispatch({ type: 'visitor', visitor: frame.visitor });
            break;
        }
      },
      onDisconnect: () => setConnected(false),
      onUnauthorized: () => forget(sessionToken),
    });
    socket.start();
    return () => {
      socket.stop();
      setConnected(false);
    };
  }, [base, sessionToken, conversationId, visible, refresh, forget]);

  // Fallback for when the socket can't connect: poll while the panel is open and on screen.
  useEffect(() => {
    if (!open || !visible || connected || !sessionToken || !conversationId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [open, visible, connected, sessionToken, conversationId, refresh]);

  const latestOperator = latestOperatorMessage(state.messages);
  const latestOperatorId = latestOperator?.id ?? 0;
  useEffect(() => {
    if (!open || !visible || !sessionToken || latestOperatorId <= state.lastReadId) return;
    dispatch({ type: 'read', lastMessageId: latestOperatorId });
    api.markRead({ lastMessageId: latestOperatorId }).catch(() => {});
  }, [api, open, visible, sessionToken, latestOperatorId, state.lastReadId]);

  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return;
    creatingRef.current ??= (async () => {
      try {
        const res = await api.createVisitor({
          name: userName,
          email: userEmail,
          pageUrl: currentPageUrl(),
        });
        const session: StoredSession = {
          visitorId: res.visitor.id,
          token: res.token,
          userEmail: signedInAs ?? undefined,
        };
        saveSession(base, session);
        adopt(session);
        dispatch({ type: 'visitor', visitor: res.visitor });
      } finally {
        creatingRef.current = null;
      }
    })();
    await creatingRef.current;
  }, [api, base, adopt, userName, userEmail, signedInAs]);

  // If the host site knows the user's email and the visitor hasn't given one, use it.
  const visitorEmail = state.visitor?.email;
  const visitorLoaded = !!state.visitor;
  useEffect(() => {
    if (!visitorLoaded || visitorEmail || !userEmail) return;
    api
      .updateVisitor({ email: userEmail })
      .then((res) => dispatch({ type: 'visitor', visitor: res.visitor }))
      .catch(() => {});
  }, [api, visitorLoaded, visitorEmail, userEmail]);

  const deliver = useCallback(
    async (clientId: string, body: string) => {
      let usedToken: string | undefined;
      const attempt = async () => {
        await ensureSession();
        usedToken = sessionRef.current?.token;
        return api.sendMessage({ body, clientId, pageUrl: currentPageUrl() });
      };
      try {
        let res;
        try {
          res = await attempt();
        } catch (err) {
          // Our stored token went stale (e.g. the inbox's data was reset): start over once.
          if (!(err instanceof HailboxApiError && err.isUnauthorized)) throw err;
          forget(usedToken);
          res = await attempt();
        }
        dispatch({ type: 'confirmed', clientId, message: res.message });
        dispatch({ type: 'conversation', conversation: res.conversation });
      } catch {
        dispatch({ type: 'pendingFailed', clientId });
      }
    },
    [api, ensureSession, forget],
  );

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      const clientId = randomId();
      dispatch({ type: 'pending', clientId, body });
      void deliver(clientId, body);
    },
    [deliver],
  );

  const retry = useCallback(
    (clientId: string) => {
      const pending = state.pending.find((p) => p.clientId === clientId);
      if (!pending) return;
      dispatch({ type: 'pendingRetry', clientId });
      void deliver(clientId, pending.body);
    },
    [deliver, state.pending],
  );

  const setEmail = useCallback(
    async (email: string) => {
      await ensureSession();
      const res = await api.updateVisitor({ email, notifyByEmail: true });
      dispatch({ type: 'visitor', visitor: res.visitor });
    },
    [api, ensureSession],
  );

  const dismissEmailPrompt = useCallback(() => {
    setEmailPromptDismissed(true);
    if (sessionRef.current) {
      sessionRef.current = { ...sessionRef.current, emailPromptDismissed: true };
      saveSession(base, sessionRef.current);
    }
  }, [base]);

  const unreadCount = state.messages.filter(
    (m) => m.author === 'operator' && m.id > state.lastReadId,
  ).length;

  return {
    loaded: state.loaded,
    visitor: state.visitor,
    messages: toDisplayMessages(state),
    unreadCount,
    latestUnread: latestOperator && latestOperator.id > state.lastReadId ? latestOperator : null,
    connected,
    emailPromptDismissed,
    send,
    retry,
    setEmail,
    dismissEmailPrompt,
  };
}
