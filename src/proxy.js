import { createProxyMiddleware } from 'http-proxy-middleware';
import { resolveApiKey } from './group-map.js';

export function kibanaProxy() {
  return createProxyMiddleware({
    target: process.env.KIBANA_URL,
    changeOrigin: true,
    autoRewrite: true,
    // Express strips /kibana before this middleware sees the path -- put it back
    pathRewrite: (path) => '/kibana' + (path || '/'),
    on: {
      error: (err, req, res) => {
        console.error('Kibana proxy error:', err.message);
        res.status(502).json({ error: 'Kibana proxy error', detail: err.message });
      },
    },
  });
}

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
        // Service account token takes priority over session-resolved key
        const apiKey = req.serviceApiKey ?? resolveApiKey(groups);
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
        // Kibana's ES client requires this header to accept the response
        proxyRes.headers['x-elastic-product'] = 'Elasticsearch';

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
