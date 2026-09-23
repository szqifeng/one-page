function changeSummary(before, after) {
  const items = (plan) => new Map((plan?.quarters || [{ id: 'legacy', workItems: plan?.workItems || [] }])
    .flatMap((quarter) => (quarter.workItems || []).map((item) => [`${quarter.id}/${item.id}`, item])));
  const oldItems = items(before);
  const newItems = items(after);
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [id, item] of newItems) {
    if (!oldItems.has(id)) added += 1;
    else if (JSON.stringify(oldItems.get(id)) !== JSON.stringify(item)) changed += 1;
  }
  for (const id of oldItems.keys()) if (!newItems.has(id)) removed += 1;
  const metadataChanged = ['people', 'permissionRoles', 'personnelTypes', 'iterations', 'quarter']
    .some((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
  return `事项新增 ${added}、修改 ${changed}、删除 ${removed}${metadataChanged ? '；人员或规划配置变更' : ''}`;
}

async function snapshot(client, teamId, kind, summary) {
  await client.query(
    `INSERT INTO planning_plan_backups
      (team_id, source_version, state, backup_date, backup_slot, kind, actor_name, summary)
     SELECT p.team_id, p.version, p.state, CURRENT_DATE, 'revision-' || p.version,
            $2, COALESCE(u.display_name, u.account, '系统'), $3
     FROM planning_plans p LEFT JOIN users u ON u.id = p.updated_by WHERE p.team_id = $1
     ON CONFLICT DO NOTHING`, [teamId, kind, summary],
  );
}
module.exports = { changeSummary, snapshot };
