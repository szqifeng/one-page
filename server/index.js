const express = require('express');
const cookieParser = require('cookie-parser');
const {
  pool,
  initDatabase,
  login,
  loginWithOAuthProfile,
  findSession,
  logout,
  getPlan,
  savePlan,
  recordBehavior,
  listBehaviorLogs,
} = require('./db');

const app = express();
const port = Number(process.env.PORT || 3001);
const secureCookie = process.env.NODE_ENV === 'production';
const authMode = (process.env.AUTH_MODE || (process.env.OAUTH2_ENABLED === 'true' ? 'both' : 'local')).toLowerCase();
const passwordEnabled = authMode === 'local' || authMode === 'both';
const oauthEnabled = authMode === 'oauth2' || authMode === 'both';

function oauthSettings() {
  return {
    enabled: oauthEnabled,
    passwordEnabled,
    authorizationUrl: process.env.OAUTH2_AUTHORIZATION_URL || '',
    tokenUrl: process.env.OAUTH2_TOKEN_URL || '',
    profileUrl: process.env.OAUTH2_PROFILE_URL || '',
    clientId: process.env.OAUTH2_CLIENT_ID || '',
    redirectUri: process.env.OAUTH2_REDIRECT_URI || '',
    scopes: process.env.OAUTH2_SCOPES || 'openid profile email',
  };
}

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const startedAt = Date.now();
  res.on('finish', () => {
    if (!req.user || !req.path.startsWith('/api/')) return;
    recordBehavior({
      teamId: req.user.teamId,
      userId: req.user.id,
      action: `${req.method} ${req.path}`,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      ip: req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress,
      userAgent: req.get('user-agent'),
      metadata: { durationMs: Date.now() - startedAt },
    }).catch((error) => console.error('behavior log failed', error));
  });
  next();
});

function permissionKeys(plan, user) {
  const person = (plan?.people || []).find((candidate) => candidate.id === user.personId || candidate.account?.toLowerCase() === user.account?.toLowerCase());
  const roleIds = person?.permissionRoleIds || (Array.isArray(user.roleIds) ? user.roleIds : []);
  return new Set(
    (plan?.permissionRoles || [])
      .filter((role) => roleIds.includes(role.id))
      .flatMap((role) => role.permissions || []),
  );
}

function canEditPlan(plan, user, nextState) {
  const permissions = permissionKeys(plan, user);
  if (permissions.has('plan.edit_all')) return true;
  if (!permissions.has('plan.edit_own')) return false;
  if (!plan || !nextState) return false;
  if (JSON.stringify(plan.people) !== JSON.stringify(nextState.people)) return false;
  if (JSON.stringify(plan.iterations) !== JSON.stringify(nextState.iterations)) return false;
  if (JSON.stringify(plan.personnelTypes) !== JSON.stringify(nextState.personnelTypes)) return false;
  if (JSON.stringify(plan.permissionRoles) !== JSON.stringify(nextState.permissionRoles)) return false;
  if (plan.currentIterationId !== nextState.currentIterationId) return false;
  if (plan.currentUserId !== nextState.currentUserId) return false;
  if (plan.quarter !== nextState.quarter) return false;
  const oldItems = new Map((plan.workItems || []).map((item) => [item.id, item]));
  const newItems = new Map((nextState.workItems || []).map((item) => [item.id, item]));
  const effectivePersonId = (plan.people || []).find((person) => person.id === user.personId || person.account?.toLowerCase() === user.account?.toLowerCase())?.id || user.personId;
  const changedIds = new Set([...oldItems.keys(), ...newItems.keys()]);
  for (const id of changedIds) {
    const oldItem = oldItems.get(id);
    const newItem = newItems.get(id);
    if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
      if ((oldItem && oldItem.personId !== effectivePersonId) || (newItem && newItem.personId !== effectivePersonId)) return false;
    }
  }
  return true;
}

