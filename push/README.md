# Stride push service

Sends the funny workout reminders to your iPhone even when Stride is closed: one 10 minutes before
and one at the start of every planned workout.

It's a tiny Cloudflare Worker, on the free plan. It stores only your phone's push address and your
upcoming workout times. No name, history, body data or calendar details. It can only ever send the
built-in reminder lines, only to phones that subscribed through the Stride site. Messages are
end-to-end encrypted (Web Push), so Apple can't read them.

## One-time setup (about 15 minutes)

1. **Create a free Cloudflare account** at <https://dash.cloudflare.com/sign-up>.
2. **Open Workers & Pages** in the Cloudflare dashboard once. If it asks you to choose a
   `workers.dev` subdomain, pick any name (e.g. your first name).
3. **Copy your Account ID.** It's shown on the Workers & Pages overview (right-hand side,
   "Account ID"), and it's also the long code in the dashboard URL after `dash.cloudflare.com/`.
4. **Create an API token:** profile icon (top right) → **My Profile** → **API Tokens** →
   **Create Token** → use the **Edit Cloudflare Workers** template → under *Account Resources*
   pick your account (leave *Zone Resources* as is) → **Continue to summary** → **Create Token**.
   Copy the token (it's only shown once). It can only manage Workers in your account.
5. **Add both to GitHub:** in this repo go to **Settings → Secrets and variables → Actions →
   New repository secret** and add:
   * `CLOUDFLARE_API_TOKEN`: the token from step 4
   * `CLOUDFLARE_ACCOUNT_ID`: the ID from step 3
6. **Deploy:** **Actions** tab → **Deploy push service** → **Run workflow**. After about a minute
   it turns green, and it writes the service address into `docs/push-config.json` for you.
   GitHub Pages picks that up a minute or two later.
7. **On your iPhone:** open Stride from the home screen (close and reopen it once to load the
   update), go to **Plan → Funny push reminders → Turn on push reminders**, tap **Allow**, then
   **Send a test**. Lock the phone: the test should arrive within seconds.

After that it runs by itself. Any change to `push/` redeploys automatically.

## Good to know

* The service only learns about plan changes when Stride is open. If you move a workout in Google
  Calendar, open Stride once so the reminders follow.
* Focus / Do Not Disturb can silence the reminders, like any app.
* To stop everything: turn reminders off in Stride, or delete the `stride-push` Worker in
  Cloudflare. To see what it's doing: Cloudflare → Workers & Pages → stride-push → Logs.

## Development

```
npm test                                     # crypto (checked against RFC 8291) + alert rules
npx wrangler@4.149.0 dev                     # run locally
npx wrangler@4.149.0 deploy --dry-run        # check the bundle
```

Endpoints: `GET /vapid`, `POST /subscribe`, `POST /unsubscribe`, `POST /test` (CORS-limited to the
Stride site). One Durable Object holds the subscriptions and wakes itself with an alarm exactly
when the next reminder is due.
