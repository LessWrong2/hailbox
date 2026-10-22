import { useState, type SubmitEvent } from 'react';
import type { OperatorInfo } from '@/lib/inbox-protocol';
import { inboxApi } from '@/lib/inbox-api';
import { Button } from './ui';

export function AccountBar({
  operator,
  onOperatorChange,
}: {
  operator: OperatorInfo;
  onOperatorChange: (operator: OperatorInfo) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(operator.name ?? '');

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const { operator: updated } = await inboxApi<{ operator: OperatorInfo }>('/api/inbox/me', {
      method: 'PATCH',
      json: { name },
    });
    onOperatorChange(updated);
    setEditing(false);
  };

  const signOut = async () => {
    await inboxApi('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/login');
  };

  if (editing) {
    return (
      <form onSubmit={save} className="flex shrink-0 items-center gap-2 border-t border-line p-3">
        <label htmlFor="operator-name" className="sr-only">
          Your name, as visitors see it
        </label>
        <input
          id="operator-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name visitors see"
          maxLength={100}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" variant="primary">
          Save
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{operator.displayName}</div>
        <div className="truncate text-xs text-muted">{operator.email}</div>
      </div>
      <Button variant="ghost" onClick={() => setEditing(true)} title="Change the name visitors see on your replies">
        Edit name
      </Button>
      <Button variant="ghost" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
