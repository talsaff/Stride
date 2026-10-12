import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, vapidAuthorization, generateVapidKeys, b64urlDecode, b64urlEncode } from '../src/webpush.js';
import { buildAlerts, dueAlerts, validSubscription, validEndpoint } from '../src/alerts.js';
import { FUNNY } from '../../docs/js/engine/schedule.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Build an ECDH private CryptoKey from raw public + private scalars (base64url).
async function ecdhKeyPair(pubB64, privB64) {
  const pub = b64urlDecode(pubB64);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: privB64, ext: true };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey };
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), cat(info, new Uint8Array([1])))).slice(0, len);

// Independent receiver-side decryption (what the phone does).
async function decrypt(body, uaKeys, uaPublic, authSecret) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, secret, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ciphertext));
  assert.equal(plain.at(-1), 2, 'last-record delimiter');
  return dec.decode(plain.slice(0, -1));
}

describe('web push encryption (RFC 8291)', () => {
  test('matches the RFC 8291 appendix A example', async () => {
    const as = await ecdhKeyPair('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
    const sub = { endpoint: 'https://push.example.net/x', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
    const body = await encryptPayload(sub, 'When I grow up, I want to be a watermelon', { salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'), asKeys: as });
    assert.equal(b64urlEncode(body),
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });

  test('round-trips with a fresh receiver key', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) } };
    const msg = JSON.stringify({ title: 'Stride time 🏃', body: FUNNY[1] });
    const body = await encryptPayload(sub, msg);
    assert.equal(await decrypt(body, ua, uaPublic, auth), msg);
  });
});

describe('VAPID', () => {
  test('produces a verifiable ES256 JWT for the push service origin', async () => {
    const vapid = await generateVapidKeys();
    const now = Date.now();
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQ', vapid, 'https://github.com/talsaff/Stride', now);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    assert.ok(m);
    const claims = JSON.parse(dec.decode(b64urlDecode(m[2])));
    assert.equal(claims.aud, 'https://web.push.apple.com');
    assert.equal(claims.sub, 'https://github.com/talsaff/Stride');
    assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600);
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]), enc.encode(`${m[1]}.${m[2]}`));
    assert.equal(ok, true);
    assert.equal(b64urlDecode(m[4]).length, 65);
  });
});

describe('alerts', () => {
  const NOW = Date.parse('2026-10-12T12:00:00Z');
  const s = (h, id = `s${h}`) => ({ id, start: new Date(NOW + h * 3600e3).toISOString(), minutes: 20 });

  test('two alerts per future workout: 10 min before and at start', () => {
    const a = buildAlerts([s(2), s(30)], NOW);
    assert.equal(a.length, 4);
    assert.equal(a[0].at, NOW + 2 * 3600e3 - 10 * 60e3);
    assert.equal(a[1].at, NOW + 2 * 3600e3);
    assert.equal(a[0].title, 'Stride time in 10 min');
    assert.equal(a[1].title, 'Stride time 🏃');
  });

  test('notification texts come only from the built-in list, without a name', () => {
    for (const x of buildAlerts([s(1), s(5), s(9), s(20), s(40)], NOW)) {
      assert.ok(FUNNY.some((f) => x.body === f.replace(/\{min\}/g, '20').replace(/,? ?\{name\}/g, '').replace(/^Hey , /, 'Hey, ').replace(/\s+([.!?])/g, '$1')), x.body);
      assert.ok(!/\{|\}/.test(x.body));
    }
  });

  test('ignores junk, past and far-future sessions', () => {
    const a = buildAlerts([{ id: '', start: 'x' }, s(-5), s(24 * 40), { id: 'ok', start: new Date(NOW + 3600e3).toISOString(), minutes: 9999 }, null], NOW);
    assert.equal(a.length, 2);
    assert.equal(buildAlerts('nope', NOW).length, 0);
  });

  test('due alerts: on time or up to 15 min late, never early', () => {
    const a = buildAlerts([s(1)], NOW);
    assert.equal(dueAlerts(a, NOW).length, 0);
    assert.equal(dueAlerts(a, a[0].at).length, 1);
    assert.equal(dueAlerts(a, a[1].at + 14 * 60e3).length, 1);
    assert.equal(dueAlerts(a, a[1].at + 16 * 60e3).length, 0);
  });

  test('only real push services are accepted as endpoints', () => {
    assert.ok(validEndpoint('https://web.push.apple.com/QGuQ'));
    assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
    assert.ok(!validEndpoint('http://web.push.apple.com/x'));
    assert.ok(!validEndpoint('https://evil.example.com/web.push.apple.com'));
    assert.ok(!validEndpoint('https://web.push.apple.com.evil.com/x'));
    assert.ok(!validSubscription({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'short', auth: 'x' } }));
  });
});
