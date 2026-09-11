import { createProxyMiddleware } from 'http-proxy-middleware';
import { resolveApiKey } from './group-map.js';

export function esProxy() {
  return createProxyMiddleware({
    target: process.env.ES_URL,
    changeOrigin: true,
    secure: true,
    on: {
      proxyReq: (proxyReq, req) => {
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
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(502).json({ error: 'ES proxy error', detail: err.message });
      },
    },
  });
}
