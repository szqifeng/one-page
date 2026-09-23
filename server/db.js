const crypto = require('node:crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://planner:planner@localhost:5432/rolling_plan',
  max: Number(process.env.DB_POOL_SIZE || 10),
});

const SESSION_DAYS = 7;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function initDatabase() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id),
      person_id TEXT NOT NULL,
      account TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (team_id, account)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS team_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL,
      role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS planning_plans (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      quarter TEXT NOT NULL,
      state JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS planning_plan_backups (
      id BIGSERIAL PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      source_version INTEGER NOT NULL,
      state JSONB NOT NULL,
      backup_date DATE NOT NULL,
      backup_slot TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (team_id, backup_date, backup_slot)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      version INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS user_behavior_logs (
      id BIGSERIAL PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS user_behavior_logs_team_created_idx
      ON user_behavior_logs (team_id, created_at DESC);
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_team_id TEXT REFERENCES teams(id)`);
  await pool.query(
    `INSERT INTO teams (id, name, code) VALUES ('team-default', $1, 'DEFAULT') ON CONFLICT (id) DO NOTHING`,
    [process.env.DEFAULT_TEAM_NAME || '规划团队'],
  );
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe123!';
  const adminHash = hashPassword(adminPassword);
  await pool.query(
    `INSERT INTO users (id, team_id, person_id, account, display_name, password_hash, role_ids)
     VALUES ('user-admin', 'team-default', 'p1', 'admin', '系统管理员', $1, '["role-admin"]'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [adminHash],
  );
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, person_id, role_ids)
     SELECT id, team_id, person_id, role_ids FROM users
     ON CONFLICT (user_id, team_id) DO NOTHING`,
  );
  await pool.query(
    `UPDATE sessions s SET active_team_id = u.team_id
     FROM users u WHERE s.user_id = u.id AND s.active_team_id IS NULL`,
  );
}

async function login(account, password) {
  const result = await pool.query(
    `SELECT u.*, t.name AS team_name, t.code AS team_code
     FROM users u JOIN teams t ON t.id = u.team_id
     WHERE lower(u.account) = lower($1) AND u.status = 'active' AND t.status = 'active'`,
    [account],
  );
  const user = result.rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const token = await createSession(user);
  return { token, user: publicUser(user) };
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, active_team_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 day'))`,
    [user.id, hashToken(token), user.team_id, SESSION_DAYS],
  );
  await pool.query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
  return token;
}

async function loginWithOAuthProfile(profile) {
  const configuredField = process.env.OAUTH2_EMAIL_FIELD || 'email';
  const email = configuredField.split('.').reduce((value, key) => value?.[key], profile);
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const normalizedEmail = email.trim().toLowerCase();
  const account = normalizedEmail.split('@')[0];
  const displayName = String(profile.name || profile.display_name || account).trim() || account;
  const teamId = process.env.OAUTH2_TEAM_ID || 'team-default';
  const existing = await pool.query(
    `SELECT u.*, t.name AS team_name, t.code AS team_code
     FROM users u JOIN teams t ON t.id = u.team_id
     WHERE u.team_id = $1 AND (lower(u.email) = $2 OR lower(u.account) = $3)`,
    [teamId, normalizedEmail, account],
  );
  let user = existing.rows[0];
  if (!user && process.env.OAUTH2_AUTO_PROVISION === 'true') {
    const id = `user-${crypto.randomUUID()}`;
    const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const inserted = await pool.query(
      `INSERT INTO users (id, team_id, person_id, account, display_name, email, password_hash, role_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *, (SELECT name FROM teams WHERE id = $2) AS team_name, (SELECT code FROM teams WHERE id = $2) AS team_code`,
      [id, teamId, `person-${crypto.randomUUID()}`, account, displayName, normalizedEmail, passwordHash, JSON.stringify([process.env.OAUTH2_DEFAULT_ROLE_ID || 'role-no-access'])],
    );
    user = inserted.rows[0];
    await pool.query(
      `INSERT INTO team_memberships (user_id, team_id, person_id, role_ids)
       VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (user_id, team_id) DO NOTHING`,
      [user.id, teamId, user.person_id, JSON.stringify(user.role_ids)],
    );
  }
  if (!user) return null;
  await pool.query(`UPDATE users SET email = COALESCE(email, $2), display_name = $3, updated_at = now() WHERE id = $1`, [user.id, normalizedEmail, displayName]);
  const token = await createSession(user);
  return { token, user: publicUser({ ...user, email: normalizedEmail, display_name: displayName }) };
}

async function findSession(token, teamId = null) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT s.id AS session_id, s.expires_at, u.*,
            t.id AS active_team_id, t.name AS team_name, t.code AS team_code,
            tm.person_id AS membership_person_id, tm.role_ids AS membership_role_ids
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN teams t ON t.id = COALESCE($2::text, s.active_team_id, u.team_id)
     JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = t.id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active' AND t.status = 'active'`,
    [hashToken(token), teamId],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

