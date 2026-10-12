// Google Calendar connector (browser only).
//
// Least-privilege design:
//  * calendar.freebusy    → only WHEN you are busy. Stride never sees event
//                           titles, descriptions, attendees or locations.
//  * calendar.app.created → Stride can only create/change events on the
//                           "Stride workouts" calendar it creates itself.
//                           Your other calendars are untouchable.
// The access token lives in memory/sessionStorage only (expires after ~1 h)
// and is only ever sent to Google. No server, no third parties.

const SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.app.created';
const BASE = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'stride.gtoken.v2';

let gisPromise = null;
let memToken = null;

// Older versions kept a broader token in localStorage: drop it.
try { localStorage.removeItem('stride.gtoken'); } catch { /* ignore */ }

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Are you online?')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function cachedToken() {
  let t = memToken;
  if (!t) { try { t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { t = null; } }
  if (t && t.expiresAt > Date.now() + 60_000) { memToken = t; return t.token; }
  return null;
}

export function hasValidToken() {
  return !!cachedToken();
}

export function forgetToken() {
  const t = cachedToken();
  memToken = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
}

// Must be called from a tap (it may open Google's sign-in pop-up).
export async function connect(clientId) {
  const existing = cachedToken();
  if (existing) return existing;
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId?.trim() ?? '')) {
    throw new Error('That does not look like a Google OAuth Client ID (it ends in .apps.googleusercontent.com).');
  }
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPE.split(' '))) {
          return reject(new Error('Stride needs both permissions (free/busy times and its own calendar). Tap Sync to try again.'));
        }
        memToken = { token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 };
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(memToken)); } catch { /* ignore */ }
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || err?.type || 'Google sign-in was closed.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function api(token, path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { forgetToken(); throw new Error('Google sign-in expired. Tap Sync to reconnect.'); }
  if (res.status === 404) return null;
  if (!res.ok && res.status !== 204 && res.status !== 410) throw new Error(`Google Calendar error ${res.status}`);
  return res.status === 204 || res.status === 410 ? null : res.json();
}

const cal = (id) => `/calendars/${encodeURIComponent(id)}`;

// Find or create the dedicated "Stride workouts" calendar. Returns its id.
export async function ensureCalendar(token, knownId) {
  if (knownId && await api(token, cal(knownId))) return knownId;
  const created = await api(token, '/calendars', {
    method: 'POST',
    body: { summary: 'Stride workouts', description: 'Treadmill workouts planned by Stride.', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  return created.id;
}

// Busy times from your main calendar (times only) + Stride's own events.
export async function readCalendar(token, calendarId, fromIso, toIso) {
  const fb = await api(token, '/freeBusy', { method: 'POST', body: { timeMin: fromIso, timeMax: toIso, items: [{ id: 'primary' }] } });
  const busy = (fb?.calendars?.primary?.busy ?? []).map(({ start, end }) => ({ start, end }));
  const strideEvents = new Map();
  let pageToken;
  do {
    const page = await api(token, `${cal(calendarId)}/events`, {
      query: { timeMin: fromIso, timeMax: toIso, singleEvents: 'true', maxResults: '250', ...(pageToken ? { pageToken } : {}) },
    });
    for (const ev of page?.items ?? []) {
      const sid = ev.extendedProperties?.private?.strideSession;
      if (sid && ev.status !== 'cancelled') strideEvents.set(sid, ev);
    }
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return { busy, strideEvents };
}

export function eventBody(session, { title, description }) {
  const end = new Date(new Date(session.start).getTime() + session.minutes * 60000);
  return {
    summary: title,
    description,
    start: { dateTime: new Date(session.start).toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { strideSession: session.id } },
  };
}

export const insertEvent = (token, calId, body) => api(token, `${cal(calId)}/events`, { method: 'POST', body });
export const patchEvent = (token, calId, id, body) => api(token, `${cal(calId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deleteEvent = (token, calId, id) => api(token, `${cal(calId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
