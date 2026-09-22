import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { resolveApiKey } from './group-map.js';

const BANNER_CSS = `
#es-proxy-banner {
  position: fixed;
  bottom: 0;
  right: 0;
  z-index: 999999;
  background: #1a1a2e;
  color: #e0e0e0;
  font: 12px/1.4 monospace;
  padding: 4px 10px;
  border-top-left-radius: 6px;
  border: 1px solid #444;
  border-right: none;
  border-bottom: none;
  opacity: 0.9;
  pointer-events: none;
}
#es-proxy-banner .groups { color: #7ec8e3; font-size: 11px; }
`;

function buildBanner(user) {
  const groups = (user.groups ?? []).join(', ') || '(none)';
  return `
<style>${BANNER_CSS}</style>
<div id="es-proxy-banner">
  <div>${user.email}</div>
  <div class="groups">${groups}</div>
</div>`;
}

export function kibanaProxy() {
  return createProxyMiddleware({
    target: process.env.KIBANA_URL,
    changeOrigin: true,
    autoRewrite: true,
    selfHandleResponse: true,
    // Express strips /kibana before this middleware sees the path -- put it back
    pathRewrite: (path) => '/kibana' + (path || '/'),
    on: {
      proxyRes: responseInterceptor(async (buffer, proxyRes, req) => {
        const ct = proxyRes.headers['content-type'] ?? '';
        if (!ct.includes('text/html')) return buffer;
        const user = req.session?.user;
        if (!user) return buffer;
        const html = buffer.toString('utf8');
        return html.replace('</body>', buildBanner(user) + '</body>');
      }),
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
