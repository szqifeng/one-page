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
  listPlanVersions,
  getPlanVersion,
  createScheduledBackups,
} = require('./db');

const app = express();
const port = Number(process.env.PORT || 3001);
const secureCookie = process.env.NODE_ENV === 'production';
const authMode = (process.env.AUTH_MODE || (process.env.OAUTH2_ENABLED === 'true' ? 'both' : 'local')).toLowerCase();
const passwordEnabled = authMode === 'local' || authMode === 'both';
const oauthEnabled = authMode === 'oauth2' || authMode === 'both';
const backupTimezone = process.env.BACKUP_TIMEZONE || 'Asia/Shanghai';
const defaultBackupTimes = ['02:00', '10:00', '18:00'];
const configuredBackupTimes = [...new Set((process.env.BACKUP_TIMES || defaultBackupTimes.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))];
const backupTimes = (configuredBackupTimes.length === 3 ? configuredBackupTimes : defaultBackupTimes).sort();

function zonedClock() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: backupTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function runScheduledBackups() {
  const now = zonedClock();
  await createScheduledBackups(now.date, backupTimes.filter((time) => time <= now.time));
}

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

function normalizeStoredPlan(state) {
  const normalizeItems = (items = []) => items.map((item) => ({
    ...item,
    progress: Number.isFinite(item.progress) ? Math.min(100, Math.max(0, item.progress)) : 0,
  }));
  const year = Number(state.quarter?.match(/\d{4}/)?.[0]) || new Date().getFullYear();
  const legacyQuarter = {
    id: `quarter-${year}-legacy`,
    name: state.quarter || `${year} 第1季度`,
    year,
    currentIterationId: state.currentIterationId,
    iterations: state.iterations || [],
    workItems: normalizeItems(state.workItems),
  };
  const quarters = (Array.isArray(state.quarters) && state.quarters.length ? state.quarters : [legacyQuarter])
    .map((quarter) => ({ ...quarter, workItems: normalizeItems(quarter.workItems) }));
  const active = quarters.find((quarter) => quarter.id === state.activeQuarterId) || quarters[0];
  return {
    ...state,
    activeQuarterId: active.id,
    quarter: active.name,
    currentIterationId: active.currentIterationId,
    iterations: active.iterations,
    workItems: active.workItems,
    quarters,
  };
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
  if (plan.quarter !== nextState.quarter) return false;
  if (plan.activeQuarterId !== nextState.activeQuarterId) return false;
  const oldQuarters = plan.quarters || [];
  const newQuarters = nextState.quarters || [];
  if (oldQuarters.length !== newQuarters.length) return false;
  const oldQuarterMap = new Map(oldQuarters.map((quarter) => [quarter.id, quarter]));
  for (const nextQuarter of newQuarters) {
    const oldQuarter = oldQuarterMap.get(nextQuarter.id);
    if (!oldQuarter) return false;
    const { workItems: oldQuarterItems = [], ...oldQuarterMetadata } = oldQuarter;
    const { workItems: newQuarterItems = [], ...newQuarterMetadata } = nextQuarter;
    if (JSON.stringify(oldQuarterMetadata) !== JSON.stringify(newQuarterMetadata)) return false;
    if (nextQuarter.id !== plan.activeQuarterId && JSON.stringify(oldQuarterItems) !== JSON.stringify(newQuarterItems)) return false;
  }
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

function countWorkdays(startDate, endDate) {
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || end < cursor) return 0;
  let count = 0;
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function validQuarterConfiguration(plan) {
  if (!Array.isArray(plan.quarters) || plan.quarters.length === 0) return false;
  const ids = new Set();
  const names = new Set();
  const yearCounts = new Map();
  const yearRanges = new Map();
  for (const quarter of plan.quarters) {
    if (!quarter?.id || !quarter?.name || !Number.isInteger(quarter.year)) return false;
    if (!Array.isArray(quarter.iterations) || quarter.iterations.length === 0 || !Array.isArray(quarter.workItems)) return false;
    const normalizedName = quarter.name.trim().toLowerCase();
    if (ids.has(quarter.id) || names.has(normalizedName)) return false;
    ids.add(quarter.id);
    names.add(normalizedName);
    yearCounts.set(quarter.year, (yearCounts.get(quarter.year) || 0) + 1);
    if (yearCounts.get(quarter.year) > 3) return false;
    if (!quarter.iterations.some((iteration) => iteration.id === quarter.currentIterationId)) return false;
    if (quarter.workItems.some((item) => !Number.isFinite(item.progress) || item.progress < 0 || item.progress > 100)) return false;
    const iterationWorkdays = new Map(quarter.iterations.map((iteration) => [
      iteration.id,
      countWorkdays(iteration.startDate, iteration.endDate),
    ]));
    if ([...iterationWorkdays.values()].some((workdays) => workdays === 0)) return false;
    if (quarter.workItems.some((item) => Object.entries(item.allocations || {}).some(([iterationId, allocation]) =>
      !iterationWorkdays.has(iterationId)
      || !Number.isFinite(allocation.days)
      || allocation.days < 0
      || allocation.days > iterationWorkdays.get(iterationId)))) return false;
    const sortedIterations = quarter.iterations.slice().sort((left, right) => left.startDate.localeCompare(right.startDate));
    const startDate = sortedIterations[0]?.startDate;
    const endDate = sortedIterations.at(-1)?.endDate;
    if (!startDate || !endDate || Number(startDate.slice(0, 4)) !== quarter.year || Number(endDate.slice(0, 4)) !== quarter.year) return false;
    const ranges = yearRanges.get(quarter.year) || [];
    if (ranges.some((range) => startDate <= range.endDate && endDate >= range.startDate)) return false;
    ranges.push({ startDate, endDate });
    yearRanges.set(quarter.year, ranges);
  }
  const active = plan.quarters.find((quarter) => quarter.id === plan.activeQuarterId);
  return Boolean(active
    && active.name === plan.quarter
    && active.currentIterationId === plan.currentIterationId
    && JSON.stringify(active.iterations) === JSON.stringify(plan.iterations)
    && JSON.stringify(active.workItems) === JSON.stringify(plan.workItems));
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
    res.json({ plan: normalizeStoredPlan(record.state), version: record.version, updatedAt: record.updated_at });
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

app.get('/api/plan/versions', auth, async (req, res, next) => {
  try {
    const current = await getPlan(req.user.teamId);
    if (!current || !permissionKeys(current.state, req.user).has('plan.edit_all')) {
      return res.status(403).json({ message: '没有查看规划版本的权限' });
    }
    return res.json({ versions: await listPlanVersions(req.user.teamId, 50), currentVersion: current.version });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/plan/versions/:backupId/restore', auth, async (req, res, next) => {
  try {
    const current = await getPlan(req.user.teamId);
    if (!current || !permissionKeys(current.state, req.user).has('plan.edit_all')) {
      return res.status(403).json({ message: '没有恢复规划版本的权限' });
    }
    const source = await getPlanVersion(req.user.teamId, Number(req.params.backupId));
    if (!source) return res.status(404).json({ message: '规划备份不存在' });
    const restoredPlan = { ...normalizeStoredPlan(source.state), currentUserId: req.user.personId };
    const saved = await savePlan(req.user.teamId, req.user.id, restoredPlan, current.version);
    return res.json({ plan: restoredPlan, version: saved.version, updatedAt: saved.updated_at });
  } catch (error) {
    if (error.code === 'PLAN_VERSION_CONFLICT') return res.status(409).json({ message: '规划已被其他人修改，请刷新后重试' });
    return next(error);
  }
});

app.put('/api/plan', auth, async (req, res, next) => {
  try {
    const { plan, version = 0 } = req.body || {};
    if (!plan || !Array.isArray(plan.people) || !Array.isArray(plan.workItems)) {
      return res.status(400).json({ message: '规划数据格式不正确' });
    }
    if (!validQuarterConfiguration(plan)) {
      return res.status(400).json({ message: '规划配置无效；每年最多 3 个季度，进度须为 0–100%，事项投入不得超过迭代工作日' });
    }
    const current = await getPlan(req.user.teamId);
    if (!current && !permissionKeys(plan, req.user).has('plan.edit_all')) {
      return res.status(403).json({ message: '当前账号没有初始化团队规划的权限' });
    }
    if (current && !canEditPlan(normalizeStoredPlan(current.state), req.user, plan)) {
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
  .then(async () => {
    await runScheduledBackups();
    setInterval(() => runScheduledBackups().catch((error) => console.error('scheduled backup failed', error)), 60 * 1000);
    app.listen(port, () => console.log(`rolling-plan-api listening on :${port}; backups ${backupTimes.join(',')} ${backupTimezone}`));
  })
  .catch((error) => {
    console.error('database initialization failed', error);
    process.exit(1);
  });
