import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initOkta, authRouter, requireAuth } from './auth.js';
import { esProxy } from './proxy.js';
import { mockEsRouter } from './mock-es.js';
import { loadGroupMap } from './group-map.js';
import { startRotation } from './rotate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(join(__dirname, 'dashboard.html'));
const architectureHtml = readFileSync(join(__dirname, '..', 'docs', 'architecture.html'));

let ready = false;
const app = express();
const PORT = process.env.PORT || 3333;
const MOCK_MODE = process.env.ES_URL === 'mock';

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }, // set true behind HTTPS
}));

// Auth routes (no auth required)
authRouter(app);

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
    user: req.session?.user ?? null,
    es: MOCK_MODE ? 'mock' : process.env.ES_URL,
    mock: MOCK_MODE,
  });
});

// ES routes -- mock or real proxy, both require auth
if (MOCK_MODE) {
  app.use('/_*', requireAuth);
  app.use('/:index/_search', requireAuth);
  mockEsRouter(app);
} else {
  app.use('/_*', requireAuth, esProxy());
}

app.listen(PORT, async () => {
  loadGroupMap();
  startRotation();
  await initOkta();
  ready = true;
  console.log(`es-okta-auth-proxy listening on http://localhost:${PORT}`);
  console.log(`ES mode: ${MOCK_MODE ? 'MOCK' : process.env.ES_URL}`);
});