async function logout(token) {
  if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

function publicUser(user) {
  return {
    id: user.id,
    teamId: user.active_team_id || user.team_id,
    teamName: user.team_name,
    teamCode: user.team_code,
    personId: user.membership_person_id || user.person_id,
    account: user.account,
    displayName: user.display_name,
    email: user.email || null,
    roleIds: user.membership_role_ids || user.role_ids,
  };
}

async function listTeams(userId) {
  const result = await pool.query(
    `SELECT t.id, t.name, t.code, tm.role_ids AS "roleIds"
     FROM team_memberships tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = $1 AND t.status = 'active'
     ORDER BY tm.created_at, t.name`,
    [userId],
  );
  return result.rows;
}

async function createTeam(user, name, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const teamId = `team-${crypto.randomUUID()}`;
    const created = await client.query(
      `INSERT INTO teams (id, name, code) VALUES ($1, $2, $3)
       RETURNING id, name, code`,
      [teamId, name, code],
    );
    await client.query(
      `INSERT INTO team_memberships (user_id, team_id, person_id, role_ids)
       VALUES ($1, $2, 'p1', '["role-admin"]'::jsonb)`,
      [user.id, teamId],
    );
    await client.query(
      `INSERT INTO audit_logs (team_id, user_id, action, resource, metadata)
       VALUES ($1, $2, 'create', 'team', $3::jsonb)`,
      [teamId, user.id, JSON.stringify({ name, code })],
    );
    await client.query('COMMIT');
    return { ...created.rows[0], roleIds: ['role-admin'] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function switchSessionTeam(token, userId, teamId) {
  if (!token) return false;
  const result = await pool.query(
    `UPDATE sessions s SET active_team_id = $3
     WHERE s.token_hash = $1 AND s.user_id = $2 AND s.expires_at > now()
       AND EXISTS (
         SELECT 1 FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
         WHERE tm.user_id = $2 AND tm.team_id = $3 AND t.status = 'active'
       )`,
    [hashToken(token), userId, teamId],
  );
  return result.rowCount > 0;
}

async function getPlan(teamId) {
  const result = await pool.query(
    `SELECT state, version, updated_at FROM planning_plans WHERE team_id = $1`,
    [teamId],
  );
  return result.rows[0] || null;
}

async function savePlan(teamId, userId, state, expectedVersion) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE planning_plans
       SET quarter = $3, state = $4::jsonb, version = version + 1, updated_by = $2, updated_at = now()
       WHERE team_id = $1 AND version = $5
       RETURNING version, updated_at`,
      [teamId, userId, state.quarter, JSON.stringify(state), expectedVersion],
    );
    if (updated.rowCount === 0) {
      const existing = await client.query(`SELECT version FROM planning_plans WHERE team_id = $1`, [teamId]);
      if (existing.rowCount === 0 && expectedVersion === 0) {
        const inserted = await client.query(
          `INSERT INTO planning_plans (team_id, quarter, state, version, updated_by)
           VALUES ($1, $2, $3::jsonb, 1, $4) ON CONFLICT (team_id) DO NOTHING RETURNING version, updated_at`,
          [teamId, state.quarter, JSON.stringify(state), userId],
        );
        if (inserted.rowCount) {
          await client.query('COMMIT');
          return inserted.rows[0];
        }
      }
      const error = new Error('PLAN_VERSION_CONFLICT');
      error.code = 'PLAN_VERSION_CONFLICT';
      throw error;
    }
    await client.query(
      `INSERT INTO audit_logs (team_id, user_id, action, resource, version, metadata)
       VALUES ($1, $2, 'update', 'planning_plan', $3, $4::jsonb)`,
      [teamId, userId, updated.rows[0].version, JSON.stringify({ quarter: state.quarter })],
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordBehavior(log) {
  await pool.query(
    `INSERT INTO user_behavior_logs
      (team_id, user_id, action, method, path, status_code, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      log.teamId,
      log.userId || null,
      log.action,
      log.method,
      log.path,
      log.statusCode,
      log.ip || null,
      log.userAgent || null,
      JSON.stringify(log.metadata || {}),
    ],
  );
}

async function listBehaviorLogs(teamId, limit = 200) {
  const result = await pool.query(
    `SELECT l.id, l.action, l.method, l.path, l.status_code AS "statusCode",
            l.ip, l.user_agent AS "userAgent", l.metadata, l.created_at AS "createdAt",
            u.account, u.display_name AS "displayName"
     FROM user_behavior_logs l
     LEFT JOIN users u ON u.id = l.user_id
     WHERE l.team_id = $1
     ORDER BY l.created_at DESC
     LIMIT $2`,
    [teamId, Math.min(Math.max(Number(limit) || 200, 1), 500)],
  );
  return result.rows;
}

async function listPlanVersions(teamId, limit = 50) {
  const result = await pool.query(
    `SELECT b.id, b.source_version AS "sourceVersion", b.backup_date AS "backupDate",
            b.backup_slot AS "backupSlot", b.created_at AS "createdAt"
     FROM planning_plan_backups b
     WHERE b.team_id = $1
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT $2`,
    [teamId, Math.min(Math.max(Number(limit) || 50, 1), 50)],
  );
  return result.rows;
}

async function getPlanVersion(teamId, backupId) {
  const result = await pool.query(
    `SELECT state, source_version AS "sourceVersion" FROM planning_plan_backups WHERE team_id = $1 AND id = $2`,
    [teamId, backupId],
  );
  return result.rows[0] || null;
}

async function createScheduledBackups(backupDate, backupSlots) {
  for (const backupSlot of backupSlots) {
    await pool.query(
      `INSERT INTO planning_plan_backups (team_id, source_version, state, backup_date, backup_slot)
       SELECT team_id, version, state, $1::date, $2 FROM planning_plans
       ON CONFLICT (team_id, backup_date, backup_slot) DO NOTHING`,
      [backupDate, backupSlot],
    );
  }
}

module.exports = {
  pool,
  initDatabase,
  login,
  loginWithOAuthProfile,
  findSession,
  logout,
  listTeams,
  createTeam,
  switchSessionTeam,
  getPlan,
  savePlan,
  recordBehavior,
  listBehaviorLogs,
  listPlanVersions,
  getPlanVersion,
  createScheduledBackups,
};
