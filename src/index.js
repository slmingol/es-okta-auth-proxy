import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { initOkta, authRouter, requireAuth } from './auth.js';
import { esProxy } from './proxy.js';

const app = express();
const PORT = process.env.PORT || 3000;

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
    es: process.env.ES_URL,
  });
});

// All ES API paths require auth, then proxy
app.use('/_*', requireAuth, esProxy());

app.listen(PORT, async () => {
  await initOkta();
  console.log(`es-okta-poc listening on http://localhost:${PORT}`);
  console.log(`ES target: ${process.env.ES_URL}`);
});
