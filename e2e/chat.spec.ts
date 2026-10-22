import { expect, test, type Page } from '@playwright/test';

const INBOX = 'http://localhost:3000';
const SITE = 'http://localhost:3001';
const SCREENS = 'test-results/screens';

/** Signs in through the magic-link flow, using the link the dev server shows without Mailgun. */
async function signInOperator(page: Page, email: string) {
  await page.goto(`${INBOX}/login`);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Continue to inbox' }).click();
  await expect(page.getByRole('heading', { name: /Inbox/ })).toBeVisible();
}

test('visitor and operator chat in real time, and the visitor sees replies when they return', async ({ browser }) => {
  const marker = `e2e${Date.now()}`;
  const visitorEmail = `${marker}@example.com`;
  const question = `Do you offer discounts? (${marker})`;

  // Visitor: opens the widget on the demo site and asks a question.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${SITE}/pricing`);
  await visitor.getByRole('button', { name: 'Open chat' }).click();
  await expect(visitor.getByText('Hi! Ask us anything about Acme Widgets.')).toBeVisible();
  await visitor.getByLabel('Message').fill(question);
  await visitor.getByLabel('Message').press('Enter');
  await expect(visitor.getByText(question)).toBeVisible();

  // ...and leaves an email address for notifications.
  await visitor.getByLabel('Email address').fill(visitorEmail);
  await visitor.getByRole('button', { name: 'Notify me' }).click();
  await expect(visitor.getByText(new RegExp(`also email replies to ${visitorEmail}`))).toBeVisible();
  await visitor.screenshot({ path: `${SCREENS}/1-visitor-asked.png` });

  // Operator: signs in and finds the conversation.
  const operator = await (await browser.newContext()).newPage();
  await signInOperator(operator, 'e2e-operator@example.com');
  await operator.getByRole('button', { name: new RegExp(visitorEmail) }).click();
  await expect(operator.getByText(question)).toBeVisible();
  await expect(operator.getByText('Gets reply notifications')).toBeVisible();

  // Operator replies; the visitor sees it live and the operator sees it was read.
  await operator.getByLabel('Reply').fill('Yes! Annual plans are 20% off.');
  await operator.getByLabel('Reply').press('Enter');
  await expect(visitor.getByText('Yes! Annual plans are 20% off.')).toBeVisible();
  await expect(operator.getByText('Seen', { exact: true })).toBeVisible();
  await operator.screenshot({ path: `${SCREENS}/2-operator-replied.png` });
  await visitor.screenshot({ path: `${SCREENS}/3-visitor-got-reply.png` });

  // Visitor closes the panel; a new reply shows up as a badge and a preview.
  await visitor.getByRole('button', { name: 'Close chat' }).first().click();
  await operator.getByLabel('Reply').fill('Anything else I can help with?');
  await operator.getByLabel('Reply').press('Enter');
  await expect(visitor.getByRole('button', { name: 'Open chat (1 unread)' })).toBeVisible();
  await expect(visitor.getByRole('status')).toContainText('Anything else I can help with?');
  await visitor.screenshot({ path: `${SCREENS}/4-visitor-unread-preview.png` });

  // Returning visitor: after a reload (or a later visit) the unread reply is still there.
  await visitor.reload();
  await expect(visitor.getByRole('button', { name: 'Open chat (1 unread)' })).toBeVisible();
  await visitor.getByRole('button', { name: /Open chat/ }).click();
  await expect(visitor.getByText(question)).toBeVisible();
  await expect(visitor.getByText('Anything else I can help with?')).toBeVisible();
  await visitor.getByRole('button', { name: 'Close chat' }).first().click();
  await expect(visitor.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible();

  // Operator closes the conversation.
  await operator.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(operator.getByText('Closed', { exact: true })).toBeVisible();
});

test('the widget can be opened from page code and from notification email links', async ({ page }) => {
  await page.goto(SITE);
  await page.getByRole('button', { name: 'Contact sales' }).click();
  await expect(page.getByRole('dialog', { name: 'Talk to Acme' })).toBeVisible();

  await page.goto(`${SITE}/pricing?hailbox=open`);
  await expect(page.getByRole('dialog', { name: 'Talk to Acme' })).toBeVisible();
  // The flag is removed so a reload or shared URL doesn't keep reopening it.
  expect(new URL(page.url()).searchParams.has('hailbox')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
