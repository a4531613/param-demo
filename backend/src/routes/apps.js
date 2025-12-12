const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function createAppsRouter({ db }) {
  const router = express.Router();

  router.get(
    '/apps',
    wrap((_req, res) => {
      const rows = db.prepare(`SELECT * FROM applications ORDER BY id DESC`).all();
      res.json(rows);
    })
  );

  router.post(
    '/apps',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          INSERT INTO applications (app_code, app_name, description, enabled, create_user, update_user, update_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          body.appCode,
          body.appName || body.appCode,
          body.description || '',
          body.enabled === false ? 0 : 1,
          actor,
          actor,
          nowIso()
        );
      audit(db, actor, 'CREATE_APP', 'Application', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  router.patch(
    '/apps/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const body = req.body || {};
      const actor = getActor(req);
      const info = db
        .prepare(
          `
          UPDATE applications
          SET app_name = COALESCE(@app_name, app_name),
              description = COALESCE(@description, description),
              enabled = COALESCE(@enabled, enabled),
              update_user = @actor,
              update_time = @now
          WHERE id = @id
        `
        )
        .run({
          id,
          app_name: body.appName ?? null,
          description: body.description ?? null,
          enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
          actor,
          now: nowIso()
        });
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'UPDATE_APP', 'Application', id, body);
      res.json({ id });
    })
  );

  router.delete(
    '/apps/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const info = db.prepare(`DELETE FROM applications WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_APP', 'Application', id, {});
      res.json({ id });
    })
  );

  return router;
}

module.exports = { createAppsRouter };

