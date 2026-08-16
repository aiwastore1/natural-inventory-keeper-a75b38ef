/** Password hashing helpers (SHA-256 + random salt) — no plain text ever stored. */

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSalt(bytes = 12) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

export async function hashPassword(password, salt = randomSalt()) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return { salt, hash: toHex(digest) };
}

export async function verifyPassword(password, salt, hash) {
  const out = await hashPassword(password, salt);
  return out.hash === hash;
}
