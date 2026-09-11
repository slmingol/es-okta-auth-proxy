import { createProxyMiddleware } from 'http-proxy-middleware';
import { resolveApiKey } from './group-map.js';

export function esProxy() {
  const startTimes = new WeakMap();

  return createProxyMiddleware({
    target: process.env.ES_URL,
    changeOrigin: true,
    secure: true,
    on: {
      proxyReq: (proxyReq, req) => {
        startTimes.set(req, Date.now());
        const groups = req.session?.user?.groups ?? [];
        const apiKey = resolveApiKey(groups);

        proxyReq.removeHeader('authorization');
        proxyReq.setHeader('Authorization', `ApiKey ${apiKey}`);

        if (req.session?.user?.email) {
          proxyReq.setHeader('X-Forwarded-User', req.session.user.email);
        }
        if (groups.length) {
          proxyReq.setHeader('X-Forwarded-Groups', groups.join(','));
        }
      },
      proxyRes: (proxyRes, req) => {
        const user = req.session?.user;
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          user: user?.email ?? '(anonymous)',
          groups: user?.groups ?? [],
          method: req.method,
          path: req.path,
          query: Object.keys(req.query ?? {}).length ? req.query : undefined,
          status: proxyRes.statusCode,
          ms: Date.now() - (startTimes.get(req) ?? Date.now()),
        }));
      },
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(502).json({ error: 'ES proxy error', detail: err.message });
      },
    },
  });
}
