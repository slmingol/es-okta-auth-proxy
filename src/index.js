import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initOkta, authRouter, requireAuth } from './auth.js';
import { esProxy, kibanaProxy, bannerScript } from './proxy.js';
import { mockEsRouter } from './mock-es.js';
import { loadGroupMap, resolveServiceKey } from './group-map.js';
import { startRotation } from './rotate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(join(__dirname, 'dashboard.html'));
const { version: pkgVersion } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const tplVersionFile = '/tplConfig/version';
const version = existsSync(tplVersionFile)
  ? readFileSync(tplVersionFile, 'utf8').trim()
  : (process.env.APP_VERSION || pkgVersion);
const architectureHtml = readFileSync(join(__dirname, '..', 'docs', 'architecture.html'));

let ready = false;
const app = express();
const PORT = process.env.PORT || 3344;
const MOCK_MODE = process.env.ES_URL === 'mock';

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.COOKIE_SECURE === 'true' },
}));

// Auth routes (no auth required)
authRouter(app);

// Service accounts bypass all UI routes -- proxy everything to ES
const serviceProxy = esProxy();
app.use((req, res, next) => {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return next();
  const esApiKey = resolveServiceKey(authHeader.slice(7));
  if (!esApiKey) return next();
  req.serviceApiKey = esApiKey;
  return serviceProxy(req, res, next);
});

// Dashboard UI
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(dashboardHtml);
});

// Architecture doc
app.get('/docs/architecture', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(architectureHtml);
});

app.get('/live', (_, res) => res.json({ status: 'ok' }));
app.get('/ready', (_, res) => ready
  ? res.json({ status: 'ok' })
  : res.status(503).json({ status: 'starting' }));

// JSON status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    version,
    user: req.session?.user ?? null,
    es: MOCK_MODE ? 'mock' : process.env.ES_URL,
    mock: MOCK_MODE,
  });
});

// Kibana reverse proxy -- requires Okta auth
if (process.env.KIBANA_URL) {
  // Serves user identity to the injected <script src="/kibana-user.js"> tag in Kibana HTML
  app.get('/kibana-user.js', requireAuth, (req, res) => {
    res.type('application/javascript');
    res.send(bannerScript(req.session.user));
  });
  app.use('/kibana', requireAuth, kibanaProxy());
}

// ES routes -- mock or real proxy, both require auth
if (MOCK_MODE) {
  app.use('/_*wildcard', requireAuth);
  app.use('/:index/_search', requireAuth);
  mockEsRouter(app);
} else {
  const proxy = esProxy();
  app.use('/_*wildcard', requireAuth, proxy);
  // Index-named paths: /myindex/_search, /myindex/_doc/1, /myindex/_bulk, etc.
  app.use('/:index/_*wildcard', requireAuth, proxy);
}

app.listen(PORT, async () => {
  loadGroupMap();
  startRotation();
  await initOkta();
  ready = true;
  console.log(`es-okta-auth-proxy listening on http://localhost:${PORT}`);
  console.log(`ES mode: ${MOCK_MODE ? 'MOCK' : process.env.ES_URL}`);
});
