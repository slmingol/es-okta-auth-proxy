import { createProxyMiddleware } from 'http-proxy-middleware';

export function esProxy() {
  return createProxyMiddleware({
    target: process.env.ES_URL,
    changeOrigin: true,
    secure: true,
    on: {
      proxyReq: (proxyReq, req) => {
        // Replace any incoming auth with the service API key
        proxyReq.removeHeader('authorization');
        proxyReq.setHeader('Authorization', `ApiKey ${process.env.ES_API_KEY}`);

        // Forward caller identity as a header for ES audit logs
        if (req.session?.user?.email) {
          proxyReq.setHeader('X-Forwarded-User', req.session.user.email);
        }
      },
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(502).json({ error: 'ES proxy error', detail: err.message });
      },
    },
  });
}
