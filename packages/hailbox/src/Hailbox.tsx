import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type SubmitEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChatIcon, ChevronDownIcon, CloseIcon, SendIcon } from './icons';
import { MAX_MESSAGE_LENGTH } from './protocol';
import { launcherCss, widgetCss } from './styles';
import { formatTime, Linkified } from './text';
import { RESET_EVENT, useHailbox, type DisplayMessage, type HailboxUser } from './useHailbox';

export interface HailboxProps {
  /** Base URL of your Hailbox inbox deployment, e.g. "https://inbox.example.com". */
  apiUrl: string;
  /** Panel heading. */
  title?: string;
  /** Smaller line under the heading, e.g. "We usually reply within a few hours". */
  subtitle?: string;
  /** Shown as the first message in the conversation. Not stored or sent anywhere. */
  greeting?: string;
  /** Accent color for the header, the visitor's messages and the launcher's icon. Pick one white text reads well on. */
  color?: string;
  position?: 'right' | 'left';
  colorScheme?: 'light' | 'dark' | 'auto';
  /**
   * Your site's signed-in user. The email prefills their notification address, and the stored
   * conversation is tied to it: if a different user signs in on the same browser, or you pass
   * `null` because they signed out, the widget starts a fresh conversation instead of showing the
   * previous one. Leave it undefined while your auth state is loading, or if you have no accounts.
   */
  user?: HailboxUser | null;
  /** Offer to email the visitor when someone replies. Defaults to true. */
  askForEmail?: boolean;
  zIndex?: number;
}

const OPEN_EVENT = 'hailbox:open';
const CLOSE_EVENT = 'hailbox:close';
const TOGGLE_EVENT = 'hailbox:toggle';
const SEND_EVENT = 'hailbox:send';

/**
 * Sends a command to the mounted widget, which marks the event handled by cancelling it.
 * Returns false when no widget is mounted to handle it.
 */
function command(type: string, detail?: string): boolean {
  return !window.dispatchEvent(new CustomEvent(type, { detail, cancelable: true }));
}

/**
 * Opens the chat panel of the mounted <Hailbox /> (e.g. from a "Contact us" link).
 * Returns false if no <Hailbox /> is mounted.
 */
export function openHailbox(): boolean {
  return command(OPEN_EVENT);
}

export function closeHailbox(): boolean {
  return command(CLOSE_EVENT);
}

export function toggleHailbox(): boolean {
  return command(TOGGLE_EVENT);
}

/**
 * Opens the chat panel and sends `body` as a message from the visitor, e.g. a request your own
 * UI composed for them. Returns false, and sends nothing, if no <Hailbox /> is mounted.
 */
export function sendHailboxMessage(body: string): boolean {
  return command(SEND_EVENT, body);
}

/**
 * Forgets the current visitor in this browser, e.g. when someone signs out of your site.
 * (Changing the `user.email` prop does this automatically.)
 */
export function resetHailbox(): void {
  window.dispatchEvent(new Event(RESET_EVENT));
}

const LAUNCHER_CSS_ID = 'hailbox-launcher-css';

function installLauncherCss() {
  let style = document.getElementById(LAUNCHER_CSS_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = LAUNCHER_CSS_ID;
    document.head.prepend(style);
  }
  style.textContent = launcherCss;
}

/**
 * Floating chat launcher plus panel. Render it once, near the root of your app.
 * The panel renders into a shadow root so the host page's CSS can't interfere with it. The
 * launcher doesn't, so the host page can restyle it through the .hailbox-launcher class.
 */
export function Hailbox(props: HailboxProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    installLauncherCss();
    const host = hostRef.current;
    if (host) setRoot(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
  }, []);

  return (
    <div data-hailbox="">
      <div ref={hostRef} />
      {root && <Widget {...props} root={root} />}
    </div>
  );
}

