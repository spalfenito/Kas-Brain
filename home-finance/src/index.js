import { parseBudget } from './parse.js';
import { readSheetValues } from './google.js';
import { checkAccess } from './access.js';

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
      const key = new Request(`${url.origin}/api/budget#v1`);
      if (!url.searchParams.has('fresh')) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      try {
        const data = { ...parseBudget(await readSheetValues(env)), fetchedAt: new Date().toISOString() };
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
