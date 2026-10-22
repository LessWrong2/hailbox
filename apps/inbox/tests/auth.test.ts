import { describe, expect, it } from 'vitest';
import { completeLogin, operatorFromSessionToken, requestLogin } from '@/server/auth';
import { recordFetch } from './helpers';

function tokenFrom(link: string | undefined): string {
  return new URL(link!).searchParams.get('token')!;
}

describe('operator sign-in', () => {
  it('signs in an allowed operator with a one-time link', async () => {
    process.env.OPERATOR_EMAILS = 'Olivia@Acme.test, other@acme.test';
    const { devLink } = await requestLogin('olivia@acme.test');
    expect(devLink).toMatch(/^https:\/\/inbox\.test\/login\/verify\?token=/);

    const { sessionToken, operator } = await completeLogin(tokenFrom(devLink));
    expect(operator.email).toBe('olivia@acme.test');
    expect((await operatorFromSessionToken(sessionToken))?.id).toBe(operator.id);
    await expect(completeLogin(tokenFrom(devLink))).rejects.toMatchObject({ status: 400 });
  });

  it("doesn't reveal or email addresses that aren't allowed", async () => {
    process.env.OPERATOR_EMAILS = 'olivia@acme.test';
    expect(await requestLogin('mallory@evil.test')).toEqual({});
  });

  it('emails the link through Mailgun when configured, without exposing it', async () => {
    process.env.OPERATOR_EMAILS = 'olivia@acme.test';
    process.env.MAILGUN_API_KEY = 'key';
    process.env.MAILGUN_DOMAIN = 'mg.acme.test';
    const requests = recordFetch();
    expect(await requestLogin('olivia@acme.test')).toEqual({ devLink: undefined });
    expect(requests).toHaveLength(1);
    expect((requests[0]!.body as Record<string, string>).text).toContain('https://inbox.test/login/verify?token=');
  });

  it('revokes sessions when an operator is removed from the allowlist', async () => {
    process.env.OPERATOR_EMAILS = 'olivia@acme.test';
    const { sessionToken } = await completeLogin(tokenFrom((await requestLogin('olivia@acme.test')).devLink));
    process.env.OPERATOR_EMAILS = 'someone-else@acme.test';
    expect(await operatorFromSessionToken(sessionToken)).toBeNull();
  });

  it('limits how many links can be requested at once', async () => {
    process.env.OPERATOR_EMAILS = 'olivia@acme.test';
    for (let i = 0; i < 5; i++) expect((await requestLogin('olivia@acme.test')).devLink).toBeDefined();
    expect((await requestLogin('olivia@acme.test')).devLink).toBeUndefined();
  });
});
