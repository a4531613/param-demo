/**
 * Enterprise-ready lightweight parameter configuration service (Express + SQLite).
 * Run: cd backend && npm install && npm start
 * Serves both API under /api/* and static Vue app from ../frontend.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const DB_PATH = path.join(__dirname, 'data.db');

const app = express();
const db = new Database(DB_PATH);
initSchema();

app.use(express.json());
app.use(cors());

// --- Helpers ------------------------------------------------------------- //

const nowIso = () => new Date().toISOString();

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

function initSchema() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS applications (
      app_id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_code TEXT NOT NULL UNIQUE,
      app_name TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS environments (
      env_id INTEGER PRIMARY KEY AUTOINCREMENT,
      env_code TEXT NOT NULL,
      env_name TEXT,
      app_id INTEGER NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app_id, env_code),
      FOREIGN KEY(app_id) REFERENCES applications(app_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS config_types (
      type_id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_code TEXT NOT NULL,
      type_name TEXT NOT NULL,
      app_id INTEGER NOT NULL,
      env_id INTEGER NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app_id, env_id, type_code),
      FOREIGN KEY(app_id) REFERENCES applications(app_id) ON DELETE CASCADE,
      FOREIGN KEY(env_id) REFERENCES environments(env_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS config_type_fields (
      field_id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      field_length INTEGER,
      is_required INTEGER NOT NULL DEFAULT 0,
      regex_pattern TEXT,
      default_value TEXT,
      enum_options TEXT,
      description TEXT,
      type_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type_id, field_key),
      FOREIGN KEY(type_id) REFERENCES config_types(type_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS config_versions (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_no TEXT NOT NULL,
      app_id INTEGER NOT NULL,
      env_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      is_current INTEGER NOT NULL DEFAULT 0,
      effective_from TEXT,
      effective_to TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type_id, version_no),
      FOREIGN KEY(app_id) REFERENCES applications(app_id) ON DELETE CASCADE,
      FOREIGN KEY(env_id) REFERENCES environments(env_id) ON DELETE CASCADE,
      FOREIGN KEY(type_id) REFERENCES config_types(type_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS config_items (
      item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      field_id INTEGER NOT NULL,
      field_key TEXT NOT NULL,
      field_value TEXT NOT NULL,
      value_format TEXT NOT NULL DEFAULT 'plain',
      description TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(version_id, field_id),
      UNIQUE(version_id, field_key),
      FOREIGN KEY(version_id) REFERENCES config_versions(version_id) ON DELETE CASCADE,
      FOREIGN KEY(field_id) REFERENCES config_type_fields(field_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getOrCreateAppEnv(appCode, envCode, envName) {
  const app = db.prepare(`SELECT app_id FROM applications WHERE app_code = ?`).get(appCode);
  let appId = app?.app_id;
  if (!appId) {
    const info = db.prepare(`INSERT INTO applications (app_code, app_name) VALUES (?, ?)`).run(appCode, appCode);
    appId = info.lastInsertRowid;
  }
  const env = db.prepare(`SELECT env_id FROM environments WHERE app_id = ? AND env_code = ?`).get(appId, envCode);
  let envId = env?.env_id;
  if (!envId) {
    const info = db.prepare(`INSERT INTO environments (env_code, env_name, app_id) VALUES (?, ?, ?)`)
      .run(envCode, envName || envCode, appId);
    envId = info.lastInsertRowid;
  }
  return { appId, envId };
}

function recordAudit(actor, action, targetType, targetId, payload) {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, target_type, target_id, payload) VALUES (?, ?, ?, ?, ?)`
  ).run(actor, action, targetType, targetId, JSON.stringify(payload));
}

function conflictError(err) {
  return String(err).includes('UNIQUE') ? 'Conflict: duplicate key' : String(err);
}

// --- API routes ---------------------------------------------------------- //

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: nowIso() });
});

// Users
app.get('/api/users', (_req, res) => {
  const rows = db
    .prepare(`SELECT user_id, username, display_name, role, email, created_at FROM users ORDER BY username`)
    .all();
  res.json(rows);
});

app.post('/api/users', (req, res) => {
  const body = req.body || {};
  if (!body.username) return res.status(400).json({ error: 'username required' });
  try {
    const info = db
      .prepare(`INSERT INTO users (username, display_name, role, email) VALUES (?, ?, ?, ?)`)
      .run(body.username, body.displayName || body.username, body.role || 'user', body.email || null);
    recordAudit(req.get('X-User') || 'system', 'create_user', 'user', info.lastInsertRowid, {
      username: body.username,
    });
    res.status(201).json({ userId: info.lastInsertRowid });
  } catch (err) {
    res.status(409).json({ error: conflictError(err) });
  }
});

// Applications
app.get('/api/apps', (_req, res) => {
  const rows = db
    .prepare(`SELECT app_id, app_code, app_name, description FROM applications ORDER BY app_code`)
    .all();
  res.json(rows);
});

app.post('/api/apps', (req, res) => {
  const { appCode, appName, description = '' } = req.body || {};
  if (!appCode) return res.status(400).json({ error: 'appCode required' });
  try {
    const info = db
      .prepare(`INSERT INTO applications (app_code, app_name, description) VALUES (?, ?, ?)`)
      .run(appCode, appName || appCode, description);
    recordAudit(req.get('X-User') || 'system', 'create_app', 'application', info.lastInsertRowid, {
      appCode,
    });
    res.status(201).json({ appId: info.lastInsertRowid });
  } catch (err) {
    res.status(409).json({ error: conflictError(err) });
  }
});

// Environments
app.get('/api/envs', (req, res) => {
  const { appCode } = req.query;
  let sql = `
    SELECT e.env_id, e.env_code, e.env_name, e.description, a.app_code
    FROM environments e JOIN applications a ON a.app_id = e.app_id
  `;
  const args = [];
  if (appCode) {
    sql += ' WHERE a.app_code = ?';
    args.push(appCode);
  }
  sql += ' ORDER BY a.app_code, e.env_code';
  const rows = db.prepare(sql).all(...args);
  res.json(rows);
});

app.post('/api/envs', (req, res) => {
  const { appCode, envCode, envName, description = '' } = req.body || {};
  if (!appCode || !envCode) return res.status(400).json({ error: 'appCode/envCode required' });
  try {
    const { appId } = getOrCreateAppEnv(appCode, envCode, envName);
    db.prepare(
      `UPDATE environments SET description = COALESCE(?, description) WHERE app_id = ? AND env_code = ?`
    ).run(description, appId, envCode);
    recordAudit(req.get('X-User') || 'system', 'create_env', 'environment', appId, { envCode });
    const envRow = db.prepare(`SELECT env_id FROM environments WHERE app_id = ? AND env_code = ?`).get(appId, envCode);
    res.status(201).json({ envId: envRow.env_id });
  } catch (err) {
    res.status(409).json({ error: conflictError(err) });
  }
});

// Config types & fields
app.get('/api/types', (req, res) => {
  const { appCode, envCode } = req.query;
  let sql = `
    SELECT ct.type_id, ct.type_code, ct.type_name, ct.description,
           a.app_code, e.env_code
    FROM config_types ct
    JOIN applications a ON a.app_id = ct.app_id
    JOIN environments e ON e.env_id = ct.env_id
  `;
  const clauses = [];
  const args = [];
  if (appCode) {
    clauses.push('a.app_code = ?');
    args.push(appCode);
  }
  if (envCode) {
    clauses.push('e.env_code = ?');
    args.push(envCode);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY a.app_code, e.env_code, ct.type_code';
  res.json(db.prepare(sql).all(...args));
});

app.post('/api/types', (req, res) => {
  const body = req.body || {};
  const required = ['appCode', 'envCode', 'typeCode', 'typeName'];
  if (required.some((k) => !body[k])) return res.status(400).json({ error: 'Missing required fields' });
  const actor = req.get('X-User') || 'system';
  const { appCode, envCode, typeCode, typeName, description = '', fields = [] } = body;
  try {
    const tx = db.transaction(() => {
      const { appId, envId } = getOrCreateAppEnv(appCode, envCode);
      const typeInfo = db
        .prepare(
          `INSERT INTO config_types (type_code, type_name, app_id, env_id, description) VALUES (?, ?, ?, ?, ?)`
        )
        .run(typeCode, typeName, appId, envId, description);
      const typeId = typeInfo.lastInsertRowid;
      const insertField = db.prepare(
        `INSERT INTO config_type_fields
          (field_key, field_name, field_type, field_length, is_required, regex_pattern, default_value, enum_options, description, type_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const f of fields) {
        insertField.run(
          f.fieldKey,
          f.fieldName || f.fieldKey,
          f.fieldType || 'string',
          f.fieldLength || null,
          f.isRequired ? 1 : 0,
          f.regexPattern || null,
          f.defaultValue || null,
          f.enumOptions || null,
          f.description || '',
          typeId
        );
      }
      recordAudit(actor, 'create_type', 'config_type', typeId, { appCode, envCode, typeCode });
      return typeId;
    });
    res.status(201).json({ typeId: tx() });
  } catch (err) {
    res.status(409).json({ error: conflictError(err) });
  }
});

app.get('/api/type-fields', (req, res) => {
  const { typeId } = req.query;
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  const rows = db
    .prepare(
      `SELECT field_id, field_key, field_name, field_type, is_required, regex_pattern, default_value, enum_options, description
       FROM config_type_fields WHERE type_id = ? ORDER BY field_key`
    )
    .all(Number(typeId));
  res.json(rows);
});

app.post('/api/type-fields', (req, res) => {
  const body = req.body || {};
  const required = ['typeId', 'fieldKey', 'fieldName'];
  if (required.some((k) => !body[k])) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const info = db
      .prepare(
        `INSERT INTO config_type_fields
          (field_key, field_name, field_type, field_length, is_required, regex_pattern, default_value, enum_options, description, type_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        body.fieldKey,
        body.fieldName,
        body.fieldType || 'string',
        body.fieldLength || null,
        body.isRequired ? 1 : 0,
        body.regexPattern || null,
        body.defaultValue || null,
        body.enumOptions || null,
        body.description || '',
        body.typeId
      );
    recordAudit(req.get('X-User') || 'system', 'create_field', 'config_type_field', info.lastInsertRowid, {
      fieldKey: body.fieldKey,
    });
    res.status(201).json({ fieldId: info.lastInsertRowid });
  } catch (err) {
    res.status(409).json({ error: conflictError(err) });
  }
});

// Versions & items
app.post('/api/versions', (req, res) => {
  const body = req.body || {};
  const required = ['appCode', 'envCode', 'typeCode', 'versionNo'];
  if (required.some((k) => !body[k])) return res.status(400).json({ error: 'Missing required fields' });
  const actor = req.get('X-User') || 'system';
  const { appCode, envCode, typeCode, versionNo, description = '', effectiveFrom = null, items = [] } = body;
  try {
    const tx = db.transaction(() => {
      const { appId, envId } = getOrCreateAppEnv(appCode, envCode);
      const typeRow = db
        .prepare(`SELECT type_id FROM config_types WHERE app_id = ? AND env_id = ? AND type_code = ?`)
        .get(appId, envId, typeCode);
      if (!typeRow) throw new Error('config type not found; create it first');
      const typeId = typeRow.type_id;
      const versionInfo = db
        .prepare(
          `INSERT INTO config_versions (version_no, app_id, env_id, type_id, status, is_current, effective_from, description)
           VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)`
        )
        .run(versionNo, appId, envId, typeId, effectiveFrom, description);
      const versionId = versionInfo.lastInsertRowid;
      const fieldRows = db.prepare(`SELECT field_id, field_key FROM config_type_fields WHERE type_id = ?`).all(typeId);
      const fieldMap = Object.fromEntries(fieldRows.map((r) => [r.field_key, r.field_id]));
      const insertItem = db.prepare(
        `INSERT INTO config_items (version_id, field_id, field_key, field_value, value_format, description)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        if (!fieldMap[it.fieldKey]) throw new Error(`fieldKey not defined: ${it.fieldKey}`);
        insertItem.run(
          versionId,
          fieldMap[it.fieldKey],
          it.fieldKey,
          String(it.value ?? ''),
          it.valueFormat || 'plain',
          it.description || ''
        );
      }
      recordAudit(actor, 'create_version', 'config_version', versionId, { appCode, envCode, typeCode, versionNo });
      return versionId;
    });
    res.status(201).json({ versionId: tx() });
  } catch (err) {
    res.status(400).json({ error: conflictError(err) });
  }
});

app.post('/api/versions/:id/submit', (req, res) => {
  const versionId = Number(req.params.id);
  const actor = req.get('X-User') || 'system';
  try {
    const tx = db.transaction(() => {
      const row = db.prepare(`SELECT version_id FROM config_versions WHERE version_id = ?`).get(versionId);
      if (!row) throw new Error('Version not found');
      db.prepare(`UPDATE config_versions SET status = 'pending', updated_at = ? WHERE version_id = ?`).run(nowIso(), versionId);
      recordAudit(actor, 'update_version_status', 'config_version', versionId, { status: 'pending' });
    });
    tx();
    res.json({ versionId, status: 'pending' });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: String(err) });
  }
});

app.post('/api/versions/:id/publish', (req, res) => {
  const versionId = Number(req.params.id);
  const actor = req.get('X-User') || 'system';
  try {
    const tx = db.transaction(() => {
      const row = db.prepare(`SELECT version_id, type_id, status FROM config_versions WHERE version_id = ?`).get(versionId);
      if (!row) throw new Error('Version not found');
      if (!['draft', 'pending'].includes(row.status)) throw new Error('Only draft/pending can be published');
      const now = nowIso();
      db.prepare(`UPDATE config_versions SET is_current = 0, effective_to = ? WHERE type_id = ? AND is_current = 1`).run(now, row.type_id);
      db.prepare(
        `UPDATE config_versions
         SET status = 'published', is_current = 1, effective_from = COALESCE(effective_from, ?), updated_at = ?
         WHERE version_id = ?`
      ).run(now, now, versionId);
      recordAudit(actor, 'publish_version', 'config_version', versionId, { publishedAt: now });
    });
    tx();
    res.json({ versionId, status: 'published' });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: String(err) });
  }
});

app.get('/api/versions', (req, res) => {
  const { appCode, envCode, typeCode } = req.query;
  let sql = `
    SELECT v.version_id, v.version_no, v.status, v.is_current,
           v.effective_from, v.effective_to,
           a.app_code, e.env_code, t.type_code
    FROM config_versions v
    JOIN applications a ON a.app_id = v.app_id
    JOIN environments e ON e.env_id = v.env_id
    JOIN config_types t ON t.type_id = v.type_id
  `;
  const clauses = [];
  const args = [];
  if (appCode) { clauses.push('a.app_code = ?'); args.push(appCode); }
  if (envCode) { clauses.push('e.env_code = ?'); args.push(envCode); }
  if (typeCode) { clauses.push('t.type_code = ?'); args.push(typeCode); }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY v.created_at DESC';
  res.json(db.prepare(sql).all(...args));
});

app.get('/api/items', (req, res) => {
  const { versionId } = req.query;
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  const rows = db
    .prepare(
      `SELECT item_id, field_key, field_value, value_format, description, is_enabled
       FROM config_items WHERE version_id = ? ORDER BY field_key`
    )
    .all(Number(versionId));
  res.json(rows);
});

app.post('/api/items/upsert', (req, res) => {
  const { versionId, items = [] } = req.body || {};
  const actor = req.get('X-User') || 'system';
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  try {
    const tx = db.transaction(() => {
      const version = db.prepare(`SELECT type_id FROM config_versions WHERE version_id = ?`).get(versionId);
      if (!version) throw new Error('Version not found');
      const fields = db.prepare(`SELECT field_id, field_key FROM config_type_fields WHERE type_id = ?`).all(version.type_id);
      const fieldMap = Object.fromEntries(fields.map((f) => [f.field_key, f.field_id]));
      const upsert = db.prepare(
        `INSERT INTO config_items (version_id, field_id, field_key, field_value, value_format, description, is_enabled)
         VALUES (@version_id, @field_id, @field_key, @field_value, @value_format, @description, @is_enabled)
         ON CONFLICT(version_id, field_key) DO UPDATE SET
            field_value=excluded.field_value,
            value_format=excluded.value_format,
            description=excluded.description,
            is_enabled=excluded.is_enabled,
            updated_at=(datetime('now'))`
      );
      for (const item of items) {
        if (!fieldMap[item.fieldKey]) throw new Error(`fieldKey not defined: ${item.fieldKey}`);
        upsert.run({
          version_id: versionId,
          field_id: fieldMap[item.fieldKey],
          field_key: item.fieldKey,
          field_value: String(item.value ?? ''),
          value_format: item.valueFormat || 'plain',
          description: item.description || '',
          is_enabled: item.isEnabled === false ? 0 : 1,
        });
      }
      recordAudit(actor, 'maintain_items', 'config_items', versionId, { count: items.length });
    });
    tx();
    res.json({ versionId, updated: items.length });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get('/api/config', (req, res) => {
  const { appCode, envCode, typeCode, versionNo } = req.query;
  if (!appCode || !envCode || !typeCode) {
    return res.status(400).json({ error: 'appCode/envCode/typeCode required' });
  }
  const typeRow = db
    .prepare(
      `SELECT t.type_id, a.app_id, e.env_id FROM config_types t
       JOIN applications a ON a.app_id = t.app_id
       JOIN environments e ON e.env_id = t.env_id
       WHERE a.app_code = ? AND e.env_code = ? AND t.type_code = ?`
    )
    .get(appCode, envCode, typeCode);
  if (!typeRow) return res.status(404).json({ error: 'Config type not found' });
  const args = [typeRow.type_id];
  let versionSql = `
    SELECT version_id, version_no, status, effective_from, effective_to, is_current
    FROM config_versions WHERE type_id = ?
  `;
  if (versionNo) {
    versionSql += ' AND version_no = ?';
    args.push(versionNo);
  } else {
    versionSql += ' AND is_current = 1';
  }
  versionSql += ' ORDER BY created_at DESC LIMIT 1';
  const ver = db.prepare(versionSql).get(...args);
  if (!ver) return res.status(404).json({ error: 'No version found' });
  const items = db
    .prepare(
      `SELECT field_key, field_value, value_format, description FROM config_items WHERE version_id = ? ORDER BY field_key`
    )
    .all(ver.version_id);
  res.json({
    appCode,
    envCode,
    typeCode,
    versionNo: ver.version_no,
    status: ver.status,
    effectiveFrom: ver.effective_from,
    items,
  });
});

// Audit
app.get('/api/audit', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const rows = db
    .prepare(
      `SELECT log_id, actor, action, target_type, target_id, payload, created_at
       FROM audit_logs ORDER BY log_id DESC LIMIT ?`
    )
    .all(limit);
  res.json(rows.map((r) => ({ ...r, payload: safeParse(r.payload) })));
});

// --- Static files -------------------------------------------------------- //

app.use('/', express.static(FRONTEND_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// --- Server start -------------------------------------------------------- //

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Frontend served from ${FRONTEND_DIR}`);
});
