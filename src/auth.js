import { Issuer, generators } from 'openid-client';
import { resolveServiceKey } from './group-map.js';

let oidcClient;

export async function initOkta() {
  const issuer = await Issuer.discover(
    `https://${process.env.OKTA_DOMAIN}/oauth2/default`
  );
  oidcClient = new issuer.Client({
    client_id: process.env.OKTA_CLIENT_ID,
    client_secret: process.env.OKTA_CLIENT_SECRET,
    redirect_uris: [process.env.OKTA_REDIRECT_URI],
    response_types: ['code'],
  });
  return oidcClient;
}

export function getClient() {
  return oidcClient;
}

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();

  // Service accounts: Bearer token mapped to an ES API key in group-map _services
  const authHeader = req.headers.authorization ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const esApiKey = resolveServiceKey(token);
    if (esApiKey) {
      req.serviceApiKey = esApiKey;
      return next();
    }
  }

  // API clients get 401; browsers get redirected to Okta
  if (req.accepts('json') && !req.accepts('html')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

export function authRouter(app) {
  app.get('/auth/login', (req, res) => {
    const state = generators.state();
    const nonce = generators.nonce();
    req.session.oidcState = state;
    req.session.oidcNonce = nonce;

    const url = oidcClient.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
    });
    res.redirect(url);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const params = oidcClient.callbackParams(req);
      const tokenSet = await oidcClient.callback(
        process.env.OKTA_REDIRECT_URI,
        params,
        { state: req.session.oidcState, nonce: req.session.oidcNonce }
      );
      const claims = tokenSet.claims();
      req.session.user = {
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        groups: claims.groups ?? [],
      };
      req.session.idToken = tokenSet.id_token;
      req.session.accessToken = tokenSet.access_token;
      const dest = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(dest);
    } catch (err) {
      console.error('OIDC callback error:', err.message);
      res.status(401).send('Authentication failed');
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  // Full logout: revoke access token + kill Okta global session
  app.get('/auth/revoke', async (req, res) => {
    const idToken = req.session.idToken;
    const accessToken = req.session.accessToken;
    // Revoke access token so it can't be reused
    if (accessToken) {
      try {
        await oidcClient.revoke(accessToken, 'access_token');
      } catch (err) {
        console.warn('Token revocation failed (non-fatal):', err.message);
      }
    }

    req.session.destroy();

    // Redirect to Okta end_session to kill the SSO cookie
    const endSession = new URL(`https://${process.env.OKTA_DOMAIN}/oauth2/default/v1/logout`);
    endSession.searchParams.set('client_id', process.env.OKTA_CLIENT_ID);
    if (idToken) endSession.searchParams.set('id_token_hint', idToken);
    // post_logout_redirect_uri must be registered in Okta app Sign-out redirect URIs
    if (process.env.OKTA_POST_LOGOUT_URI) {
      endSession.searchParams.set('post_logout_redirect_uri', process.env.OKTA_POST_LOGOUT_URI);
    }
    res.redirect(endSession.toString());
  });

  app.get('/auth/me', requireAuth, (req, res) => {
    res.json(req.session.user);
  });
}
