import { visitorLabel, type InboxConversation } from '@/lib/inbox-protocol';
import { shortTime } from '@/lib/format';
import { Avatar } from './ui';

type Status = 'open' | 'closed';

export function ConversationList({
  conversations,
  status,
  onStatusChange,
  selectedId,
  onSelect,
  loaded,
  hasMore,
  onLoadMore,
  connected,
  unreadTotal,
}: {
  conversations: InboxConversation[];
  status: Status;
  onStatusChange: (status: Status) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loaded: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  connected: boolean;
  unreadTotal: number;
}) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          Inbox
          {unreadTotal > 0 && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">{unreadTotal}</span>
          )}
        </h1>
        <span
          className="flex items-center gap-1.5 text-xs text-muted"
          title={connected ? 'Receiving updates live' : 'Reconnecting; updates may be delayed'}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {connected ? 'Live' : 'Connecting'}
        </span>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-line px-3 py-2" role="tablist">
        {(['open', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => onStatusChange(s)}
            className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${
              status === s ? 'bg-selected text-accent' : 'text-muted hover:bg-hover'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {conversations.map((c) => {
          const label = visitorLabel(c.visitor);
          const unread = c.unreadCount > 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === selectedId ? 'true' : undefined}
                className={`flex w-full gap-3 border-b border-line px-4 py-3 text-left ${
                  c.id === selectedId ? 'bg-selected' : 'hover:bg-hover'
                }`}
              >
                <Avatar id={c.visitor.id} label={label} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`truncate text-sm ${unread ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{shortTime(c.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={`truncate text-sm ${unread ? 'text-fg' : 'text-muted'}`}>
                      {c.lastMessageAuthor === 'operator' && 'Replied: '}
                      {c.lastMessagePreview}
                    </span>
                    {unread && (
                      <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {loaded && conversations.length === 0 && (
          <li className="px-6 py-12 text-center text-sm text-muted">
            {status === 'open' ? 'No open conversations. Nice work.' : 'No closed conversations yet.'}
          </li>
        )}
        {!loaded && <li className="px-6 py-12 text-center text-sm text-muted">Loading…</li>}
        {hasMore && (
          <li className="p-3 text-center">
            <button type="button" onClick={onLoadMore} className="text-sm text-accent hover:underline">
              Load older conversations
            </button>
          </li>
        )}
      </ul>
    </>
  );
}
