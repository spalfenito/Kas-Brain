// Reads a private Google Sheet with a service account (no public sharing needed).
let cached = { token: null, exp: 0 };

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  )}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google sign-in failed: ${body.error_description || body.error || res.status}`);
  cached = { token: body.access_token, exp: now + body.expires_in };
  return cached.token;
}

export async function readSheetValues(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.SHEET_ID) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON or SHEET_ID secret. See README.');
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const range = encodeURIComponent(`'${env.SHEET_TAB || 'the budget'}'!A1:Z200`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${range}`, {
    headers: { authorization: `Bearer ${await accessToken(sa)}` },
  });
  const body = await res.json();
  if (!res.ok) {
    const hint = res.status === 403 ? ` Share the sheet (Viewer) with ${sa.client_email}.` : '';
    throw new Error(`Google Sheets error ${res.status}: ${body.error?.message || ''}${hint}`);
  }
  return body.values || [];
}
