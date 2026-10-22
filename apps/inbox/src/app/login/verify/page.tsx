import Link from 'next/link';
import { Card } from '@/components/Card';
import { ConfirmAction } from '@/components/ConfirmAction';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <Card title="Sign in">
      {token ? (
        <div className="mt-4">
          <ConfirmAction endpoint="/api/auth/verify" json={{ token }} label="Continue to inbox" redirectTo="/" />
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          This link is missing its token.{' '}
          <Link href="/login" className="text-accent hover:underline">
            Request a new one
          </Link>
          .
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        Link expired?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Send a new one
        </Link>
      </p>
    </Card>
  );
}
