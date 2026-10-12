// Turns planned workout sessions into the two alerts per workout the push
// service sends. Pure. The funny lines come from the app's own list; the
// user's name is deliberately never sent to the server.

import { funnyLine } from '../../docs/js/engine/schedule.js';

export const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com'];
const MIN = 60 * 1000;
const MAX_SESSIONS = 40;
const HORIZON = 35 * 24 * 60 * MIN;

export function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

const isB64url = (s, len) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && s.length >= len && s.length <= len + 2;

export function validSubscription(sub) {
  return !!sub && validEndpoint(sub.endpoint) && isB64url(sub.keys?.p256dh, 86) && isB64url(sub.keys?.auth, 21);
}

// sessions: [{ id, start, minutes }] (only planned future sessions are sent)
export function buildAlerts(sessions, now) {
  const t0 = new Date(now).getTime();
  const out = [];
  for (const s of (Array.isArray(sessions) ? sessions : []).slice(0, MAX_SESSIONS)) {
    const id = String(s?.id ?? '').slice(0, 40);
    const start = new Date(s?.start).getTime();
    const minutes = Math.max(5, Math.min(60, Math.round(Number(s?.minutes) || 20)));
    if (!id || !Number.isFinite(start) || start < t0 - 15 * MIN || start > t0 + HORIZON) continue;
    out.push(
      { at: start - 10 * MIN, sessionId: id, kind: 'pre', title: 'Stride time in 10 min', body: funnyLine(id, { minutes }) },
      { at: start, sessionId: id, kind: 'start', title: 'Stride time 🏃', body: funnyLine(`${id}-go`, { minutes }) },
    );
  }
  return out.filter((a) => a.at >= t0 - 15 * MIN).sort((a, b) => a.at - b.at);
}

// Alerts that are due now (not more than 15 min late; late ones are dropped).
export function dueAlerts(alerts, now) {
  const t = new Date(now).getTime();
  return alerts.filter((a) => a.at <= t + 5000 && a.at >= t - 15 * MIN);
}
