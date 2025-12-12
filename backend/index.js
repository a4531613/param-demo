/**
 * Enterprise Config Center Backend (Express + SQLite)
 * Features: ConfigType, ConfigField (per version), ConfigVersion lifecycle,
 * ConfigData, diff, publish/rollback, audit, config fetch API.
 * Auth model is simplified: pass X-User and X-Role (admin/appOwner/viewer) headers.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const PDFDocument = require('pdfkit');

const DB_PATH = path.join(__dirname, 'config-center.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
initSchema();
ensureConfigDataEnv();

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

function ensureConfigDataEnv() {
  const hasEnv = db.prepare(`PRAGMA table_info(config_data)`).all().some((c) => c.name === 'env_id');
  if (!hasEnv) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE config_data RENAME TO config_data_old;
        CREATE TABLE IF NOT EXISTS config_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type_id INTEGER NOT NULL,
          version_id INTEGER NOT NULL,
          env_id INTEGER,
          key_value TEXT NOT NULL,
          data_json TEXT NOT NULL,
          status TEXT DEFAULT 'ENABLED',
          create_user TEXT,
          create_time TEXT DEFAULT (datetime('now')),
          update_user TEXT,
          update_time TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (type_id) REFERENCES config_types(id) ON DELETE CASCADE,
          FOREIGN KEY (version_id) REFERENCES config_versions(id) ON DELETE CASCADE
        );
        INSERT INTO config_data (id, type_id, version_id, env_id, key_value, data_json, status, create_user, create_time, update_user, update_time)
        SELECT id, type_id, version_id, NULL, key_value, data_json, status, create_user, create_time, update_user, update_time FROM config_data_old;
        DROP TABLE config_data_old;
      `);
    })();
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_config_data_version_env_key ON config_data(version_id, env_id, key_value)`);
}

function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_code TEXT UNIQUE NOT NULL,
    app_name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS environments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    env_code TEXT NOT NULL,
    env_name TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now')),
    UNIQUE(app_id, env_code),
    FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS config_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_code TEXT NOT NULL,
    type_name TEXT NOT NULL,
    app_id INTEGER,
    biz_domain TEXT,
    env_id INTEGER,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now')),
    UNIQUE(type_code, app_id, env_id),
    FOREIGN KEY(app_id) REFERENCES applications(id) ON DELETE SET NULL,
    FOREIGN KEY(env_id) REFERENCES environments(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | PENDING_RELEASE | RELEASED | ARCHIVED
    description TEXT,
    app_id INTEGER,
    enabled INTEGER DEFAULT 1,
    effective_from TEXT,
    effective_to TEXT,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    release_user TEXT,
    release_time TEXT,
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL,
    UNIQUE(version_no)
  );
  CREATE TABLE IF NOT EXISTS config_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL,
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
    enabled INTEGER DEFAULT 1,
    create_user TEXT,
    create_time TEXT DEFAULT (datetime('now')),
    update_user TEXT,
    update_time TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (type_id) REFERENCES config_types(id) ON DELETE CASCADE
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
  migrateConfigVersions();
}

function migrateConfigVersions() {
  const columns = db.prepare(`PRAGMA table_info(config_versions)`).all();
  const hasTypeId = columns.some((c) => c.name === 'type_id');
  const typeNotNull = columns.find((c) => c.name === 'type_id' && c.notnull);
  if (hasTypeId && typeNotNull) {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS config_versions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version_no TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          description TEXT,
          app_id INTEGER,
          enabled INTEGER DEFAULT 1,
          effective_from TEXT,
          effective_to TEXT,
          create_user TEXT,
          create_time TEXT DEFAULT (datetime('now')),
          release_user TEXT,
          release_time TEXT,
          update_user TEXT,
          update_time TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL,
          UNIQUE(version_no)
        );
      `);
      db.exec(`
        INSERT INTO config_versions_new (id, version_no, status, description, app_id, enabled, effective_from, effective_to, create_user, create_time, release_user, release_time, update_user, update_time)
        SELECT id, version_no, status, description, app_id, enabled, effective_from, effective_to, create_user, create_time, release_user, release_time, update_user, update_time
        FROM config_versions;
      `);
      db.exec(`DROP TABLE config_versions;`);
      db.exec(`ALTER TABLE config_versions_new RENAME TO config_versions;`);
    });
    tx();
  }
}

function nextTypeCode() {
  const row = db.prepare(`
    SELECT COALESCE(MAX(code_num), 0) + 1 AS next_code
    FROM (
      SELECT CAST(type_code AS INTEGER) AS code_num
      FROM config_types
      WHERE type_code GLOB '[0-9]*'
    )
  `).get();
  return String(row?.next_code || 1);
}

function resolveTypeIdForApp(appId) {
  if (!appId) return null;
  const row = db.prepare(`SELECT id FROM config_types WHERE app_id = ? ORDER BY sort_order, id LIMIT 1`).get(appId);
  return row?.id || null;
}

// --- Applications CRUD --------------------------------------------------- //
app.get('/api/apps', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM applications ORDER BY id DESC`).all();
  res.json(rows);
});

app.post('/api/apps', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const b = req.body || {};
  try {
    const info = db.prepare(`
      INSERT INTO applications (app_code, app_name, description, enabled, create_user, update_user, update_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.appCode,
      b.appName || b.appCode,
      b.description || '',
      b.enabled === false ? 0 : 1,
      req.headers['x-user'] || 'system',
      req.headers['x-user'] || 'system',
      now()
    );
    audit(req.headers['x-user'], 'CREATE_APP', 'Application', info.lastInsertRowid, b);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/apps/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const b = req.body || {};
  const info = db.prepare(`
    UPDATE applications
    SET app_name = COALESCE(@app_name, app_name),
        description = COALESCE(@description, description),
        enabled = COALESCE(@enabled, enabled),
        update_user = @actor,
        update_time = @now
    WHERE id = @id
  `).run({
    id,
    app_name: b.appName ?? null,
    description: b.description ?? null,
    enabled: b.enabled === undefined ? null : b.enabled ? 1 : 0,
    actor: req.headers['x-user'] || 'system',
    now: now()
  });
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'UPDATE_APP', 'Application', id, b);
  res.json({ id });
});

app.delete('/api/apps/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const info = db.prepare(`DELETE FROM applications WHERE id = ?`).run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'DELETE_APP', 'Application', id, {});
  res.json({ id });
});

// --- Environments CRUD --------------------------------------------------- //
app.get('/api/envs', (req, res) => {
  const { appId } = req.query;
  let sql = `SELECT e.*, a.app_code FROM environments e JOIN applications a ON e.app_id = a.id WHERE 1=1`;
  const params = [];
  if (appId) { sql += ` AND e.app_id = ?`; params.push(appId); }
  sql += ` ORDER BY e.id DESC`;
  res.json(db.prepare(sql).all(params));
});

app.post('/api/envs', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const b = req.body || {};
  try {
    const info = db.prepare(`
      INSERT INTO environments (env_code, env_name, app_id, description, enabled, create_user, update_user, update_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.envCode,
      b.envName,
      b.appId,
      b.description || '',
      b.enabled === false ? 0 : 1,
      req.headers['x-user'] || 'system',
      req.headers['x-user'] || 'system',
      now()
    );
    audit(req.headers['x-user'], 'CREATE_ENV', 'Environment', info.lastInsertRowid, b);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/envs/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const b = req.body || {};
  const info = db.prepare(`
    UPDATE environments
    SET env_name = COALESCE(@env_name, env_name),
        description = COALESCE(@description, description),
        enabled = COALESCE(@enabled, enabled),
        update_user = @actor,
        update_time = @now
    WHERE id = @id
  `).run({
    id,
    env_name: b.envName ?? null,
    description: b.description ?? null,
    enabled: b.enabled === undefined ? null : b.enabled ? 1 : 0,
    actor: req.headers['x-user'] || 'system',
    now: now()
  });
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'UPDATE_ENV', 'Environment', id, b);
  res.json({ id });
});

app.delete('/api/envs/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const info = db.prepare(`DELETE FROM environments WHERE id = ?`).run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'DELETE_ENV', 'Environment', id, {});
  res.json({ id });
});

// --- Config Types CRUD ---------------------------------------------------- //
app.get('/api/types', (req, res) => {
  const { appId, envId } = req.query;
  let sql = `
    SELECT t.*, a.app_name, e.env_name
    FROM config_types t
    LEFT JOIN applications a ON t.app_id = a.id
    LEFT JOIN environments e ON t.env_id = e.id
    WHERE 1=1
  `;
  const params = [];
  if (appId) { sql += ` AND t.app_id = ?`; params.push(appId); }
  if (envId) { sql += ` AND t.env_id = ?`; params.push(envId); }
  sql += ` ORDER BY t.sort_order, t.id DESC`;
  res.json(db.prepare(sql).all(params));
});

app.post('/api/types', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const body = req.body || {};
  if (!body.appId || !body.envId) {
    return res.status(400).json({ error: 'appId and envId are required' });
  }
  const stmt = db.prepare(`
    INSERT INTO config_types (type_code, type_name, app_id, env_id, biz_domain, description, enabled, sort_order, create_user, update_user, update_time)
    VALUES (@type_code, @type_name, @app_id, @env_id, @biz_domain, @description, @enabled, @sort_order, @actor, @actor, @now)
  `);
  const tx = db.transaction(() => {
    const typeCode = nextTypeCode();
    const info = stmt.run({
      type_code: typeCode,
      type_name: body.typeName,
      app_id: body.appId || null,
      env_id: body.envId || null,
      biz_domain: body.bizDomain || null,
      description: body.description || '',
      enabled: body.enabled ? 1 : 0,
      sort_order: body.sortOrder || 0,
      actor: req.headers['x-user'] || 'system',
      now: now()
    });
    return { info, typeCode };
  });
  try {
    const { info, typeCode } = tx();
    audit(req.headers['x-user'], 'CREATE_TYPE', 'ConfigType', info.lastInsertRowid, { ...body, typeCode });
    res.status(201).json({ id: info.lastInsertRowid, typeCode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/types/next-code', (_req, res) => {
  res.json({ next: nextTypeCode() });
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
        app_id = COALESCE(@app_id, app_id),
        env_id = COALESCE(@env_id, env_id),
        sort_order = COALESCE(@sort_order, sort_order),
        update_user = @actor,
        update_time = @now
    WHERE id = @id
  `).run({
    id,
    type_name: body.typeName ?? null,
    description: body.description ?? null,
    enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
    app_id: body.appId ?? null,
    env_id: body.envId ?? null,
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
  const type = db.prepare(`SELECT app_id FROM config_types WHERE id = ?`).get(typeId);
  if (!type) return res.status(404).json({ error: 'type not found' });
  const rows = db.prepare(`SELECT * FROM config_versions WHERE app_id = ? ORDER BY id DESC`).all(type.app_id);
  res.json(rows);
});

app.post('/api/types/:typeId/versions', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const typeId = Number(req.params.typeId);
  const body = req.body || {};
  const typeRow = db.prepare(`SELECT app_id FROM config_types WHERE id = ?`).get(typeId);
  if (!typeRow) return res.status(404).json({ error: 'type not found' });
  const stmt = db.prepare(`
    INSERT INTO config_versions (app_id, version_no, status, description, enabled, create_user, create_time, update_user, update_time)
    VALUES (?, ?, 'PENDING_RELEASE', ?, ?, ?, ?, ?, ?)
  `);
  try {
    const info = stmt.run(
      typeRow.app_id,
      body.versionNo || String(Date.now()),
      body.description || '',
      body.enabled === false ? 0 : 1,
      req.headers['x-user'] || 'system',
      now(),
      req.headers['x-user'] || 'system',
      now()
    );
    audit(req.headers['x-user'], 'CREATE_VERSION', 'ConfigVersion', info.lastInsertRowid, body);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/versions', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const body = req.body || {};
  const versionNo = body.versionNo || String(Date.now());
  const stmt = db.prepare(`
    INSERT INTO config_versions (app_id, version_no, status, description, enabled, create_user, create_time, update_user, update_time)
    VALUES (?, ?, 'PENDING_RELEASE', ?, ?, ?, ?, ?, ?)
  `);
  try {
    const info = stmt.run(
      body.appId || null,
      versionNo,
      body.description || '',
      body.enabled === false ? 0 : 1,
      req.headers['x-user'] || 'system',
      now(),
      req.headers['x-user'] || 'system',
      now()
    );
    audit(req.headers['x-user'], 'CREATE_VERSION', 'ConfigVersion', info.lastInsertRowid, body);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function cloneVersionData(typeId, fromVersionId, toVersionId, actor) {
  // clone skipped; versions no longer bind to type-specific fields
}

const versionAllowedStatuses = new Set(['PENDING_RELEASE', 'RELEASED', 'ARCHIVED']);
function canTransitionStatus(current, target) {
  if (current === target) return true;
  if (current === 'PENDING_RELEASE' && target === 'RELEASED') return true;
  if (current === 'RELEASED' && (target === 'ARCHIVED' || target === 'PENDING_RELEASE')) return true;
  if (current === 'ARCHIVED' && target === 'RELEASED') return true;
  return false;
}

app.patch('/api/versions/:id/publish', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const version = db.prepare(`SELECT * FROM config_versions WHERE id = ?`).get(id);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (!['PENDING_RELEASE', 'ARCHIVED'].includes(version.status)) {
    return res.status(400).json({ error: 'only PENDING_RELEASE or ARCHIVED can be published' });
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE config_versions SET status = 'ARCHIVED' WHERE app_id = ? AND status = 'RELEASED'`).run(version.app_id);
    db.prepare(`UPDATE config_versions SET status = 'RELEASED', release_user = ?, release_time = ? WHERE id = ?`).run(req.headers['x-user'] || 'system', now(), id);
  });
  tx();
  audit(req.headers['x-user'], 'PUBLISH_VERSION', 'ConfigVersion', id, {});
  res.json({ id, status: 'RELEASED' });
});

// list versions with filters
app.get('/api/versions', (req, res) => {
  const { appId, status } = req.query;
  let sql = `
    SELECT v.*, a.app_code
    FROM config_versions v
    LEFT JOIN applications a ON v.app_id = a.id
    WHERE 1=1
  `;
  const params = [];
  if (appId) { sql += ` AND v.app_id = ?`; params.push(appId); }
  if (status) { sql += ` AND v.status = ?`; params.push(status); }
  sql += ` ORDER BY v.id DESC`;
  res.json(db.prepare(sql).all(params));
});

// update version fields
app.patch('/api/versions/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const b = req.body || {};
  const version = db.prepare(`SELECT id, status, app_id FROM config_versions WHERE id = ?`).get(id);
  if (!version) return res.status(404).json({ error: 'not found' });

  let statusChanged = false;
  if (b.status) {
    const targetStatus = b.status;
    if (!versionAllowedStatuses.has(targetStatus)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    if (!canTransitionStatus(version.status, targetStatus)) {
      return res.status(400).json({ error: 'status transition not allowed' });
    }
    const tx = db.transaction(() => {
      if (targetStatus === 'RELEASED') {
        db.prepare(`UPDATE config_versions SET status = 'ARCHIVED' WHERE app_id = ? AND status = 'RELEASED' AND id <> ?`).run(version.app_id, id);
        db.prepare(`UPDATE config_versions SET status = 'RELEASED', release_user = ?, release_time = ? WHERE id = ?`).run(
          req.headers['x-user'] || 'system',
          now(),
          id
        );
      } else if (targetStatus === 'PENDING_RELEASE') {
        db.prepare(`UPDATE config_versions SET status = 'PENDING_RELEASE', release_user = NULL, release_time = NULL WHERE id = ?`).run(id);
      } else if (targetStatus === 'ARCHIVED') {
        db.prepare(`UPDATE config_versions SET status = 'ARCHIVED', update_user = ?, update_time = ? WHERE id = ?`).run(
          req.headers['x-user'] || 'system',
          now(),
          id
        );
      }
    });
    tx();
    statusChanged = true;
  }

  const info = db.prepare(`
    UPDATE config_versions
    SET version_no = COALESCE(@version_no, version_no),
        description = COALESCE(@description, description),
        effective_from = COALESCE(@effective_from, effective_from),
        effective_to = COALESCE(@effective_to, effective_to),
        enabled = COALESCE(@enabled, enabled),
        update_user = @actor,
        update_time = @now
    WHERE id = @id
  `).run({
    id,
    version_no: b.versionNo ?? null,
    description: b.description ?? null,
    effective_from: b.effectiveFrom ?? null,
    effective_to: b.effectiveTo ?? null,
    enabled: b.enabled === undefined ? null : b.enabled ? 1 : 0,
    actor: req.headers['x-user'] || 'system',
    now: now()
  });
  if (!info.changes && !statusChanged) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'UPDATE_VERSION', 'ConfigVersion', id, b);
  res.json({ id });
});

app.delete('/api/versions/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const version = db.prepare(`SELECT status FROM config_versions WHERE id = ?`).get(id);
  if (!version) return res.status(404).json({ error: 'not found' });
  if (version.status === 'RELEASED') return res.status(400).json({ error: 'cannot delete released version' });
  const info = db.prepare(`DELETE FROM config_versions WHERE id = ?`).run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'DELETE_VERSION', 'ConfigVersion', id, {});
  res.json({ id });
});

// Diff between versions
app.get('/api/versions/:a/diff/:b', (req, res) => {
  const a = Number(req.params.a);
  const b = Number(req.params.b);
  const verA = db.prepare(`SELECT id, app_id FROM config_versions WHERE id = ?`).get(a);
  const verB = db.prepare(`SELECT id, app_id FROM config_versions WHERE id = ?`).get(b);
  if (!verA || !verB) return res.status(404).json({ error: 'version not found' });
  if ((verA.app_id ?? null) !== (verB.app_id ?? null)) return res.status(400).json({ error: 'versions must belong to same app' });

  const fieldsSql = `
    SELECT cf.type_id, cf.field_code, cf.data_type, cf.required, cf.max_length, cf.validate_rule, cf.enum_options
    FROM config_fields cf
    JOIN config_types t ON cf.type_id = t.id
    WHERE t.app_id IS ?
    ORDER BY cf.type_id, cf.sort_order, cf.id
  `;
  const fieldsA = db.prepare(fieldsSql).all(verA.app_id ?? null).map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.field_code}` }));
  const fieldsB = db.prepare(fieldsSql).all(verB.app_id ?? null).map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.field_code}` }));
  const dataA = db
    .prepare(`SELECT type_id, env_id, key_value, data_json, status FROM config_data WHERE version_id = ?`)
    .all(a)
    .map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.env_id ?? ''}|${r.key_value}` }));
  const dataB = db
    .prepare(`SELECT type_id, env_id, key_value, data_json, status FROM config_data WHERE version_id = ?`)
    .all(b)
    .map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.env_id ?? ''}|${r.key_value}` }));
  res.json({ fields: diffList(fieldsA, fieldsB, 'diff_key'), data: diffList(dataA, dataB, 'diff_key') });
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
app.get('/api/versions/:typeId/fields', (req, res) => {
  const idParam = Number(req.params.typeId);
  const version = db.prepare(`SELECT id, app_id FROM config_versions WHERE id = ?`).get(idParam);
  if (version) {
    const rows = db.prepare(`
      SELECT cf.*, t.app_id, t.type_code
      FROM config_fields cf
      JOIN config_types t ON cf.type_id = t.id
      WHERE t.app_id IS ?
      ORDER BY cf.sort_order, cf.id
    `).all(version.app_id ?? null);
    return res.json(rows);
  }

  const typeId = idParam;
  const rows = db.prepare(`SELECT * FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(typeId);
  return res.json(rows);
});

app.post('/api/versions/:versionId/fields', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const versionId = Number(req.params.versionId);
  const body = req.body || {};
  const version = db.prepare(`SELECT id, app_id, status FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'PENDING_RELEASE') return res.status(400).json({ error: 'only pending version editable' });

  const typeId = Number(body.typeId);
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  const typeRow = db.prepare(`SELECT id, app_id FROM config_types WHERE id = ?`).get(typeId);
  if (!typeRow) return res.status(404).json({ error: 'type not found' });
  if ((typeRow.app_id ?? null) !== (version.app_id ?? null)) return res.status(400).json({ error: 'type does not belong to version app' });

  const stmt = db.prepare(`
    INSERT INTO config_fields (type_id, field_code, field_name, data_type, max_length, required, default_value, validate_rule, enum_options, unique_key_part, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    const info = stmt.run(
      typeId,
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

// General fields API with app/env/type filters
app.get('/api/fields', (req, res) => {
  const { appId, typeId, versionId } = req.query;
  let sql = `
    SELECT cf.*, t.app_id, t.type_code
    FROM config_fields cf
    JOIN config_types t ON cf.type_id = t.id
    WHERE 1=1
  `;
  const params = [];
  if (appId) { sql += ` AND t.app_id = ?`; params.push(appId); }
  if (typeId) { sql += ` AND cf.type_id = ?`; params.push(typeId); }
  if (versionId) { /* ignored: config_fields is not version-scoped */ }
  sql += ` ORDER BY cf.sort_order, cf.id DESC`;
  res.json(db.prepare(sql).all(params));
});