function Widget({
  root,
  apiUrl,
  title = 'Chat with us',
  subtitle,
  greeting,
  color,
  position = 'right',
  colorScheme = 'light',
  user,
  askForEmail = true,
  zIndex = 2147483000,
}: HailboxProps & { root: ShadowRoot }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [dismissedPreviewId, setDismissedPreviewId] = useState<number | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const hb = useHailbox({ apiUrl, open, user });
  const { send } = hb;

  useEffect(() => {
    const onOpen = (event: Event) => {
      event.preventDefault();
      setOpen(true);
    };
    const onClose = (event: Event) => {
      event.preventDefault();
      setOpen(false);
    };
    const onToggle = (event: Event) => {
      event.preventDefault();
      setOpen((o) => !o);
    };
    const onSend = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      event.preventDefault();
      setOpen(true);
      send(event.detail);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener(CLOSE_EVENT, onClose);
    window.addEventListener(TOGGLE_EVENT, onToggle);
    window.addEventListener(SEND_EVENT, onSend);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener(CLOSE_EVENT, onClose);
      window.removeEventListener(TOGGLE_EVENT, onToggle);
      window.removeEventListener(SEND_EVENT, onSend);
    };
  }, [send]);

  // Reply notification emails link back with ?hailbox=open.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('hailbox') !== 'open') return;
    setOpen(true);
    url.searchParams.delete('hailbox');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  const preview = !open && hb.latestUnread && hb.latestUnread.id !== dismissedPreviewId ? hb.latestUnread : null;

  const style = { '--hb-z': zIndex, ...(color ? { '--hb-accent': color } : {}) } as CSSProperties;

  return (
    <>
      {createPortal(
        <div className="hb" data-scheme={colorScheme} data-position={position} style={style}>
          <style>{widgetCss}</style>
          {open && (
            <Panel
              hb={hb}
              title={title}
              subtitle={subtitle}
              greeting={greeting}
              askForEmail={askForEmail}
              draft={draft}
              setDraft={setDraft}
              onClose={close}
            />
          )}
          {preview && (
            <div className="hb-preview" role="status">
              <button type="button" className="hb-preview-open" onClick={() => setOpen(true)}>
                <span className="hb-preview-from">{preview.authorName ?? 'New reply'}</span>
                <span className="hb-preview-body">{preview.body}</span>
              </button>
              <button
                type="button"
                className="hb-preview-close"
                aria-label="Dismiss"
                onClick={() => setDismissedPreviewId(preview.id)}
              >
                <CloseIcon />
              </button>
            </div>
          )}
        </div>,
        root,
      )}
      <button
        ref={launcherRef}
        type="button"
        className="hailbox-launcher"
        data-scheme={colorScheme}
        data-position={position}
        data-open={open}
        style={style}
        aria-expanded={open}
        aria-label={
          open ? 'Close chat' : hb.unreadCount > 0 ? `Open chat (${hb.unreadCount} unread)` : 'Open chat'
        }
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <ChevronDownIcon /> : <ChatIcon />}
        {!open && hb.unreadCount > 0 && (
          <span className="hailbox-badge" aria-hidden="true">
            {hb.unreadCount > 9 ? '9+' : hb.unreadCount}
          </span>
        )}
      </button>
    </>
  );
}

type HailboxState = ReturnType<typeof useHailbox>;

interface MessageGroup {
  key: string;
  author: DisplayMessage['author'];
  authorName: string | null;
  messages: DisplayMessage[];
}

const GROUP_WINDOW_MS = 5 * 60_000;

function groupMessages(messages: DisplayMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const group = groups.at(-1);
    const previous = group?.messages.at(-1);
    if (
      group &&
      previous &&
      group.author === message.author &&
      group.authorName === message.authorName &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS
    ) {
      group.messages.push(message);
    } else {
      groups.push({
        key: message.key,
        author: message.author,
        authorName: message.authorName,
        messages: [message],
      });
    }
  }
  return groups;
}

