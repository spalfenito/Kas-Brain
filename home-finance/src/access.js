// Optional: verify the Cloudflare Access login token on every API request,
// so the data can't be fetched even if someone finds a route Access doesn't cover.
let jwks = { keys: null, at: 0 };

const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function checkAccess(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return { ok: true, email: null };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, reason: 'Not signed in through Cloudflare Access' };
  const [h, p, s] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  if (!jwks.keys || Date.now() - jwks.at > 3600e3) {
    const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    jwks = { keys: (await res.json()).keys, at: Date.now() };
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'Unknown Access signing key' };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  const aud = [].concat(payload.aud);
  if (!valid || !aud.includes(env.ACCESS_AUD) || payload.exp * 1000 < Date.now()) return { ok: false, reason: 'Access token is invalid or expired' };
  return { ok: true, email: payload.email || null };
}
