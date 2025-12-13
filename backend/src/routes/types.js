const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function nextTypeCode(db) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(code_num), 0) + 1 AS next_code
      FROM (
        SELECT CAST(type_code AS INTEGER) AS code_num
        FROM config_types
        WHERE type_code GLOB '[0-9]*'
      )
    `
    )
    .get();
  return String(row?.next_code || 1);
}

function createTypesRouter({ db }) {
  const router = express.Router();

  router.get(
    '/types',
    wrap((req, res) => {
      const { appId, envId, groupId } = req.query;
      let sql = `
        SELECT t.*, a.app_name, e.env_name, g.group_name, g.group_code
        FROM config_types t
        LEFT JOIN applications a ON t.app_id = a.id
        LEFT JOIN environments e ON t.env_id = e.id
        LEFT JOIN config_type_groups g ON t.group_id = g.id
        WHERE 1=1
      `;
      const params = [];
      if (appId) {
        sql += ` AND t.app_id = ?`;
        params.push(appId);
      }
      if (envId) {
        sql += ` AND t.env_id = ?`;
        params.push(envId);
      }
      if (groupId) {
        sql += ` AND t.group_id = ?`;
        params.push(groupId);
      }
      sql += ` ORDER BY t.sort_order, t.id DESC`;
      res.json(db.prepare(sql).all(params));
    })
  );

  router.get(
    '/types/next-code',
    wrap((_req, res) => {
      res.json({ next: nextTypeCode(db) });
    })
  );

  router.post(
    '/types',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const body = req.body || {};
      if (!body.appId) throw new HttpError(400, 'appId required');
      if (!body.typeName) throw new HttpError(400, 'typeName required');

      const actor = getActor(req);
      const stmt = db.prepare(`
        INSERT INTO config_types (type_code, type_name, app_id, env_id, group_id, biz_domain, description, enabled, sort_order, create_user, update_user, update_time)
        VALUES (@type_code, @type_name, @app_id, @env_id, @group_id, @biz_domain, @description, @enabled, @sort_order, @actor, @actor, @now)
      `);
      const tx = db.transaction(() => {
        const typeCode = nextTypeCode(db);
        const info = stmt.run({
          type_code: typeCode,
          type_name: body.typeName,
          app_id: body.appId || null,
          env_id: body.envId || null,
          group_id: body.groupId || null,
          biz_domain: body.bizDomain || null,
          description: body.description || '',
          enabled: body.enabled ? 1 : 0,
          sort_order: body.sortOrder || 0,
          actor,
          now: nowIso()
        });
        return { info, typeCode };
      });

      const { info, typeCode } = tx();
      audit(db, actor, 'CREATE_TYPE', 'ConfigType', info.lastInsertRowid, { ...body, typeCode });
      res.status(201).json({ id: info.lastInsertRowid, typeCode });
    })
  );

  router.patch(
    '/types/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          UPDATE config_types
          SET type_name = COALESCE(@type_name, type_name),
              description = COALESCE(@description, description),
              enabled = COALESCE(@enabled, enabled),
              group_id = COALESCE(@group_id, group_id),
              biz_domain = COALESCE(@biz_domain, biz_domain),
              env_id = COALESCE(@env_id, env_id),
              app_id = COALESCE(@app_id, app_id),
              sort_order = COALESCE(@sort_order, sort_order),
              update_user = @actor,
              update_time = @now
          WHERE id = @id
        `
        )
        .run({
          id,
          type_name: body.typeName ?? null,
          description: body.description ?? null,
          enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
          group_id: body.groupId ?? null,
          biz_domain: body.bizDomain ?? null,
          env_id: body.envId ?? null,
          app_id: body.appId ?? null,
          sort_order: body.sortOrder ?? null,
          actor,
          now: nowIso()
        });
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'UPDATE_TYPE', 'ConfigType', id, body);
      res.json({ id });
    })
  );

  router.delete(
    '/types/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const info = db.prepare(`DELETE FROM config_types WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_TYPE', 'ConfigType', id, {});
      res.json({ id });
    })
  );

  return router;
}

module.exports = { createTypesRouter };
