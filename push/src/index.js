// Stride push service (Cloudflare Worker + one Durable Object).
//
// Endpoints (JSON, CORS-limited to the Stride site):
//   GET  /vapid        → { publicKey }  (VAPID key pair is generated on first use)
//   POST /subscribe    { subscription, sessions:[{id,start,minutes}] } → { ok, alerts }
//   POST /unsubscribe  { endpoint }
//   POST /test         { endpoint }  → sends one test notification
//
// Stored: push subscriptions (notification address + keys) and upcoming
// alert times. Nothing else: no names, no history, no calendar data.
// Notifications only ever contain lines from the built-in list.

import { DurableObject } from 'cloudflare:workers';
import { generateVapidKeys, sendPush } from './webpush.js';
import { buildAlerts, dueAlerts, validSubscription, validEndpoint } from './alerts.js';

const MAX_SUBS = 10;
const MAX_BODY = 16 * 1024;

async function subId(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : null;
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'stride-push' });
    if (!cors) return json({ error: 'Origin not allowed' }, 403);
    if (!['/vapid', '/subscribe', '/unsubscribe', '/test'].includes(url.pathname)) return json({ error: 'Not found' }, 404, cors);
    if (request.method === 'POST' && Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return json({ error: 'Too large' }, 413, cors);

    const hub = env.HUB.get(env.HUB.idFromName('hub'));
    const res = await hub.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

export class PushHub extends DurableObject {
  async vapid() {
    let v = await this.ctx.storage.get('vapid');
    if (!v) { v = await generateVapidKeys(); await this.ctx.storage.put('vapid', v); }
    return v;
  }

  async subs() { return (await this.ctx.storage.get('subs')) ?? {}; }

  async scheduleNext(subs) {
    const next = Object.values(subs).flatMap((s) => s.alerts.map((a) => a.at)).sort((a, b) => a - b)[0];
    if (next == null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/vapid') return json({ publicKey: (await this.vapid()).publicKey });
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);

    let body;
    try { body = JSON.parse(await request.text()); } catch { return json({ error: 'Bad JSON' }, 400); }
    const subs = await this.subs();

    if (path === '/subscribe') {
      if (!validSubscription(body.subscription)) return json({ error: 'Invalid subscription' }, 400);
      const { endpoint, keys } = body.subscription;
      const id = await subId(endpoint);
      subs[id] = { subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, alerts: buildAlerts(body.sessions, Date.now()), updatedAt: Date.now(), lastTest: subs[id]?.lastTest ?? 0 };
      // Keep storage bounded: drop the least recently updated subscriptions.
      const ids = Object.keys(subs).sort((a, b) => subs[b].updatedAt - subs[a].updatedAt);
      for (const old of ids.slice(MAX_SUBS)) delete subs[old];
      await this.ctx.storage.put('subs', subs);
      await this.scheduleNext(subs);
      return json({ ok: true, alerts: subs[id].alerts.length, next: subs[id].alerts[0]?.at ?? null });
    }

    if (!validEndpoint(body.endpoint)) return json({ error: 'Invalid endpoint' }, 400);
    const id = await subId(body.endpoint);

    if (path === '/unsubscribe') {
      delete subs[id];
      await this.ctx.storage.put('subs', subs);
      await this.scheduleNext(subs);
      return json({ ok: true });
    }

    if (path === '/test') {
      const sub = subs[id];
      if (!sub) return json({ error: 'Not subscribed' }, 404);
      if (Date.now() - sub.lastTest < 30_000) return json({ error: 'Wait a few seconds between tests' }, 429);
      sub.lastTest = Date.now();
      await this.ctx.storage.put('subs', subs);
      let status;
      try {
        status = await sendPush(sub.subscription, { title: 'Stride time 🏃', body: 'Test reminder: push notifications work! Now get your lazy ass on the treadmill.', tag: 'stride-test' },
          { vapid: await this.vapid(), subject: this.env.VAPID_SUBJECT, ttl: 120 });
      } catch (e) {
        return json({ ok: false, error: `Could not reach the push service: ${e.message}` }, 502);
      }
      if (status === 404 || status === 410) {
        delete subs[id];
        await this.ctx.storage.put('subs', subs);
        return json({ ok: false, error: 'This phone is no longer subscribed. Turn push reminders off and on again.' }, 410);
      }
      return json({ ok: status >= 200 && status < 300, status }, status >= 200 && status < 300 ? 200 : 502);
    }
    return json({ error: 'Not found' }, 404);
  }

  async alarm() {
    const subs = await this.subs();
    const vapid = await this.vapid();
    const now = Date.now();
    for (const [id, sub] of Object.entries(subs)) {
      for (const a of dueAlerts(sub.alerts, now)) {
        try {
          const status = await sendPush(sub.subscription, { title: a.title, body: a.body, tag: `stride-${a.sessionId}`, url: './' },
            { vapid, subject: this.env.VAPID_SUBJECT, ttl: 900, topic: `stride-${a.kind}` });
          if (status === 404 || status === 410) { delete subs[id]; break; } // subscription gone
        } catch { /* network hiccup: the alert is dropped rather than retried late */ }
      }
      console.log(`alarm: sub ${id} had ${sub.alerts.length} alerts, sent ${dueAlerts(sub.alerts, now).length}`);
      if (subs[id]) subs[id].alerts = sub.alerts.filter((a) => a.at > now + 5000);
    }
    await this.ctx.storage.put('subs', subs);
    await this.scheduleNext(subs);
  }
}
