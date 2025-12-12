const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function createFieldsRouter({ db }) {
  const router = express.Router();

  // Back-compat: historically `/api/versions/:typeId/fields` actually takes a versionId in the frontend.
  router.get(
    '/versions/:typeId/fields',
    wrap((req, res) => {
      const idParam = toInt(req.params.typeId, 'typeId');
      const version = db.prepare(`SELECT id, app_id FROM config_versions WHERE id = ?`).get(idParam);
      if (version) {
        const rows = db
          .prepare(
            `
            SELECT cf.*, t.app_id, t.type_code
            FROM config_fields cf
            JOIN config_types t ON cf.type_id = t.id
            WHERE t.app_id IS ?
            ORDER BY cf.sort_order, cf.id
          `
          )
          .all(version.app_id ?? null);
        return res.json(rows);
      }

      const typeId = idParam;
      const rows = db.prepare(`SELECT * FROM config_fields WHERE type_id = ? ORDER BY sort_order, id`).all(typeId);
      return res.json(rows);
    })
  );

  // Create field in the context of a version (validated against version.app_id + type.app_id)
  router.post(
    '/versions/:versionId/fields',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const versionId = toInt(req.params.versionId, 'versionId');
      const body = req.body || {};
      const actor = getActor(req);

      const version = db.prepare(`SELECT id, app_id, status FROM config_versions WHERE id = ?`).get(versionId);
      if (!version) throw new HttpError(404, 'version not found');
      if (version.status !== 'PENDING_RELEASE') throw new HttpError(400, 'only pending version editable');

      const typeId = Number(body.typeId);
      if (!typeId) throw new HttpError(400, 'typeId required');
      const typeRow = db.prepare(`SELECT id, app_id FROM config_types WHERE id = ?`).get(typeId);
      if (!typeRow) throw new HttpError(404, 'type not found');
      if ((typeRow.app_id ?? null) !== (version.app_id ?? null)) throw new HttpError(400, 'type does not belong to version app');

      const stmt = db.prepare(`
        INSERT INTO config_fields (type_id, field_code, field_name, field_type, data_type, max_length, required, default_value, validate_rule, enum_options, unique_key_part, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        typeId,
        body.fieldCode,
        body.fieldName,
        body.fieldType || null,
        body.dataType || 'string',
        body.maxLength || null,
        body.required ? 1 : 0,
        body.defaultValue || null,
        body.validateRule || null,
        body.enumOptions ? JSON.stringify(body.enumOptions) : null,
        body.uniqueKeyPart ? 1 : 0,
        body.sortOrder || 0
      );
      audit(db, actor, 'CREATE_FIELD', 'ConfigField', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  // General fields API with app/env/type filters
  router.get(
    '/fields',
    wrap((req, res) => {
      const { appId, typeId } = req.query;
      let sql = `
        SELECT cf.*, t.app_id, t.type_code
        FROM config_fields cf
        JOIN config_types t ON cf.type_id = t.id
        WHERE 1=1
      `;
      const params = [];
      if (appId) { sql += ` AND t.app_id = ?`; params.push(appId); }
      if (typeId) { sql += ` AND cf.type_id = ?`; params.push(typeId); }
      sql += ` ORDER BY cf.sort_order, cf.id DESC`;
      res.json(db.prepare(sql).all(params));
    })
  );

  router.post(
    '/fields',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          INSERT INTO config_fields (type_id, field_code, field_name, field_type, data_type, max_length, required, default_value, validate_rule, enum_options, unique_key_part, sort_order, enabled, create_user, update_user, update_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          body.typeId,
          body.fieldCode,
          body.fieldName,
          body.fieldType || null,
          body.dataType || 'string',
          body.maxLength || null,
          body.required ? 1 : 0,
          body.defaultValue || null,
          body.validateRule || null,
          body.enumOptions ? JSON.stringify(body.enumOptions) : null,
          body.uniqueKeyPart ? 1 : 0,
          body.sortOrder || 0,
          body.enabled === false ? 0 : 1,
          actor,
          actor,
          nowIso()
        );
      audit(db, actor, 'CREATE_FIELD', 'ConfigField', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  router.patch(
    '/fields/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const body = req.body || {};
      const actor = getActor(req);
      const field = db.prepare(`SELECT id FROM config_fields WHERE id = ?`).get(id);
      if (!field) throw new HttpError(404, 'not found');

      const info = db
        .prepare(
          `
          UPDATE config_fields
          SET field_name = COALESCE(@field_name, field_name),
              field_type = COALESCE(@field_type, field_type),
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
        `
        )
        .run({
          id,
          field_name: body.fieldName ?? null,
          field_type: body.fieldType ?? null,
          data_type: body.dataType ?? null,
          max_length: body.maxLength ?? null,
          required: body.required === undefined ? null : body.required ? 1 : 0,
          default_value: body.defaultValue ?? null,
          validate_rule: body.validateRule ?? null,
          enum_options: body.enumOptions ? JSON.stringify(body.enumOptions) : null,
          unique_key_part: body.uniqueKeyPart === undefined ? null : body.uniqueKeyPart ? 1 : 0,
          sort_order: body.sortOrder ?? null,
          enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
          actor,
          now: nowIso()
        });
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'UPDATE_FIELD', 'ConfigField', id, body);
      res.json({ id });
    })
  );

  router.delete(
    '/fields/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const info = db.prepare(`DELETE FROM config_fields WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_FIELD', 'ConfigField', id, {});
      res.json({ id });
    })
  );

  return router;
}

module.exports = { createFieldsRouter };
