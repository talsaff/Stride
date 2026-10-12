// Push reminders client. Talks to the Stride push service (see /push in the
// repo). Sends only the phone's push subscription and upcoming workout
// times; the service sends the funny reminders even when the app is closed.

let configUrl = null;

export async function serviceUrl() {
  if (configUrl !== null) return configUrl;
  try {
    const res = await fetch('push-config.json', { cache: 'no-store' });
    const cfg = await res.json();
    configUrl = String(cfg.url || '').replace(/\/+$/, '');
  } catch {
    configUrl = '';
  }
  return configUrl;
}

export function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(b64url) {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function post(url, path, body) {
  const res = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Push service error ${res.status}`);
  return data;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Ask permission (must be called from a tap), subscribe, and register.
export async function enable(url, sessions) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in iPhone Settings → Notifications → Stride.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch(`${url}/vapid`)).json();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can't be reused.
  const existingKey = sub?.options?.applicationServerKey;
  if (sub && existingKey && btoa(String.fromCharCode(...new Uint8Array(existingKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return post(url, '/subscribe', { subscription: sub.toJSON(), sessions });
}

export async function update(url, sessions) {
  const sub = await currentSubscription();
  if (!sub) return null;
  return post(url, '/subscribe', { subscription: sub.toJSON(), sessions });
}

export async function disable(url) {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await post(url, '/unsubscribe', { endpoint: sub.endpoint }); } catch { /* still unsubscribe locally */ }
  await sub.unsubscribe();
}

export async function test(url) {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Push reminders are not on for this phone.');
  return post(url, '/test', { endpoint: sub.endpoint });
}