app.post('/api/fields', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const b = req.body || {};
  try {
    const info = db.prepare(`
      INSERT INTO config_fields (type_id, field_code, field_name, data_type, max_length, required, default_value, validate_rule, enum_options, unique_key_part, sort_order, enabled, create_user, update_user, update_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.typeId,
      b.fieldCode,
      b.fieldName,
      b.dataType || 'string',
      b.maxLength || null,
      b.required ? 1 : 0,
      b.defaultValue || null,
      b.validateRule || null,
      b.enumOptions ? JSON.stringify(b.enumOptions) : null,
      b.uniqueKeyPart ? 1 : 0,
      b.sortOrder || 0,
      b.enabled === false ? 0 : 1,
      req.headers['x-user'] || 'system',
      req.headers['x-user'] || 'system',
      now()
    );
    audit(req.headers['x-user'], 'CREATE_FIELD', 'ConfigField', info.lastInsertRowid, b);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/fields/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const b = req.body || {};
  const field = db.prepare(`SELECT id FROM config_fields WHERE id = ?`).get(id);
  if (!field) return res.status(404).json({ error: 'not found' });
  const info = db.prepare(`
    UPDATE config_fields
    SET field_name = COALESCE(@field_name, field_name),
        data_type = COALESCE(@data_type, data_type),
        max_length = COALESCE(@max_length, max_length),
        required = COALESCE(@required, required),
        default_value = COALESCE(@default_value, default_value),
        validate_rule = COALESCE(@validate_rule, validate_rule),
        enum_options = COALESCE(@enum_options, enum_options),
        unique_key_part = COALESCE(@unique_key_part, unique_key_part),
        sort_order = COALESCE(@sort_order, sort_order),
        enabled = COALESCE(@enabled, enabled),
        update_user = @actor,
        update_time = @now
    WHERE id = @id
  `).run({
    id,
    field_name: b.fieldName ?? null,
    data_type: b.dataType ?? null,
    max_length: b.maxLength ?? null,
    required: b.required === undefined ? null : b.required ? 1 : 0,
    default_value: b.defaultValue ?? null,
    validate_rule: b.validateRule ?? null,
    enum_options: b.enumOptions ? JSON.stringify(b.enumOptions) : null,
    unique_key_part: b.uniqueKeyPart === undefined ? null : b.uniqueKeyPart ? 1 : 0,
    sort_order: b.sortOrder ?? null,
    enabled: b.enabled === undefined ? null : b.enabled ? 1 : 0,
    actor: req.headers['x-user'] || 'system',
    now: now()
  });
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'UPDATE_FIELD', 'ConfigField', id, b);
  res.json({ id });
});

app.delete('/api/fields/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const info = db.prepare(`DELETE FROM config_fields WHERE id = ?`).run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'DELETE_FIELD', 'ConfigField', id, {});
  res.json({ id });
});

// --- Config Data --------------------------------------------------------- //
app.get('/api/versions/:versionId/data', (req, res) => {
  const versionId = Number(req.params.versionId);
  const { typeId, envId } = req.query;
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  if (!envId) return res.status(400).json({ error: 'envId required' });
  const rows = db.prepare(`SELECT * FROM config_data WHERE version_id = ? AND type_id = ? AND env_id = ? ORDER BY id DESC`).all(versionId, typeId, envId);
  res.json(rows);
});

app.get('/api/versions/:versionId/data/all', (req, res) => {
  const versionId = Number(req.params.versionId);
  const rows = db
    .prepare(`SELECT id, type_id, version_id, env_id, key_value, data_json, status FROM config_data WHERE version_id = ? ORDER BY env_id, key_value`)
    .all(versionId);
  res.json(rows);
});

app.post('/api/versions/:versionId/data', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const versionId = Number(req.params.versionId);
  const body = req.body || {};
  const version = db.prepare(`SELECT status, app_id FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'RELEASED') return res.status(400).json({ error: 'only released version editable' });
  if (!body.typeId) return res.status(400).json({ error: 'typeId required' });
  if (!body.envId) return res.status(400).json({ error: 'envId required' });
  const env = db.prepare(`SELECT * FROM environments WHERE id = ?`).get(body.envId);
  if (!env) return res.status(404).json({ error: 'env not found' });
  const typeRow = db.prepare(`SELECT * FROM config_types WHERE id = ?`).get(body.typeId);
  if (!typeRow) return res.status(404).json({ error: 'type not found' });
  if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) return res.status(400).json({ error: 'type not belong to app' });
  if (env.app_id && version.app_id && env.app_id !== version.app_id) return res.status(400).json({ error: 'env not belong to app' });
  const stmt = db.prepare(`
    INSERT INTO config_data (type_id, version_id, env_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(version_id, env_id, key_value) DO UPDATE SET
      data_json=excluded.data_json,
      status=excluded.status,
      update_user=excluded.update_user,
      update_time=excluded.update_time
  `);
  stmt.run(
    body.typeId,
    versionId,
    body.envId,
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

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

app.get('/api/versions/:versionId/data/template', (req, res) => {
  const versionId = Number(req.params.versionId);
  const typeId = Number(req.query.typeId);
  const version = db.prepare(`SELECT * FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  const fields = db.prepare(`SELECT field_code FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(typeId);
  const headers = ['key_value', ...fields.map((f) => f.field_code)];
  const csv = `${headers.join(',')}\r\n`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="template_version_${versionId}.csv"`);
  res.send(csv);
});

app.get('/api/versions/:versionId/data/export', (req, res) => {
  const versionId = Number(req.params.versionId);
  const typeId = Number(req.query.typeId);
  const envId = Number(req.query.envId);
  const version = db.prepare(`SELECT * FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  if (!envId) return res.status(400).json({ error: 'envId required' });
  const fields = db.prepare(`SELECT field_code FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(typeId);
  const headers = ['key_value', ...fields.map((f) => f.field_code)];
  const rows = db.prepare(`SELECT key_value, data_json, status FROM config_data WHERE version_id = ? AND type_id = ? AND env_id = ? ORDER BY id`).all(versionId, typeId, envId);
  let csv = `${headers.join(',')}\r\n`;
  rows.forEach((r) => {
    const data = safeParse(r.data_json) || {};
    const line = [
      csvEscape(r.key_value),
      ...fields.map((f) => csvEscape(data[f.field_code]))
    ].join(',');
    csv += `${line}\r\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="version_${versionId}_data.csv"`);
  res.send(csv);
});

app.get('/api/export/pdf', (req, res) => {
  const appId = Number(req.query.appId);
  const versionId = Number(req.query.versionId);
  const envId = Number(req.query.envId);
  if (!appId) return res.status(400).json({ error: 'appId required' });
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  if (!envId) return res.status(400).json({ error: 'envId required' });

  const appRow = db.prepare(`SELECT id, app_code, app_name FROM applications WHERE id = ?`).get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  const versionRow = db.prepare(`SELECT id, app_id, version_no, status, release_time FROM config_versions WHERE id = ?`).get(versionId);
  if (!versionRow) return res.status(404).json({ error: 'version not found' });
  if ((versionRow.app_id ?? null) !== appRow.id) return res.status(400).json({ error: 'version not belong to app' });
  const envRow = db.prepare(`SELECT id, app_id, env_code, env_name FROM environments WHERE id = ?`).get(envId);
  if (!envRow) return res.status(404).json({ error: 'env not found' });
  if ((envRow.app_id ?? null) !== appRow.id) return res.status(400).json({ error: 'env not belong to app' });

  const types = db
    .prepare(
      `SELECT id, type_code, type_name, sort_order
       FROM config_types
       WHERE app_id = ? AND (env_id = ? OR env_id IS NULL)
       ORDER BY sort_order, id`
    )
    .all(appRow.id, envRow.id);

  const fieldsByTypeId = new Map();
  types.forEach((t) => {
    const fields = db.prepare(`SELECT field_code, field_name FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(t.id);
    fieldsByTypeId.set(t.id, fields);
  });
  const dataByTypeId = new Map(types.map((t) => [t.id, []]));
  const dataRows = db
    .prepare(
      `SELECT cd.type_id, cd.key_value, cd.data_json, cd.status
       FROM config_data cd
       JOIN config_types t ON cd.type_id = t.id
       WHERE cd.version_id = ? AND cd.env_id = ? AND t.app_id = ?
       ORDER BY t.sort_order, t.id, cd.key_value`
    )
    .all(versionRow.id, envRow.id, appRow.id);
  dataRows.forEach((r) => {
    if (!dataByTypeId.has(r.type_id)) dataByTypeId.set(r.type_id, []);
    dataByTypeId.get(r.type_id).push(r);
  });

  const title = '配置导出';
  const fileBase = safeFilename(`config_${appRow.app_code || appRow.id}_v${versionRow.version_no || versionRow.id}_env${envRow.env_code || envRow.id}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.on('error', () => { try { res.end(); } catch { /* ignore */ } });
  doc.pipe(res);

  let fontLoaded = false;
  for (const fontPath of resolvePdfFontPaths()) {
    try {
      doc.font(fontPath);
      fontLoaded = true;
      break;
    } catch {
      // try next
    }
  }
  if (!fontLoaded) doc.font('Helvetica');

  const primary = '#111827';
  const muted = '#6b7280';
  const border = '#e5e7eb';
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (minSpace = 40) => {
    if (doc.y + minSpace > pageBottom()) doc.addPage();
  };

  doc.fillColor(primary).fontSize(18).text(title);
  doc.moveDown(0.25);
  doc.fillColor(muted).fontSize(10).text(`应用：${appRow.app_name || ''} (${appRow.app_code || appRow.id})`);
  doc.fillColor(muted).fontSize(10).text(`版本：${versionRow.version_no || versionRow.id}  状态：${versionRow.status || '-'}`);
  doc.fillColor(muted).fontSize(10).text(`环境：${envRow.env_name || ''} (${envRow.env_code || envRow.id})`);
  doc.fillColor(muted).fontSize(10).text(`导出时间：${new Date().toISOString()}`);
  doc.moveDown(0.6);
  doc.strokeColor(border).lineWidth(1).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.8);

  types.forEach((t) => {
    ensureSpace(80);
    doc.fillColor(primary).fontSize(13).text(`${t.type_name || ''} (${t.type_code || t.id})`);
    doc.moveDown(0.3);

    const list = dataByTypeId.get(t.id) || [];
    if (!list.length) {
      doc.fillColor(muted).fontSize(10).text('暂无配置');
      doc.moveDown(0.8);
      return;
    }
    const fields = fieldsByTypeId.get(t.id) || [];
    const parsedRows = list.map((r) => {
      const obj = safeParse(r.data_json);
      return {
        key_value: r.key_value,
        status: r.status,
        _obj: typeof obj === 'object' && obj ? obj : {}
      };
    });

    const fixedColumns = [
      { key: 'key_value', title: 'Key', width: 140 },
      { key: 'status', title: '状态', width: 60 }
    ];

    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const fixedWidth = fixedColumns.reduce((sum, c) => sum + c.width, 0);
    const minDynamicWidth = 90;
    const maxDynamicCols = Math.max(1, Math.floor((availableWidth - fixedWidth) / minDynamicWidth));
    const chunks = [];
    if (!fields.length) {
      chunks.push([]);
    } else {
      for (let i = 0; i < fields.length; i += maxDynamicCols) chunks.push(fields.slice(i, i + maxDynamicCols));
    }

    chunks.forEach((chunk, idx) => {
      ensureSpace(40);
      if (chunks.length > 1) {
        doc.fillColor(muted).fontSize(9).text(`字段分组：${idx + 1}/${chunks.length}`);
        doc.moveDown(0.2);
      }

      const dynamicCols = chunk.map((f) => ({
        key: `f_${f.field_code}`,
        title: f.field_name || f.field_code,
        width: Math.max(minDynamicWidth, Math.floor((availableWidth - fixedWidth) / Math.max(1, chunk.length)))
      }));
      const tableRows = parsedRows.map((r) => {
        const out = { key_value: r.key_value, status: r.status };
        chunk.forEach((f) => {
          out[`f_${f.field_code}`] = toCellText(r._obj[f.field_code]);
        });
        return out;
      });

      drawTable(doc, {
        columns: [...fixedColumns, ...dynamicCols],
        rows: tableRows,
        fontSize: 8.5,
        headerFontSize: 8.5,
        minRowHeight: 18
      });
      doc.moveDown(0.8);
    });

    doc.moveDown(0.8);
  });

  doc.end();
});

app.post('/api/versions/:versionId/data/import', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const versionId = Number(req.params.versionId);
  const body = req.body || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const typeId = Number(body.typeId);
  const envId = Number(body.envId);
  const version = db.prepare(`SELECT status, app_id FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'RELEASED') return res.status(400).json({ error: 'only released version editable' });
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  if (!envId) return res.status(400).json({ error: 'envId required' });
  const env = db.prepare(`SELECT * FROM environments WHERE id = ?`).get(envId);
  if (!env) return res.status(404).json({ error: 'env not found' });
  const typeRow = db.prepare(`SELECT * FROM config_types WHERE id = ?`).get(typeId);
  if (!typeRow) return res.status(404).json({ error: 'type not found' });
  if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) return res.status(400).json({ error: 'type not belong to app' });
  if (env.app_id && version.app_id && env.app_id !== version.app_id) return res.status(400).json({ error: 'env not belong to app' });
  if (!rows.length) return res.status(400).json({ error: 'no rows' });
  const fields = db.prepare(`SELECT field_code FROM config_fields WHERE type_id = ?`).all(typeId);
  const fieldSet = new Set(fields.map((f) => f.field_code));
  const upsert = db.prepare(`
    INSERT INTO config_data (type_id, version_id, env_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
    VALUES (@type_id, @version_id, @env_id, @key_value, @data_json, @status, @actor, @actor, @now, @now)
    ON CONFLICT(version_id, env_id, key_value) DO UPDATE SET
      data_json=excluded.data_json,
      status=excluded.status,
      update_user=excluded.update_user,
      update_time=excluded.update_time
  `);
  const actor = req.headers['x-user'] || 'system';
  const nowVal = now();
  const tx = db.transaction(() => {
    rows.forEach((r) => {
      const key = r.key_value || r.key;
      if (!key) throw new Error('missing key_value');
      const data = {};
      fieldSet.forEach((fc) => {
        if (r[fc] !== undefined) data[fc] = r[fc];
      });
      upsert.run({
        type_id: typeId,
        version_id: versionId,
        env_id: envId,
        key_value: key,
        data_json: JSON.stringify(data),
        status: r.status || 'ENABLED',
        actor,
        now: nowVal
      });
    });
  });
  try {
    tx();
    audit(actor, 'IMPORT_DATA', 'ConfigData', versionId, { count: rows.length });
    res.json({ imported: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/data/:id', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT cd.id, v.status FROM config_data cd JOIN config_versions v ON cd.version_id = v.id WHERE cd.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status !== 'RELEASED') return res.status(400).json({ error: 'only released version editable' });
  const info = db.prepare(`DELETE FROM config_data WHERE id = ?`).run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  audit(req.headers['x-user'], 'DELETE_DATA', 'ConfigData', id, {});
  res.json({ id });
});

// --- Config Fetch API ---------------------------------------------------- //
app.get('/api/config/:appCode/:typeCode/:key', (req, res) => {
  const { appCode, typeCode, key } = req.params;
  const env = req.query.env || 'prod';
  const appRow = db.prepare(`SELECT id FROM applications WHERE app_code = ?`).get(appCode);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  const envRow = db.prepare(`SELECT id FROM environments WHERE app_id = ? AND env_code = ?`).get(appRow.id, env);
  if (!envRow) return res.status(404).json({ error: 'env not found' });
  const type = db
    .prepare(
      `SELECT id, app_id
       FROM config_types
       WHERE app_id = ? AND type_code = ? AND (env_id = ? OR env_id IS NULL)
       ORDER BY env_id IS NULL, id DESC
       LIMIT 1`
    )
    .get(appRow.id, typeCode, envRow.id);
  if (!type) return res.status(404).json({ error: 'type not found' });
  const released = db
    .prepare(`SELECT id FROM config_versions WHERE app_id IS ? AND status = 'RELEASED' ORDER BY release_time DESC, id DESC LIMIT 1`)
    .get(type.app_id ?? null);
  if (!released) return res.status(404).json({ error: 'no released version' });
  const row = db
    .prepare(
      `SELECT data_json, status
       FROM config_data
       WHERE version_id = ? AND type_id = ? AND key_value = ? AND (env_id = ? OR env_id IS NULL)
       ORDER BY env_id IS NULL, id DESC
       LIMIT 1`
    )
    .get(released.id, type.id, key, envRow.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ key, data: JSON.parse(row.data_json), status: row.status });
});

app.get('/api/config/:appCode/:typeCode', (req, res) => {
  const { appCode, typeCode } = req.params;
  const env = req.query.env || 'prod';
  const appRow = db.prepare(`SELECT id FROM applications WHERE app_code = ?`).get(appCode);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  const envRow = db.prepare(`SELECT id FROM environments WHERE app_id = ? AND env_code = ?`).get(appRow.id, env);
  if (!envRow) return res.status(404).json({ error: 'env not found' });
  const type = db
    .prepare(
      `SELECT id, app_id
       FROM config_types
       WHERE app_id = ? AND type_code = ? AND (env_id = ? OR env_id IS NULL)
       ORDER BY env_id IS NULL, id DESC
       LIMIT 1`
    )
    .get(appRow.id, typeCode, envRow.id);
  if (!type) return res.status(404).json({ error: 'type not found' });
  const released = db
    .prepare(`SELECT id FROM config_versions WHERE app_id IS ? AND status = 'RELEASED' ORDER BY release_time DESC, id DESC LIMIT 1`)
    .get(type.app_id ?? null);
  if (!released) return res.status(404).json({ error: 'no released version' });
  const rows = db
    .prepare(
      `SELECT key_value, data_json, status
       FROM config_data
       WHERE version_id = ? AND type_id = ? AND (env_id = ? OR env_id IS NULL)
       ORDER BY env_id IS NULL, key_value`
    )
    .all(released.id, type.id, envRow.id);
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

function toCellText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function truncateToWidth(doc, text, width) {
  const s = String(text ?? '');
  if (!s) return '';
  if (doc.widthOfString(s) <= width) return s;
  const ell = '…';
  if (doc.widthOfString(ell) > width) return '';
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const sub = s.slice(0, mid) + ell;
    if (doc.widthOfString(sub) <= width) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + ell;
}

function drawTable(doc, opts) {
  const {
    columns,
    rows,
    fontSize = 9,
    headerFontSize = 9,
    minRowHeight = 18,
    paddingX = 4,
    paddingY = 4,
    borderColor = '#e5e7eb',
    headerFill = '#f9fafb',
    zebraFill = '#fcfcfd',
    textColor = '#111827',
    mutedColor = '#6b7280'
  } = opts;

  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (minSpace) => {
    if (doc.y + minSpace > pageBottom()) doc.addPage();
  };

  const startX = doc.page.margins.left;
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const scale = totalWidth > 0 ? Math.min(1, availableWidth / totalWidth) : 1;
  const cols = columns.map((c) => ({ ...c, width: Math.max(30, Math.floor(c.width * scale)) }));

  const drawHeader = () => {
    ensureSpace(minRowHeight + 4);
    const y = doc.y;
    doc.save();
    doc.fillColor(headerFill).rect(startX, y, availableWidth, minRowHeight).fill();
    doc.restore();
    doc.strokeColor(borderColor).lineWidth(1).rect(startX, y, availableWidth, minRowHeight).stroke();

    let x = startX;
    cols.forEach((c) => {
      doc.strokeColor(borderColor).lineWidth(1).moveTo(x, y).lineTo(x, y + minRowHeight).stroke();
      doc.fillColor(mutedColor).fontSize(headerFontSize).text(truncateToWidth(doc, c.title, c.width - paddingX * 2), x + paddingX, y + paddingY, {
        width: c.width - paddingX * 2,
        height: minRowHeight - paddingY * 2
      });
      x += c.width;
    });
    doc.strokeColor(borderColor).lineWidth(1).moveTo(startX + availableWidth, y).lineTo(startX + availableWidth, y + minRowHeight).stroke();
    doc.y = y + minRowHeight;
  };

  const drawRow = (row, index) => {
    const y = doc.y;
    const rowHeight = minRowHeight;
    ensureSpace(rowHeight + 4);

    if (index % 2 === 1) {
      doc.save();
      doc.fillColor(zebraFill).rect(startX, y, availableWidth, rowHeight).fill();
      doc.restore();
    }
    doc.strokeColor(borderColor).lineWidth(1).rect(startX, y, availableWidth, rowHeight).stroke();

    let x = startX;
    cols.forEach((c) => {
      const val = row[c.key];
      const txt = truncateToWidth(doc, toCellText(val), c.width - paddingX * 2);
      doc.strokeColor(borderColor).lineWidth(1).moveTo(x, y).lineTo(x, y + rowHeight).stroke();
      doc.fillColor(textColor).fontSize(fontSize).text(txt, x + paddingX, y + paddingY, {
        width: c.width - paddingX * 2,
        height: rowHeight - paddingY * 2
      });
      x += c.width;
    });
    doc.strokeColor(borderColor).lineWidth(1).moveTo(startX + availableWidth, y).lineTo(startX + availableWidth, y + rowHeight).stroke();
    doc.y = y + rowHeight;
  };

  drawHeader();
  rows.forEach((r, idx) => {
    if (doc.y + minRowHeight * 1.2 > pageBottom()) {
      doc.addPage();
      drawHeader();
    }
    drawRow(r, idx);
  });
};

function safeFilename(name) {
  const base = String(name || 'file')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'file';
}

function resolvePdfFontPaths() {
  const envPath = process.env.PDF_FONT_PATH;
  if (envPath) {
    try {
      if (fs.existsSync(envPath)) return [envPath];
    } catch {
      // ignore
    }
  }

  const winDir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    // Prefer standalone TTF first (PDFKit is more reliable than TTC on some setups).
    path.join(winDir, 'Fonts', 'simhei.ttf'), // 黑体
    path.join(winDir, 'Fonts', 'msyh.ttf'), // 微软雅黑 (rarely present)
    path.join(winDir, 'Fonts', 'arialuni.ttf'), // Arial Unicode (if present)
    // TTC fallbacks
    path.join(winDir, 'Fonts', 'msyh.ttc'), // 微软雅黑 TTC
    path.join(winDir, 'Fonts', 'simsun.ttc'), // 宋体 TTC
    // Last resort (no CJK)
    path.join(winDir, 'Fonts', 'arial.ttf')
  ];

  return candidates.filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

// --- Static (serve frontend build if exists) ----------------------------- //
const FRONT_DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(FRONT_DIST));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Config Center backend listening on http://localhost:${PORT}`);
});
