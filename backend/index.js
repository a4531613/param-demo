/**
 * Lightweight parameter configuration service (Express + SQLite).
 * Run: npm install && npm start
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
app.use(express.json());
app.use(cors());

const db = new Database(DB_PATH);
initSchema();

// --- Helpers ------------------------------------------------------------- //

function nowIso() {
  return new Date().toISOString();
}

function initSchema() {
  db.exec(`
    PRAGMA foreign_keys = ON;
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

function getOrCreateAppEnv(appCode, envCode) {
  const app = db.prepare(`SELECT app_id FROM applications WHERE app_code = ?`).get(appCode);
  let appId = app?.app_id;
  if (!appId) {
    const info = db
      .prepare(`INSERT INTO applications (app_code, app_name) VALUES (?, ?)`)
      .run(appCode, appCode);
    appId = info.lastInsertRowid;
  }
  const env = db
    .prepare(`SELECT env_id FROM environments WHERE app_id = ? AND env_code = ?`)
    .get(appId, envCode);
  let envId = env?.env_id;
  if (!envId) {
    const info = db
      .prepare(`INSERT INTO environments (env_code, env_name, app_id) VALUES (?, ?, ?)`)
      .run(envCode, envCode, appId);
    envId = info.lastInsertRowid;
  }
  return { appId, envId };
}

function recordAudit(actor, action, targetType, targetId, payload) {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, target_type, target_id, payload) VALUES (?, ?, ?, ?, ?)`
  ).run(actor, action, targetType, targetId, JSON.stringify(payload));
}

// --- API routes ---------------------------------------------------------- //

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: nowIso() });
});

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
  if (clauses.length) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  sql += ' ORDER BY a.app_code, e.env_code, ct.type_code';
  const rows = db.prepare(sql).all(...args);
  res.json(rows);
});

app.post('/api/types', (req, res) => {
  const body = req.body || {};
  const required = ['appCode', 'envCode', 'typeCode', 'typeName'];
  if (required.some((k) => !body[k])) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const actor = req.get('X-User') || 'system';
  const { appCode, envCode, typeCode, typeName, description = '', fields = [] } = body;
  try {
    const tx = db.transaction(() => {
      const { appId, envId } = getOrCreateAppEnv(appCode, envCode);
      const insertType = db.prepare(
        `INSERT INTO config_types (type_code, type_name, app_id, env_id, description)
         VALUES (?, ?, ?, ?, ?)`
      );
      const typeInfo = insertType.run(typeCode, typeName, appId, envId, description);
      const typeId = typeInfo.lastInsertRowid;
      const insertField = db.prepare(
        `INSERT INTO config_type_fields
          (field_key, field_name, field_type, field_length, is_required,
           regex_pattern, default_value, enum_options, description, type_id)
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
    const typeId = tx();
    res.status(201).json({ typeId });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Conflict: duplicate key' });
    }
    return res.status(400).json({ error: String(err) });
  }
});

app.post('/api/versions', (req, res) => {
  const body = req.body || {};
  const required = ['appCode', 'envCode', 'typeCode', 'versionNo'];
  if (required.some((k) => !body[k])) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const actor = req.get('X-User') || 'system';
  const {
    appCode,
    envCode,
    typeCode,
    versionNo,
    description = '',
    effectiveFrom = null,
    items = [],
  } = body;
  try {
    const tx = db.transaction(() => {
      const { appId, envId } = getOrCreateAppEnv(appCode, envCode);
      const typeRow = db
        .prepare(
          `SELECT type_id FROM config_types WHERE app_id = ? AND env_id = ? AND type_code = ?`
        )
        .get(appId, envId, typeCode);
      if (!typeRow) throw new Error('config type not found; create it first');
      const typeId = typeRow.type_id;
      const versionInfo = db
        .prepare(
          `INSERT INTO config_versions
            (version_no, app_id, env_id, type_id, status, is_current, effective_from, description)
           VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)`
        )
        .run(versionNo, appId, envId, typeId, effectiveFrom, description);
      const versionId = versionInfo.lastInsertRowid;
      const fieldRows = db
        .prepare(`SELECT field_id, field_key FROM config_type_fields WHERE type_id = ?`)
        .all(typeId);
      const fieldMap = Object.fromEntries(fieldRows.map((r) => [r.field_key, r.field_id]));
      const insertItem = db.prepare(
        `INSERT INTO config_items
          (version_id, field_id, field_key, field_value, value_format, description)
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
      recordAudit(actor, 'create_version', 'config_version', versionId, {
        appCode,
        envCode,
        typeCode,
        versionNo,
      });
      return versionId;
    });
    const versionId = tx();
    res.status(201).json({ versionId });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Conflict: duplicate key' });
    }
    return res.status(400).json({ error: String(err) });
  }
});

app.post('/api/versions/:id/publish', (req, res) => {
  const actor = req.get('X-User') || 'system';
  const versionId = Number(req.params.id);
  try {
    const tx = db.transaction(() => {
      const row = db
        .prepare(
          `SELECT version_id, type_id, status FROM config_versions WHERE version_id = ?`
        )
        .get(versionId);
      if (!row) throw new Error('Version not found');
      if (!['draft', 'pending'].includes(row.status)) {
        throw new Error('Only draft/pending can be published');
      }
      const now = nowIso();
      db.prepare(
        `UPDATE config_versions SET is_current = 0, effective_to = ? WHERE type_id = ? AND is_current = 1`
      ).run(now, row.type_id);
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

app.post('/api/versions/:id/submit', (req, res) => {
  const actor = req.get('X-User') || 'system';
  const versionId = Number(req.params.id);
  try {
    const tx = db.transaction(() => {
      const row = db
        .prepare(`SELECT version_id FROM config_versions WHERE version_id = ?`)
        .get(versionId);
      if (!row) throw new Error('Version not found');
      db.prepare(
        `UPDATE config_versions SET status = 'pending', updated_at = ? WHERE version_id = ?`
      ).run(nowIso(), versionId);
      recordAudit(actor, 'update_version_status', 'config_version', versionId, { status: 'pending' });
    });
    tx();
    res.json({ versionId, status: 'pending' });
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
  const rows = db.prepare(sql).all(...args);
  res.json(rows);
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
  let versionSql = `
    SELECT version_id, version_no, status, effective_from, effective_to, is_current
    FROM config_versions WHERE type_id = ?
  `;
  const args = [typeRow.type_id];
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
      `SELECT field_key, field_value, value_format, description
       FROM config_items WHERE version_id = ? ORDER BY field_key`
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

// --- Static files -------------------------------------------------------- //

app.use('/', express.static(FRONTEND_DIR));

// Fallback to index.html for root
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