async function auth(req, res, next) {
  try {
    const user = await findSession(req.cookies.session);
    if (!user) return res.status(401).json({ message: '请先登录' });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'rolling-plan-api' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/config', (_req, res) => {
  const settings = oauthSettings();
  res.json({
    passwordEnabled,
    oauthEnabled: settings.enabled && Boolean(settings.authorizationUrl && settings.clientId),
  });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    if (!passwordEnabled) return res.status(403).json({ message: '当前系统仅支持企业单点登录' });
    const { account, password } = req.body || {};
    if (!account || !password) return res.status(400).json({ message: '请输入账号和密码' });
    const result = await login(account, password);
    if (!result) return res.status(401).json({ message: '账号或密码错误' });
    recordBehavior({ teamId: result.user.teamId, userId: result.user.id, action: '登录', method: req.method, path: req.path, statusCode: 200, ip: req.socket.remoteAddress, userAgent: req.get('user-agent') }).catch(() => undefined);
    res.cookie('session', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ user: result.user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/auth/oauth2/start', (req, res) => {
  const settings = oauthSettings();
  if (!settings.enabled || !settings.authorizationUrl || !settings.clientId) return res.status(404).send('OAuth2 未配置');
  const state = require('node:crypto').randomBytes(24).toString('base64url');
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 10 * 60 * 1000 });
  const redirectUri = settings.redirectUri || `${req.protocol}://${req.get('host')}/api/auth/oauth2/callback`;
  const url = new URL(settings.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', settings.scopes);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/api/auth/oauth2/callback', async (req, res, next) => {
  try {
    const settings = oauthSettings();
    if (!settings.enabled || !settings.tokenUrl || !settings.profileUrl || !settings.clientId || !process.env.OAUTH2_CLIENT_SECRET) {
      return res.redirect('/?authError=oauth_not_configured');
    }
    if (!req.query.code || !req.query.state || req.query.state !== req.cookies.oauth_state) {
      return res.redirect('/?authError=oauth_state_invalid');
    }
    const redirectUri = settings.redirectUri || `${req.protocol}://${req.get('host')}/api/auth/oauth2/callback`;
    const tokenResponse = await fetch(settings.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        client_id: settings.clientId,
        client_secret: process.env.OAUTH2_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResponse.ok) return res.redirect('/?authError=oauth_token_failed');
    const tokenBody = await tokenResponse.json();
    const accessToken = tokenBody.access_token;
    const profileResponse = await fetch(settings.profileUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (!profileResponse.ok) return res.redirect('/?authError=oauth_profile_failed');
    const oauthResult = await loginWithOAuthProfile(await profileResponse.json());
    if (!oauthResult) return res.redirect('/?authError=oauth_user_not_allowed');
    res.clearCookie('oauth_state');
    res.cookie('session', oauthResult.token, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.redirect('/');
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const user = await findSession(req.cookies.session);
    if (user) recordBehavior({ teamId: user.teamId, userId: user.id, action: '退出登录', method: req.method, path: req.path, statusCode: 204, ip: req.socket.remoteAddress, userAgent: req.get('user-agent') }).catch(() => undefined);
    await logout(req.cookies.session);
    res.clearCookie('session');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/plan', auth, async (req, res, next) => {
  try {
    const record = await getPlan(req.user.teamId);
    if (!record) return res.status(404).json({ message: '团队规划尚未初始化' });
    res.json({ plan: record.state, version: record.version, updatedAt: record.updated_at });
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit/behaviors', auth, async (req, res, next) => {
  try {
    const current = await getPlan(req.user.teamId);
    if (!current || !permissionKeys(current.state, req.user).has('permission.manage')) {
      return res.status(403).json({ message: '没有查看用户行为日志的权限' });
    }
    return res.json({ logs: await listBehaviorLogs(req.user.teamId, req.query.limit) });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/plan', auth, async (req, res, next) => {
  try {
    const { plan, version = 0 } = req.body || {};
    if (!plan || !Array.isArray(plan.people) || !Array.isArray(plan.workItems)) {
      return res.status(400).json({ message: '规划数据格式不正确' });
    }
    const current = await getPlan(req.user.teamId);
    if (!current && !permissionKeys(plan, req.user).has('plan.edit_all')) {
      return res.status(403).json({ message: '当前账号没有初始化团队规划的权限' });
    }
    if (current && !canEditPlan(current.state, req.user, plan)) {
      return res.status(403).json({ message: '当前账号没有保存这些规划变更的权限' });
    }
    const saved = await savePlan(req.user.teamId, req.user.id, plan, Number(version));
    return res.json({ version: saved.version, updatedAt: saved.updated_at });
  } catch (error) {
    if (error.code === 'PLAN_VERSION_CONFLICT') {
      return res.status(409).json({ message: '规划已被其他人修改，请刷新后重试' });
    }
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: '服务器内部错误' });
});

initDatabase()
  .then(() => app.listen(port, () => console.log(`rolling-plan-api listening on :${port}`)))
  .catch((error) => {
    console.error('database initialization failed', error);
    process.exit(1);
  });
