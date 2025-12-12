const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function createEnvsRouter({ db }) {
  const router = express.Router();

  router.get(
    '/envs',
    wrap((req, res) => {
      const { appId } = req.query;
      let sql = `SELECT e.*, a.app_code FROM environments e JOIN applications a ON e.app_id = a.id WHERE 1=1`;
      const params = [];
      if (appId) {
        sql += ` AND e.app_id = ?`;
        params.push(appId);
      }
      sql += ` ORDER BY e.id DESC`;
      res.json(db.prepare(sql).all(params));
    })
  );

  router.post(
    '/envs',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          INSERT INTO environments (env_code, env_name, app_id, description, enabled, create_user, update_user, update_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          body.envCode,
          body.envName,
          body.appId,
          body.description || '',
          body.enabled === false ? 0 : 1,
          actor,
          actor,
          nowIso()
        );
      audit(db, actor, 'CREATE_ENV', 'Environment', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  router.patch(
    '/envs/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          UPDATE environments
          SET env_name = COALESCE(@env_name, env_name),
              description = COALESCE(@description, description),
              enabled = COALESCE(@enabled, enabled),
              update_user = @actor,
              update_time = @now
          WHERE id = @id
        `
        )
        .run({
          id,
          env_name: body.envName ?? null,
          description: body.description ?? null,
          enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
          actor,
          now: nowIso()
        });
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'UPDATE_ENV', 'Environment', id, body);
      res.json({ id });
    })
  );

  router.delete(
    '/envs/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const info = db.prepare(`DELETE FROM environments WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_ENV', 'Environment', id, {});
      res.json({ id });
    })
  );

  return router;
}

module.exports = { createEnvsRouter };

