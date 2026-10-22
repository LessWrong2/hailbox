import { redirect } from 'next/navigation';
import { Inbox } from '@/components/Inbox';
import { currentOperator } from '@/server/http';
import { toOperatorInfo } from '@/server/serialize';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const operator = await currentOperator();
  if (!operator) redirect('/login');
  return <Inbox operator={toOperatorInfo(operator)} />;
}
