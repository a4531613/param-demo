const Database = require('better-sqlite3');
const { dbPath } = require('../config');
const { initSchema, ensureConfigDataEnv, ensureConfigFieldsFieldType } = require('./schema');

let db;

function getDb() {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  initSchema(db);
  ensureConfigDataEnv(db);
  ensureConfigFieldsFieldType(db);
  return db;
}

module.exports = { getDb };
