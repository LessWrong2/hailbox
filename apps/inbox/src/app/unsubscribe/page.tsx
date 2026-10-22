import { Card } from '@/components/Card';
import { ConfirmAction } from '@/components/ConfirmAction';
import { siteName } from '@/server/env';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ v?: string; s?: string }> }) {
  const { v, s } = await searchParams;
  const site = siteName();
  return (
    <Card title="Stop reply emails">
      <p className="mb-4 text-sm text-muted">
        You won&rsquo;t get emails about new replies from {site}. You&rsquo;ll still see replies in the chat on the site.
      </p>
      {v && s ? (
        <ConfirmAction
          endpoint={`/api/v1/unsubscribe?${new URLSearchParams({ v, s })}`}
          label="Unsubscribe"
          done="Done. You won't get any more reply emails."
        />
      ) : (
        <p className="text-sm text-danger">This unsubscribe link is incomplete.</p>
      )}
    </Card>
  );
}
