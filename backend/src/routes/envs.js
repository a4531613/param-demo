const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function nextEnvCode(db, appId) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(code_num), 0) + 1 AS next_code
      FROM (
        SELECT CAST(env_code AS INTEGER) AS code_num
        FROM environments
        WHERE env_code GLOB '[0-9]*' AND app_id = ?
      )
    `
    )
    .get(appId);
  return String(row?.next_code || 1);
}

function createEnvsRouter({ db }) {
  const router = express.Router();

  router.get(
    '/envs',
    wrap((req, res) => {
      const { appId } = req.query;
      let sql = `SELECT e.*, a.app_name, a.app_code FROM environments e JOIN applications a ON e.app_id = a.id WHERE 1=1`;
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
      const appId = Number(body.appId);
      if (!appId) throw new HttpError(400, 'appId required');
      if (!body.envName) throw new HttpError(400, 'envName required');
      const actor = getActor(req);
      const stmt = db.prepare(
        `
        INSERT INTO environments (env_code, env_name, app_id, description, enabled, create_user, update_user, update_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      );
      const tx = db.transaction(() => {
        const envCode = body.envCode ? String(body.envCode) : nextEnvCode(db, appId);
        const info = stmt.run(
          envCode,
          body.envName,
          appId,
          body.description || '',
          body.enabled === false ? 0 : 1,
          actor,
          actor,
          nowIso()
        );
        return { info, envCode };
      });
      const { info, envCode } = tx();
      audit(db, actor, 'CREATE_ENV', 'Environment', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid, envCode });
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
