function ensureConfigDataEnv(db) {
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

function ensureConfigFieldsFieldType(db) {
  const hasFieldType = db.prepare(`PRAGMA table_info(config_fields)`).all().some((c) => c.name === 'field_type');
  if (!hasFieldType) {
    db.exec(`ALTER TABLE config_fields ADD COLUMN field_type TEXT`);
  }
}

function ensureConfigTypeGroups(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_type_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_code TEXT NOT NULL,
      group_name TEXT NOT NULL,
      app_id INTEGER,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      create_user TEXT,
      create_time TEXT DEFAULT (datetime('now')),
      update_user TEXT,
      update_time TEXT DEFAULT (datetime('now')),
      UNIQUE(group_code, app_id),
      FOREIGN KEY(app_id) REFERENCES applications(id) ON DELETE SET NULL
    );
  `);
}

function ensureConfigTypesGroupId(db) {
  const hasGroupId = db.prepare(`PRAGMA table_info(config_types)`).all().some((c) => c.name === 'group_id');
  if (!hasGroupId) {
    db.exec(`ALTER TABLE config_types ADD COLUMN group_id INTEGER`);
  }
}

function seedDefaultTypeGroups(db) {
  // Create a default group per app_id and attach existing types that have no group_id.
  const apps = db
    .prepare(`SELECT DISTINCT app_id FROM config_types`)
    .all()
    .map((r) => r.app_id ?? null)
    .filter((id) => id !== null && id !== undefined);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO config_type_groups (group_code, group_name, app_id, description, enabled, sort_order)
    VALUES (@group_code, @group_name, @app_id, @description, 1, 0)
  `);
  const find = db.prepare(`SELECT id FROM config_type_groups WHERE group_code = @group_code AND app_id IS @app_id`);
  const updateTypes = db.prepare(`UPDATE config_types SET group_id = @group_id WHERE group_id IS NULL AND app_id IS @app_id`);

  const tx = db.transaction(() => {
    apps.forEach((appId) => {
      const groupCode = 'default';
      insert.run({ group_code: groupCode, group_name: '默认大类', app_id: appId, description: '自动生成的默认大类' });
      const group = find.get({ group_code: groupCode, app_id: appId });
      if (group?.id) updateTypes.run({ group_id: group.id, app_id: appId });
    });
  });
  tx();
}

function cleanupDuplicateTypeGroups(db) {
  const dupRows = db
    .prepare(
      `
      SELECT group_code, app_id, MIN(id) AS keep_id, GROUP_CONCAT(id) AS ids, COUNT(*) AS cnt
      FROM config_type_groups
      GROUP BY group_code, app_id
      HAVING cnt > 1
    `
    )
    .all();
  if (!dupRows.length) return;

  const updateTypes = db.prepare(`UPDATE config_types SET group_id = @keepId WHERE group_id = @oldId`);
  const deleteGroup = db.prepare(`DELETE FROM config_type_groups WHERE id = ?`);

  const tx = db.transaction(() => {
    dupRows.forEach((r) => {
      const keepId = r.keep_id;
      const ids = String(r.ids || '')
        .split(',')
        .map((x) => Number(x))
        .filter(Boolean)
        .filter((x) => x !== keepId);
      ids.forEach((oldId) => {
        updateTypes.run({ keepId, oldId });
        deleteGroup.run(oldId);
      });
    });
  });
  tx();
}

function migrateConfigVersions(db) {
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

function initSchema(db) {
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
  CREATE TABLE IF NOT EXISTS config_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL,
    field_code TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_type TEXT,
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
  migrateConfigVersions(db);
}

module.exports = {
  initSchema,
  ensureConfigDataEnv,
  ensureConfigFieldsFieldType,
  ensureConfigTypeGroups,
  ensureConfigTypesGroupId,
  seedDefaultTypeGroups,
  cleanupDuplicateTypeGroups
};
