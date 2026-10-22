import { isProduction, mailgunConfig } from './env';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

/**
 * Sends via Mailgun. Without Mailgun configured, development logs the email instead and
 * production drops it with an error log. Resolves to whether it was actually handed off.
 */
export async function sendEmail(email: OutgoingEmail): Promise<boolean> {
  const config = mailgunConfig();
  if (!config) {
    if (isProduction()) {
      console.error(`[hailbox] Mailgun is not configured; dropping email "${email.subject}"`);
    } else {
      console.log(`[hailbox] (dev) email to ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
    }
    return false;
  }

  const form = new FormData();
  form.set('from', config.from);
  form.set('to', email.to);
  form.set('subject', email.subject);
  form.set('text', email.text);
  form.set('html', email.html);
  for (const [name, value] of Object.entries(email.headers ?? {})) form.set(`h:${name}`, value);

  const res = await fetch(`${config.apiBase}/v3/${config.domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}` },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Mailgun responded ${res.status}: ${await res.text()}`);
  return true;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal, widely-compatible email layout. `body` is trusted HTML. */
export function emailLayout(body: string, footer = ''): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;">
<tr><td style="padding:28px 28px 24px;font-size:15px;line-height:1.55;">${body}</td></tr>
</table>
${footer ? `<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#6b7280;">${footer}</p>` : ''}
</td></tr></table>
</body></html>`;
}

export function emailButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
}
