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
app.get('/api/versions/:typeId/fields', (req, res) => {
  const typeId = Number(req.params.typeId);
  const rows = db.prepare(`SELECT * FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(typeId);
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
  if (versionId) { sql += ` AND cf.version_id = ?`; params.push(versionId); }
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
  const { typeId } = req.query;
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  const rows = db.prepare(`SELECT * FROM config_data WHERE version_id = ? AND type_id = ? ORDER BY id DESC`).all(versionId, typeId);
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
  const typeRow = db.prepare(`SELECT * FROM config_types WHERE id = ?`).get(body.typeId);
  if (!typeRow) return res.status(404).json({ error: 'type not found' });
  if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) return res.status(400).json({ error: 'type not belong to app' });
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
    body.typeId,
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
  const version = db.prepare(`SELECT * FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  const fields = db.prepare(`SELECT field_code FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(typeId);
  const headers = ['key_value', ...fields.map((f) => f.field_code)];
  const rows = db.prepare(`SELECT key_value, data_json, status FROM config_data WHERE version_id = ? AND type_id = ? ORDER BY id`).all(versionId, typeId);
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

app.post('/api/versions/:versionId/data/import', (req, res) => {
  if (!requireRole(req, res, ['admin', 'appowner'])) return;
  const versionId = Number(req.params.versionId);
  const body = req.body || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const typeId = Number(body.typeId);
  const version = db.prepare(`SELECT status, app_id FROM config_versions WHERE id = ?`).get(versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });
  if (version.status !== 'RELEASED') return res.status(400).json({ error: 'only released version editable' });
  if (!typeId) return res.status(400).json({ error: 'typeId required' });
  const typeRow = db.prepare(`SELECT * FROM config_types WHERE id = ?`).get(typeId);
  if (!typeRow) return res.status(404).json({ error: 'type not found' });
  if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) return res.status(400).json({ error: 'type not belong to app' });
  if (!rows.length) return res.status(400).json({ error: 'no rows' });
  const fields = db.prepare(`SELECT field_code FROM config_fields WHERE type_id = ?`).all(typeId);
  const fieldSet = new Set(fields.map((f) => f.field_code));
  const upsert = db.prepare(`
    INSERT INTO config_data (type_id, version_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
    VALUES (@type_id, @version_id, @key_value, @data_json, @status, @actor, @actor, @now, @now)
    ON CONFLICT(version_id, key_value) DO UPDATE SET
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
