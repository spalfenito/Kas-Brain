import { parseBudget } from './parse.js';
import { readSheetValues } from './google.js';
import { checkAccess } from './access.js';

// Income sources come from a secret so salaries never live in the (public) repo.
// INCOME_SOURCES is a JSON list: [{"key","name","amount","period":"year"|"month","withhold":26|"standard"}]
function incomeSources(env) {
  if (!env.INCOME_SOURCES) return null;
  let list;
  try { list = JSON.parse(env.INCOME_SOURCES); } catch { throw new Error('The INCOME_SOURCES secret is not valid JSON. See README.'); }
  if (!Array.isArray(list)) throw new Error('The INCOME_SOURCES secret must be a JSON list. See README.');
  return list.map((x, i) => ({
    key: String(x.key ?? `income-${i + 1}`),
    name: String(x.name ?? `Income ${i + 1}`),
    amount: Math.max(0, +x.amount || 0),
    period: x.period === 'month' ? 'month' : 'year',
    withhold: x.withhold === 'standard' ? 'standard' : Math.max(0, +x.withhold || 0),
    owner: x.owner ? String(x.owner) : undefined,
  }));
}

// PEOPLE: who's who and their colors, e.g. [{"name":"Alex","aliases":["AB"],"color":"blue"}].
function peopleList(env) {
  if (!env.PEOPLE) return null;
  let list;
  try { list = JSON.parse(env.PEOPLE); } catch { throw new Error('The PEOPLE secret is not valid JSON. See README.'); }
  if (!Array.isArray(list)) throw new Error('The PEOPLE secret must be a JSON list. See README.');
  return list.map((p) => ({
    name: String(p.name || ''),
    aliases: Array.isArray(p.aliases) ? p.aliases.map(String) : [],
    color: /^(blue|pink|teal|amber|purple|#[0-9a-f]{6})$/i.test(p.color || '') ? p.color : 'blue',
  })).filter((p) => p.name);
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const access = await checkAccess(request, env);
    if (!access.ok) return json({ error: access.reason }, 401);

    if (url.pathname === '/api/budget' && request.method === 'GET') {
      // Short edge cache so reloading the page doesn't hit Google every time.
      const cache = caches.default;
      const key = new Request(`${url.origin}/api/budget#v3`);
      if (!url.searchParams.has('fresh')) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      try {
        const data = { ...parseBudget(await readSheetValues(env)), incomeSources: incomeSources(env), people: peopleList(env), fetchedAt: new Date().toISOString() };
        const res = json(data, 200, { 'cache-control': 'private, max-age=60' });
        ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      } catch (err) {
        return json({ error: String(err.message || err) }, 502);
      }
    }

    if (url.pathname === '/api/settings') {
      if (!env.SETTINGS) return json({ shared: false, settings: null });
      if (request.method === 'GET') return json({ shared: true, settings: JSON.parse((await env.SETTINGS.get('settings')) || 'null') });
      if (request.method === 'PUT') {
        const text = await request.text();
        if (text.length > 20000) return json({ error: 'Settings too large' }, 413);
        const parsed = JSON.parse(text);
        await env.SETTINGS.put('settings', JSON.stringify({ ...parsed, savedBy: access.email, savedAt: new Date().toISOString() }));
        return json({ shared: true, ok: true });
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
