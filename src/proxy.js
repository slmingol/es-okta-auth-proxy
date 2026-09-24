import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { resolveApiKey } from './group-map.js';

export function bannerScript(user) {
  const groups = JSON.stringify((user.groups ?? []).join(', ') || '(none)');
  const email = JSON.stringify(user.email ?? '');
  return `(function(){
var CSS='#es-proxy-banner{position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#e0e0e0;font:16px/1.4 monospace;padding:5px 14px;border-top:1px solid #444;display:flex;align-items:center;gap:16px;opacity:.93}#es-proxy-banner .g{color:#7ec8e3}#es-proxy-banner .sep{color:#555}#es-proxy-banner a{color:#f4a261;text-decoration:none;pointer-events:all}#es-proxy-banner a:hover{text-decoration:underline}#es-proxy-banner .spacer{flex:1}';
function mount(){
  if(document.getElementById('es-proxy-banner'))return;
  var s=document.createElement('style');s.textContent=CSS;document.head.appendChild(s);
  var d=document.createElement('div');d.id='es-proxy-banner';
  d.innerHTML='<span>user: '+${email}+'</span><span class="sep">|</span><span class="g">grp: '+${groups}+'</span><span class="spacer"></span><a href="/">Dashboard</a><span class="sep">|</span><a href="/auth/logout">Logout</a><span class="sep">|</span><a href="/auth/revoke">Full Logout (Okta)</a>';
  document.body.appendChild(d);
}
function observe(){mount();new MutationObserver(mount).observe(document.body,{childList:true,subtree:false});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe);else observe();
})();`;
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
        return html.replace('</head>', '<script src="/kibana-user.js"></script></head>');
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
    secure: process.env.ES_TLS_VERIFY !== 'false',
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
