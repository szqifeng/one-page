// Run against a disposable/development database: node server/collaboration-check.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool, savePlan, findSession } = require('./db');

async function main() {
  const teamId = `test-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    await pool.query('INSERT INTO teams (id, name, code) VALUES ($1, $1, $1)', [teamId]);
    await pool.query("INSERT INTO team_memberships (user_id, team_id, person_id, role_ids) VALUES ('user-admin', $1, 'p1', '[\"role-admin\"]')", [teamId]);
    await pool.query("INSERT INTO sessions (user_id, token_hash, active_team_id, expires_at) VALUES ('user-admin', $1, 'team-default', now() + interval '1 minute')", [hash]);
    assert.equal((await findSession(token, teamId)).teamId, teamId);
    assert.equal(await findSession(token, 'non-member-team'), null);
    await pool.query('UPDATE sessions SET active_team_id = $1 WHERE token_hash = $2', [teamId, hash]);
    assert.equal((await findSession(token, 'team-default')).teamId, 'team-default');
    const state = { quarter: 'test' };
    for (const version of [0, 1]) {
      const results = await Promise.allSettled([
        savePlan(teamId, 'user-admin', state, version),
        savePlan(teamId, 'user-admin', state, version),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'PLAN_VERSION_CONFLICT');
    }
    console.log('PASS: concurrent initialization, concurrent writes, explicit team isolation, membership denial');
  } finally {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
    await pool.query('DELETE FROM teams WHERE id = $1', [teamId]);
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
