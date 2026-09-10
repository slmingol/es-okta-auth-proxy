import { Issuer, generators } from 'openid-client';

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
  // Store intended destination so we can redirect after login
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
      };
      req.session.idToken = tokenSet.id_token;
      const dest = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(dest);
    } catch (err) {
      console.error('OIDC callback error:', err.message);
      res.status(401).send('Authentication failed');
    }
  });

  app.get('/auth/logout', (req, res) => {
    const idToken = req.session.idToken;
    const port = process.env.PORT || 3344;
    req.session.destroy();
    const logoutUrl = new URL(`https://${process.env.OKTA_DOMAIN}/oauth2/default/v1/logout`);
    logoutUrl.searchParams.set('client_id', process.env.OKTA_CLIENT_ID);
    logoutUrl.searchParams.set('post_logout_redirect_uri', `http://localhost:${port}`);
    if (idToken) logoutUrl.searchParams.set('id_token_hint', idToken);
    res.redirect(logoutUrl.toString());
  });

  app.get('/auth/me', requireAuth, (req, res) => {
    res.json(req.session.user);
  });
}
