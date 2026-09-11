export function accessLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const user = req.session?.user;
    // only log ES API calls, skip auth/status/dashboard/docs
    const skip = ['/', '/status', '/auth', '/docs'].some(p => req.path === p || req.path.startsWith(p + '/'));
    if (skip) return;

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      user: user?.email ?? '(anonymous)',
      groups: user?.groups ?? [],
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length ? req.query : undefined,
      status: res.statusCode,
      ms: Date.now() - start,
    }));
  });

  next();
}