function Panel({
  hb,
  title,
  subtitle,
  greeting,
  askForEmail,
  draft,
  setDraft,
  onClose,
}: {
  hb: HailboxState;
  title: string;
  subtitle?: string;
  greeting?: string;
  askForEmail: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => textareaRef.current?.focus(), []);

  const hasVisitorMessage = hb.messages.some((m) => m.author === 'visitor');
  const showEmailPrompt =
    askForEmail && hasVisitorMessage && !!hb.visitor && !hb.visitor.email && !hb.emailPromptDismissed;
  const emailNotice = hasVisitorMessage && hb.visitor?.email && hb.visitor.notifyByEmail ? hb.visitor.email : null;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [hb.messages.length, showEmailPrompt, emailNotice]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, [draft]);

  const onScroll = () => {
    const list = listRef.current;
    if (list) stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  };

  const submit = (event?: SubmitEvent) => {
    event?.preventDefault();
    if (!draft.trim()) return;
    stickToBottom.current = true;
    hb.send(draft);
    setDraft('');
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const groups = groupMessages(hb.messages);

  return (
    <div
      className="hb-panel"
      role="dialog"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="hb-header">
        <div className="hb-header-text">
          <h2 className="hb-title">{title}</h2>
          {subtitle && <p className="hb-subtitle">{subtitle}</p>}
        </div>
        <button type="button" className="hb-close" aria-label="Close chat" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="hb-messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite">
        {greeting && (
          <div className="hb-group" data-author="operator">
            <div className="hb-bubble">
              <Linkified text={greeting} />
            </div>
          </div>
        )}
        {!greeting && hb.loaded && groups.length === 0 && (
          <div className="hb-empty">Send us a message and we&rsquo;ll get back to you here.</div>
        )}
        {groups.map((group) => (
          <div key={group.key} className="hb-group" data-author={group.author}>
            {group.author === 'operator' && group.authorName && (
              <div className="hb-author">{group.authorName}</div>
            )}
            {group.messages.map((message) => (
              <MessageBubble key={message.key} message={message} onRetry={hb.retry} />
            ))}
            <GroupMeta group={group} />
          </div>
        ))}
        {showEmailPrompt && <EmailPrompt onSave={hb.setEmail} onDismiss={hb.dismissEmailPrompt} />}
        {emailNotice && <p className="hb-notice">We&rsquo;ll also email replies to {emailNotice}.</p>}
      </div>

      <form className="hb-composer" onSubmit={submit}>
        <label className="hb-sr-only" htmlFor="hb-input">
          Message
        </label>
        <textarea
          id="hb-input"
          ref={textareaRef}
          rows={1}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Write a message…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
        />
        <button type="submit" className="hb-send" aria-label="Send" disabled={!draft.trim()}>
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message, onRetry }: { message: DisplayMessage; onRetry: (clientId: string) => void }) {
  return (
    <>
      <div className="hb-bubble" data-status={message.status} title={formatTime(message.createdAt)}>
        <Linkified text={message.body} />
      </div>
      {message.status === 'failed' && message.clientId && (
        <button type="button" className="hb-failed" onClick={() => onRetry(message.clientId!)}>
          Not sent. Retry
        </button>
      )}
    </>
  );
}

function GroupMeta({ group }: { group: MessageGroup }) {
  const last = group.messages.at(-1)!;
  if (last.status === 'failed') return null;
  return <div className="hb-meta">{last.status === 'sending' ? 'Sending…' : formatTime(last.createdAt)}</div>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailPrompt({ onSave, onDismiss }: { onSave: (email: string) => Promise<void>; onDismiss: () => void }) {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setError('That doesn’t look like an email address.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
    } catch {
      setError('Couldn’t save your email. Please try again.');
      setSaving(false);
    }
  };

  return (
    <form className="hb-email" onSubmit={submit} noValidate>
      <p className="hb-email-title">Get notified when we reply</p>
      <p className="hb-email-text">We&rsquo;ll answer here. Leave your email and we&rsquo;ll let you know there too.</p>
      <div className="hb-email-row">
        <input
          type="email"
          autoComplete="email"
          aria-label="Email address"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className="hb-button" disabled={saving}>
          {saving ? 'Saving…' : 'Notify me'}
        </button>
      </div>
      {error && <p className="hb-email-error">{error}</p>}
      <div className="hb-email-actions">
        <button type="button" className="hb-link" onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </form>
  );
}
