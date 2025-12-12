const { nowIso } = require('./utils/time');

function audit(db, actor, action, targetType, targetId, details) {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(actor || 'unknown', action, targetType, targetId || null, JSON.stringify(details || {}), nowIso());
}

module.exports = { audit };

