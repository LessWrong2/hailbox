import type { ReactNode } from 'react';
import { describeUserAgent, displayUrl, relativeTime } from '@/lib/format';
import type { InboxConversation } from '@/lib/inbox-protocol';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function PageLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
      {displayUrl(url)}
    </a>
  );
}

export function VisitorDetails({ conversation }: { conversation: InboxConversation }) {
  const { visitor } = conversation;
  const browser = describeUserAgent(visitor.userAgent);
  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-5 xl:block">
      <h2 className="mb-4 text-sm font-semibold">Visitor</h2>
      <dl className="space-y-4">
        {visitor.name && <Row label="Name">{visitor.name}</Row>}
        <Row label="Email">
          {visitor.email ? (
            <>
              <a href={`mailto:${visitor.email}`} className="text-accent hover:underline">
                {visitor.email}
              </a>
              <div className="text-xs text-muted">
                {visitor.notifyByEmail ? 'Gets reply notifications' : 'Unsubscribed from notifications'}
              </div>
            </>
          ) : (
            <span className="text-muted">Not provided</span>
          )}
        </Row>
        {visitor.location && <Row label="Location">{visitor.location}</Row>}
        {visitor.lastPageUrl && (
          <Row label="Last seen on">
            <PageLink url={visitor.lastPageUrl} />
          </Row>
        )}
        {conversation.pageUrl && conversation.pageUrl !== visitor.lastPageUrl && (
          <Row label="Started on">
            <PageLink url={conversation.pageUrl} />
          </Row>
        )}
        {browser && <Row label="Browser">{browser}</Row>}
        <Row label="Last active">{relativeTime(visitor.lastSeenAt)}</Row>
        <Row label="First seen">{relativeTime(visitor.createdAt)}</Row>
      </dl>
    </aside>
  );
}
