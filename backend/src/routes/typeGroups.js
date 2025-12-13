const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function nextGroupCode(db, appId) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(code_num), 0) + 1 AS next_code
      FROM (
        SELECT CAST(group_code AS INTEGER) AS code_num
        FROM config_type_groups
        WHERE group_code GLOB '[0-9]*' AND app_id IS ?
      )
    `
    )
    .get(appId ?? null);
  return String(row?.next_code || 1);
}

function createTypeGroupsRouter({ db }) {
  const router = express.Router();

  router.get(
    '/type-groups',
    wrap((req, res) => {
      const { appId } = req.query;
      let sql = `
        SELECT g.*, a.app_name
        FROM config_type_groups g
        LEFT JOIN applications a ON g.app_id = a.id
        WHERE 1=1
      `;
      const params = [];
      if (appId !== undefined && appId !== null && appId !== '') {
        sql += ` AND g.app_id = ?`;
        params.push(appId);
      }
      sql += ` ORDER BY g.sort_order, g.id DESC`;
      res.json(db.prepare(sql).all(params));
    })
  );

  router.get(
    '/type-groups/next-code',
    wrap((req, res) => {
      const appId = req.query.appId ? Number(req.query.appId) : null;
      res.json({ next: nextGroupCode(db, appId) });
    })
  );

  router.post(
    '/type-groups',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const body = req.body || {};
      if (!body.appId) throw new HttpError(400, 'appId required');
      if (!body.groupName) throw new HttpError(400, 'groupName required');

      const actor = getActor(req);
      const stmt = db.prepare(`
        INSERT INTO config_type_groups (group_code, group_name, app_id, description, enabled, sort_order, create_user, update_user, update_time)
        VALUES (@group_code, @group_name, @app_id, @description, @enabled, @sort_order, @actor, @actor, @now)
      `);
      const tx = db.transaction(() => {
        const groupCode = nextGroupCode(db, body.appId);
        const info = stmt.run({
          group_code: groupCode,
          group_name: body.groupName,
          app_id: body.appId,
          description: body.description || '',
          enabled: body.enabled === false ? 0 : 1,
          sort_order: body.sortOrder || 0,
          actor,
          now: nowIso()
        });
        return { info, groupCode };
      });
      const { info, groupCode } = tx();
      audit(db, actor, 'CREATE_TYPE_GROUP', 'ConfigTypeGroup', info.lastInsertRowid, { ...body, groupCode });
      res.status(201).json({ id: info.lastInsertRowid, groupCode });
    })
  );

  router.patch(
    '/type-groups/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          UPDATE config_type_groups
          SET group_name = COALESCE(@group_name, group_name),
              description = COALESCE(@description, description),
              enabled = COALESCE(@enabled, enabled),
              sort_order = COALESCE(@sort_order, sort_order),
              update_user = @actor,
              update_time = @now
          WHERE id = @id
        `
        )
        .run({
          id,
          group_name: body.groupName ?? null,
          description: body.description ?? null,
          enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
          sort_order: body.sortOrder ?? null,
          actor,
          now: nowIso()
        });
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'UPDATE_TYPE_GROUP', 'ConfigTypeGroup', id, body);
      res.json({ id });
    })
  );

  router.delete(
    '/type-groups/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const info = db.prepare(`DELETE FROM config_type_groups WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_TYPE_GROUP', 'ConfigTypeGroup', id, {});
      res.json({ id });
    })
  );

  return router;
}

module.exports = { createTypeGroupsRouter };

