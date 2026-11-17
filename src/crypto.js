// Small WebCrypto helpers (Node 20+ and Workers): sealing the saved settings, comparing passwords
// and signing the session of the setup page.

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(secret) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('dtsync'), info: enc.encode('settings-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a JSON-serialisable value with AES-256-GCM under a key derived from `secret`. */
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret), enc.encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, iv: toB64(iv), data: toB64(data) });
}

/** Reverse of `seal`. Throws when the secret is wrong or the text was tampered with. */
export async function open(sealed, secret) {
  const { v, iv, data } = JSON.parse(sealed);
  if (v !== 1) throw new Error('unknown settings format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await keyFrom(secret), fromB64(data));
  return JSON.parse(dec.decode(plain));
}

/** Compare two strings without leaking where they differ. */
export async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

async function sessionKey(secret) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('dtsync'), info: enc.encode('session-v1') },
    base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
}

/**
 * A session token: "valid until <ms>", signed with a key derived from `secret`. Nothing is
 * stored for it, and it stops working when it runs out or when the secret changes.
 */
export async function signSession(secret, until) {
  const mac = await crypto.subtle.sign('HMAC', await sessionKey(secret), enc.encode(`session:${until}`));
  return `${until}.${toB64(mac).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Until when (ms) a session token is valid, or 0 when it was not signed with `secret`. */
export async function sessionUntil(token, secret) {
  const m = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!m) return 0;
  try {
    const mac = fromB64(m[2].replace(/-/g, '+').replace(/_/g, '/'));
    return (await crypto.subtle.verify('HMAC', await sessionKey(secret), mac, enc.encode(`session:${m[1]}`))) ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

export function randomPassword(bytes = 18) {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
