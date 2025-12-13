const Database = require('better-sqlite3');
const { dbPath } = require('../config');
const {
  initSchema,
  ensureConfigDataEnv,
  ensureConfigFieldsFieldType,
  ensureConfigFieldsCommon,
  ensureConfigTypeGroups,
  ensureConfigTypesGroupId,
  seedDefaultTypeGroups,
  cleanupDuplicateTypeGroups,
  cleanupReservedFieldCodes
} = require('./schema');

let db;

function getDb() {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  initSchema(db);
  ensureConfigDataEnv(db);
  ensureConfigFieldsFieldType(db);
  ensureConfigFieldsCommon(db);
  ensureConfigTypeGroups(db);
  ensureConfigTypesGroupId(db);
  seedDefaultTypeGroups(db);
  cleanupDuplicateTypeGroups(db);
  cleanupReservedFieldCodes(db, ['key']);
  return db;
}

module.exports = { getDb };
