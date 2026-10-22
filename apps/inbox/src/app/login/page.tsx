import { redirect } from 'next/navigation';
import { Card } from '@/components/Card';
import { LoginForm } from '@/components/LoginForm';
import { currentOperator } from '@/server/http';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentOperator()) redirect('/');
  return (
    <Card title="Sign in to your inbox">
      <LoginForm />
    </Card>
  );
}
