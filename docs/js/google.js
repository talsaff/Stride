// Google Calendar connector (browser only).
//
// Uses Google Identity Services to get a short-lived access token for the
// user's own calendar, then the Calendar REST API directly from the phone.
// No server: the user supplies their own OAuth Client ID (see Plan tab).

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TOKEN_KEY = 'stride.gtoken';

let gisPromise = null;

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
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expiresAt > Date.now() + 60_000) return t.token;
  } catch { /* ignore */ }
  return null;
}

export function hasValidToken() {
  return !!cachedToken();
}

export function forgetToken() {
  const t = cachedToken();
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
}

// Must be called from a tap (it may open Google's sign-in pop-up).
export async function connect(clientId, { prompt = '' } = {}) {
  const existing = cachedToken();
  if (existing) return existing;
  if (!clientId) throw new Error('Add your Google OAuth Client ID first.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 }));
        } catch { /* ignore */ }
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || err?.type || 'Google sign-in was closed.')),
    });
    client.requestAccessToken({ prompt });
  });
}

async function api(token, path = '', { method = 'GET', body, query } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } throw new Error('Google sign-in expired. Tap Sync to reconnect.'); }
  if (!res.ok && res.status !== 204 && res.status !== 410) throw new Error(`Google Calendar error ${res.status}`);
  return res.status === 204 || res.status === 410 ? null : res.json();
}

// Returns { busy: [{start, end}], strideEvents: Map(sessionId → event) }
export async function readCalendar(token, fromIso, toIso) {
  const busy = [];
  const strideEvents = new Map();
  let pageToken;
  do {
    const page = await api(token, '', {
      query: { timeMin: fromIso, timeMax: toIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}) },
    });
    for (const ev of page.items ?? []) {
      if (ev.status === 'cancelled') continue;
      const sid = ev.extendedProperties?.private?.strideSession;
      if (sid) { strideEvents.set(sid, ev); continue; }
      if (!ev.start?.dateTime || ev.transparency === 'transparent') continue; // all-day / "free" events don't block
      busy.push({ start: ev.start.dateTime, end: ev.end.dateTime, title: ev.summary ?? '' });
    }
    pageToken = page.nextPageToken;
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
    colorId: '10',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { strideSession: session.id } },
  };
}

export const insertEvent = (token, body) => api(token, '', { method: 'POST', body });
export const patchEvent = (token, id, body) => api(token, `/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deleteEvent = (token, id) => api(token, `/${encodeURIComponent(id)}`, { method: 'DELETE' });
