/**
 * Enterprise Config Center Backend (Express + SQLite)
 * Features: ConfigType, ConfigField (per version), ConfigVersion lifecycle,
 * ConfigData, diff, publish/rollback, audit, config fetch API.
 * Auth model is simplified: pass X-User and X-Role (admin/appOwner/viewer) headers.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'config-center.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
initSchema();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --- Helpers -------------------------------------------------------------- //
const now = () => new Date().toISOString();
const isAdmin = (req) => (req.headers['x-role'] || '').toLowerCase() === 'admin';

function requireRole(req, res, allowed) {
  const role = (req.headers['x-role'] || '').toLowerCase();
  if (!allowed.includes(role)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

function audit(actor, action, targetType, targetId, details) {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(actor || 'unknown', action, targetType, targetId || null, JSON.stringify(details || {}), now());
}

function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
  );
  CREATE TABLE IF NOT EXISTS config_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_code TEXT NOT NULL,
    type_name TEXT NOT NULL,
    app_code TEXT NOT NULL,
    biz_domain TEXT,
    env TEXT DEFAULT 'prod',
    description TEXT,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now')),
    UNIQUE(app_code, type_code, env)
  );
  CREATE TABLE IF NOT EXISTS config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL,
    version_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | PENDING_RELEASE | RELEASED | ARCHIVED
    description TEXT,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    release_user TEXT,
    release_time TEXT,
    FOREIGN KEY (type_id) REFERENCES config_types(id) ON DELETE CASCADE,
    UNIQUE(type_id, version_no)
  );
  CREATE TABLE IF NOT EXISTS config_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    field_code TEXT NOT NULL,
    field_name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    max_length INTEGER,
    required INTEGER DEFAULT 0,
    default_value TEXT,
    validate_rule TEXT,
    enum_options TEXT,
    unique_key_part INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    create_time TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (type_id) REFERENCES config_types(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES config_versions(id) ON DELETE CASCADE,
    UNIQUE(version_id, field_code)
  );
  CREATE TABLE IF NOT EXISTS config_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    key_value TEXT NOT NULL,
    data_json TEXT NOT NULL,
    status TEXT DEFAULT 'ENABLED',
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (type_id) REFERENCES config_types(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES config_versions(id) ON DELETE CASCADE,
    UNIQUE(version_id, key_value)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT,
    action TEXT,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  `);
}

// --- Config Types CRUD ---------------------------------------------------- //
app.get('/api/types', (req, res) => {
  const { appCode, env } = req.query;
  let sql = `SELECT * FROM config_types WHERE 1=1`;
  const params = [];
  if (appCode) { sql += ` AND app_code = ?`; params.push(appCode); }
  if (env) { sql += ` AND env = ?`; params.push(env); }
  sql += ` ORDER BY sort_order, id DESC`;
  res.json(db.prepare(sql).all(params));
});

app.post('/api/types', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const body = req.body || {};
  const stmt = db.prepare(`
    INSERT INTO config_types (type_code, type_name, app_code, biz_domain, env, description, enabled, sort_order, create_user, update_user, update_time)
    VALUES (@type_code, @type_name, @app_code, @biz_domain, @env, @description, @enabled, @sort_order, @actor, @actor, @now)
  `);
  try {
    const info = stmt.run({
      type_code: body.typeCode,
      type_name: body.typeName,
      app_code: body.appCode,
      biz_domain: body.bizDomain || null,
      env: body.env || 'prod',
      description: body.description || '',
      enabled: body.enabled ? 1 : 0,
      sort_order: body.sortOrder || 0,
      actor: req.headers['x-user'] || 'system',
      now: now()
    });
    audit(req.headers['x-user'], 'CREATE_TYPE', 'ConfigType', info.lastInsertRowid, body);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/types/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const body = req.body || {};
  const info = db.prepare(`
    UPDATE config_types
    SET type_name = COALESCE(@type_name, type_name),
        description = COALESCE(@description, description),
        enabled = COALESCE(@enabled, enabled),
        sort_order = COALESCE(@sort_order, sort_order),
        update_user = @actor,
        update_time = @now
    WHERE id = @id
  `).run({
    id,
    type_name: body.typeName ?? null,
    description: body.description ?? null,
    enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
    sort_order: body.sortOrder ?? null,
    actor: req.headers['x-user'] || 'system',
    now: now()
  });
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'UPDATE_TYPE', 'ConfigType', id, body);
  res.json({ id });
});

app.delete('/api/types/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const info = db.prepare(`DELETE FROM config_types WHERE id = ?`).run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'DELETE_TYPE', 'ConfigType', id, {});
  res.json({ id });
});

// --- Versions ------------------------------------------------------------ //
app.get('/api/types/:typeId/versions', (req, res) => {
  const typeId = Number(req.params.typeId);
  const rows = db.prepare(`SELECT * FROM config_versions WHERE type_id = ? ORDER BY id DESC`).all(typeId);
  res.json(rows);
});

app.post('/api/types/:typeId/versions', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const typeId = Number(req.params.typeId);
  const body = req.body || {};
  // enforce single pending
  const pending = db.prepare(`SELECT id FROM config_versions WHERE type_id = ? AND status = 'PENDING_RELEASE'`).get(typeId);
  if (pending) return res.status(400).json({ error: 'Pending version already exists' });
  const stmt = db.prepare(`
    INSERT INTO config_versions (type_id, version_no, status, description, create_user, create_time)
    VALUES (?, ?, 'PENDING_RELEASE', ?, ?, ?)
  `);
  const info = stmt.run(typeId, body.versionNo || String(Date.now()), body.description || '', req.headers['x-user'] || 'system', now());
  audit(req.headers['x-user'], 'CREATE_VERSION', 'ConfigVersion', info.lastInsertRowid, body);
  // Optional cloneFrom for rollback
  if (body.cloneFromVersionId) {
    cloneVersionData(typeId, body.cloneFromVersionId, info.lastInsertRowid, req.headers['x-user'] || 'system');
  }
  res.status(201).json({ id: info.lastInsertRowid });
});

function cloneVersionData(typeId, fromVersionId, toVersionId, actor) {
  const fields = db.prepare(`SELECT * FROM config_fields WHERE version_id = ?`).all(fromVersionId);
  const data = db.prepare(`SELECT * FROM config_data WHERE version_id = ?`).all(fromVersionId);
  const insertField = db.prepare(`
    INSERT INTO config_fields (type_id, version_id, field_code, field_name, data_type, max_length, required, default_value, validate_rule, enum_options, unique_key_part, sort_order)
    VALUES (@type_id, @version_id, @field_code, @field_name, @data_type, @max_length, @required, @default_value, @validate_rule, @enum_options, @unique_key_part, @sort_order)
  `);
  const insertData = db.prepare(`
    INSERT INTO config_data (type_id, version_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
    VALUES (@type_id, @version_id, @key_value, @data_json, @status, @create_user, @update_user, @create_time, @update_time)
  `);
  const tx = db.transaction(() => {
    fields.forEach((f) => insertField.run({ ...f, id: undefined, version_id: toVersionId }));
    data.forEach((d) => insertData.run({ ...d, id: undefined, version_id: toVersionId, create_user: actor, update_user: actor, create_time: now(), update_time: now() }));
  });
  tx();
}

app.patch('/api/versions/:id/publish', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const version = db.prepare(`SELECT * FROM config_versions WHERE id = ?`).get(id);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'PENDING_RELEASE') return res.status(400).json({ error: 'only PENDING_RELEASE can be published' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE config_versions SET status = 'ARCHIVED' WHERE type_id = ? AND status = 'RELEASED'`).run(version.type_id);
    db.prepare(`UPDATE config_versions SET status = 'RELEASED', release_user = ?, release_time = ? WHERE id = ?`).run(req.headers['x-user'] || 'system', now(), id);
  });
  tx();
  audit(req.headers['x-user'], 'PUBLISH_VERSION', 'ConfigVersion', id, {});
  res.json({ id, status: 'RELEASED' });
});

// Diff between versions
app.get('/api/versions/:a/diff/:b', (req, res) => {
  const a = Number(req.params.a);
  const b = Number(req.params.b);
  const fieldsA = db.prepare(`SELECT field_code, data_type, required, max_length, validate_rule, enum_options FROM config_fields WHERE version_id = ?`).all(a);
  const fieldsB = db.prepare(`SELECT field_code, data_type, required, max_length, validate_rule, enum_options FROM config_fields WHERE version_id = ?`).all(b);
  const dataA = db.prepare(`SELECT key_value, data_json FROM config_data WHERE version_id = ?`).all(a);
  const dataB = db.prepare(`SELECT key_value, data_json FROM config_data WHERE version_id = ?`).all(b);
  res.json({ fields: diffList(fieldsA, fieldsB, 'field_code'), data: diffList(dataA, dataB, 'key_value') });
});

function diffList(aList, bList, key) {
  const mapA = new Map(aList.map((x) => [x[key], x]));
  const mapB = new Map(bList.map((x) => [x[key], x]));
  const added = [];
  const removed = [];
  const changed = [];
  mapB.forEach((val, k) => { if (!mapA.has(k)) added.push(val); });
  mapA.forEach((val, k) => { if (!mapB.has(k)) removed.push(val); });
  mapA.forEach((val, k) => {
    if (mapB.has(k) && JSON.stringify(val) !== JSON.stringify(mapB.get(k))) {
      changed.push({ before: val, after: mapB.get(k) });
    }
  });
  return { added, removed, changed };
}

// --- Fields -------------------------------------------------------------- //
app.get('/api/versions/:versionId/fields', (req, res) => {
  const versionId = Number(req.params.versionId);
  const rows = db.prepare(`SELECT * FROM config_fields WHERE version_id = ? ORDER BY sort_order, id`).all(versionId);
  res.json(rows);
});

app.post('/api/versions/:versionId/fields', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const versionId = Number(req.params.versionId);
  const body = req.body || {};
  const version = db.prepare(`SELECT status, type_id FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'PENDING_RELEASE') return res.status(400).json({ error: 'only pending version editable' });
  const stmt = db.prepare(`
    INSERT INTO config_fields (type_id, version_id, field_code, field_name, data_type, max_length, required, default_value, validate_rule, enum_options, unique_key_part, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    const info = stmt.run(
      version.type_id,
      versionId,
      body.fieldCode,
      body.fieldName,
      body.dataType || 'string',
      body.maxLength || null,
      body.required ? 1 : 0,
      body.defaultValue || null,
      body.validateRule || null,
      body.enumOptions ? JSON.stringify(body.enumOptions) : null,
      body.uniqueKeyPart ? 1 : 0,
      body.sortOrder || 0
    );
    audit(req.headers['x-user'], 'CREATE_FIELD', 'ConfigField', info.lastInsertRowid, body);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Config Data --------------------------------------------------------- //
app.get('/api/versions/:versionId/data', (req, res) => {
  const versionId = Number(req.params.versionId);
  const rows = db.prepare(`SELECT * FROM config_data WHERE version_id = ? ORDER BY id DESC`).all(versionId);
  res.json(rows);
});

app.post('/api/versions/:versionId/data', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const versionId = Number(req.params.versionId);
  const body = req.body || {};
  const version = db.prepare(`SELECT status, type_id FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'PENDING_RELEASE') return res.status(400).json({ error: 'only pending version editable' });
  const stmt = db.prepare(`
    INSERT INTO config_data (type_id, version_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(version_id, key_value) DO UPDATE SET
      data_json=excluded.data_json,
      status=excluded.status,
      update_user=excluded.update_user,
      update_time=excluded.update_time
  `);
  stmt.run(
    version.type_id,
    versionId,
    body.keyValue,
    JSON.stringify(body.dataJson || {}),
    body.status || 'ENABLED',
    req.headers['x-user'] || 'system',
    req.headers['x-user'] || 'system',
    now(),
    now()
  );
  audit(req.headers['x-user'], 'UPSERT_DATA', 'ConfigData', versionId, body);
  res.json({ ok: true });
});

// --- Config Fetch API ---------------------------------------------------- //
app.get('/api/config/:appCode/:typeCode/:key', (req, res) => {
  const { appCode, typeCode, key } = req.params;
  const env = req.query.env || 'prod';
  const type = db.prepare(`SELECT id FROM config_types WHERE app_code = ? AND type_code = ? AND env = ?`).get(appCode, typeCode, env);
  if (!type) return res.status(404).json({ error: 'type not found' });
  const released = db.prepare(`SELECT id FROM config_versions WHERE type_id = ? AND status = 'RELEASED' ORDER BY release_time DESC LIMIT 1`).get(type.id);
  if (!released) return res.status(404).json({ error: 'no released version' });
  const row = db.prepare(`SELECT data_json, status FROM config_data WHERE version_id = ? AND key_value = ?`).get(released.id, key);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ key, data: JSON.parse(row.data_json), status: row.status });
});

app.get('/api/config/:appCode/:typeCode', (req, res) => {
  const { appCode, typeCode } = req.params;
  const env = req.query.env || 'prod';
  const type = db.prepare(`SELECT id FROM config_types WHERE app_code = ? AND type_code = ? AND env = ?`).get(appCode, typeCode, env);
  if (!type) return res.status(404).json({ error: 'type not found' });
  const released = db.prepare(`SELECT id FROM config_versions WHERE type_id = ? AND status = 'RELEASED' ORDER BY release_time DESC LIMIT 1`).get(type.id);
  if (!released) return res.status(404).json({ error: 'no released version' });
  const rows = db.prepare(`SELECT key_value, data_json, status FROM config_data WHERE version_id = ?`).all(released.id);
  res.json(rows.map((r) => ({ key: r.key_value, data: JSON.parse(r.data_json), status: r.status })));
});

// --- Audit --------------------------------------------------------------- //
app.get('/api/audit', (req, res) => {
  const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100`).all();
  res.json(rows.map((r) => ({ ...r, details: safeParse(r.details) })));
});

function safeParse(text) {
  try { return JSON.parse(text); } catch (e) { return text; }
}

// --- Static (serve frontend build if exists) ----------------------------- //
const FRONT_DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(FRONT_DIST));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Config Center backend listening on http://localhost:${PORT}`);
});
