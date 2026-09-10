import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { initOkta, authRouter, requireAuth } from './auth.js';
import { esProxy } from './proxy.js';
import { mockEsRouter } from './mock-es.js';

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

// Root health check
app.get('/', (req, res) => {
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
  await initOkta();
  console.log(`es-okta-auth-proxy listening on http://localhost:${PORT}`);
  console.log(`ES mode: ${MOCK_MODE ? 'MOCK' : process.env.ES_URL}`);
});
