# hailbox

A chat widget for talking with your site's visitors. It pairs with a self-hosted Hailbox inbox,
where your team answers. See the [main README](../../README.md) for deploying the inbox.

Releases are published on [GitHub](https://github.com/LessWrong2/hailbox/releases) rather than
npm. Add the latest release's tarball to your `package.json` dependencies (each release's notes
have the exact line), then install:

```json
"hailbox": "https://github.com/LessWrong2/hailbox/releases/download/v0.1.0/hailbox-0.1.0.tgz"
```

```tsx
import { Hailbox } from 'hailbox';

<Hailbox apiUrl="https://inbox.example.com" />;
```

Render it once, near the root of your app (e.g. in a Next.js root layout). It's a client
component that renders into a shadow root, so your site's CSS won't affect it and its CSS won't
leak into your site.

## Props

| Prop          | Type                            | Default          | Description                                                                 |
| ------------- | ------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `apiUrl`      | `string`                        | required         | Base URL of your Hailbox inbox deployment.                                  |
| `title`       | `string`                        | `"Chat with us"` | Panel heading.                                                              |
| `subtitle`    | `string`                        |                  | Smaller line under the heading, e.g. expected response time.               |
| `greeting`    | `string`                        |                  | Shown as the first message. Not stored or sent anywhere.                   |
| `color`       | `string`                        | `#4f46e5`        | Accent color for the launcher, header and visitor messages. Text on it is white. |
| `position`    | `"right" \| "left"`             | `"right"`        | Which corner the launcher sits in.                                          |
| `colorScheme` | `"light" \| "dark" \| "auto"`   | `"light"`        | `"auto"` follows the visitor's OS setting.                                  |
| `user`        | `{ name?, email? } \| null`     |                  | Your signed-in user. Prefills their email, and ties the stored conversation to them (see below). |
| `askForEmail` | `boolean`                       | `true`           | After their first message, offer to email the visitor when someone replies. |
| `zIndex`      | `number`                        | `2147483000`     | Stacking order of the launcher and panel.                                   |

## Opening the panel from your own UI

```tsx
'use client';
import { openHailbox } from 'hailbox';

<button onClick={openHailbox}>Contact us</button>;
```

`closeHailbox()` and `toggleHailbox()` work the same way. Links with `?hailbox=open` in the URL
open the panel on load. Reply notification emails use this.

## Signed-in users

If your site has accounts, pass the signed-in user:

```tsx
// null when signed out; undefined while you don't know yet (e.g. auth is still loading)
const user = status === 'loading' ? undefined : session ? { name: session.user.name, email: session.user.email } : null;

<Hailbox apiUrl="…" user={user} />;
```

The conversation stored in the browser is tied to `user.email`. If a different user signs in
on the same browser, or you pass `null` because the user signed out, the widget starts a new
conversation, so nobody sees someone else's history. An anonymous visitor who signs in keeps
their conversation. Passing `undefined` changes nothing, so a loading state doesn't reset
anyone. You can also call `resetHailbox()` to forget the current visitor yourself.

## What visitors get

- Their conversation persists across pages and visits in the same browser (via `localStorage`).
- Replies arrive live while the page is open. If a reply arrives while the panel is closed, the
  launcher shows an unread badge and a preview.
- If they leave an email address, they're emailed about replies they haven't seen within about a
  minute, with a one-click unsubscribe.

## Headless use

`hailbox/client` exports the API client and reconnecting socket that the widget uses, for
building your own UI. `hailbox/protocol` has the wire types:

```ts
import { HailboxApi, ReconnectingSocket, socketUrl } from 'hailbox/client';
import type { VisitorServerFrame } from 'hailbox/protocol';
```
