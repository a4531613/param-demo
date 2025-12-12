const express = require('express');
const { wrap } = require('../middleware/wrap');
const { HttpError } = require('../utils/errors');
const { safeParseJson } = require('../utils/safeJson');

function createConfigRouter({ db }) {
  const router = express.Router();

  router.get(
    '/config/:appCode/:typeCode/:key',
    wrap((req, res) => {
      const { appCode, typeCode, key } = req.params;
      const env = req.query.env || 'prod';

      const appRow = db.prepare(`SELECT id FROM applications WHERE app_code = ?`).get(appCode);
      if (!appRow) throw new HttpError(404, 'app not found');
      const envRow = db.prepare(`SELECT id FROM environments WHERE app_id = ? AND env_code = ?`).get(appRow.id, env);
      if (!envRow) throw new HttpError(404, 'env not found');

      const type = db
        .prepare(
          `SELECT id, app_id
           FROM config_types
           WHERE app_id = ? AND type_code = ? AND (env_id = ? OR env_id IS NULL)
           ORDER BY env_id IS NULL, id DESC
           LIMIT 1`
        )
        .get(appRow.id, typeCode, envRow.id);
      if (!type) throw new HttpError(404, 'type not found');

      const released = db
        .prepare(`SELECT id FROM config_versions WHERE app_id IS ? AND status = 'RELEASED' ORDER BY release_time DESC, id DESC LIMIT 1`)
        .get(type.app_id ?? null);
      if (!released) throw new HttpError(404, 'no released version');

      const row = db
        .prepare(
          `SELECT data_json, status
           FROM config_data
           WHERE version_id = ? AND type_id = ? AND key_value = ? AND (env_id = ? OR env_id IS NULL)
           ORDER BY env_id IS NULL, id DESC
           LIMIT 1`
        )
        .get(released.id, type.id, key, envRow.id);
      if (!row) throw new HttpError(404, 'not found');

      const parsed = safeParseJson(row.data_json, null);
      if (parsed === null) throw new HttpError(500, 'invalid data_json');
      res.json({ key, data: parsed, status: row.status });
    })
  );

  router.get(
    '/config/:appCode/:typeCode',
    wrap((req, res) => {
      const { appCode, typeCode } = req.params;
      const env = req.query.env || 'prod';

      const appRow = db.prepare(`SELECT id FROM applications WHERE app_code = ?`).get(appCode);
      if (!appRow) throw new HttpError(404, 'app not found');
      const envRow = db.prepare(`SELECT id FROM environments WHERE app_id = ? AND env_code = ?`).get(appRow.id, env);
      if (!envRow) throw new HttpError(404, 'env not found');

      const type = db
        .prepare(
          `SELECT id, app_id
           FROM config_types
           WHERE app_id = ? AND type_code = ? AND (env_id = ? OR env_id IS NULL)
           ORDER BY env_id IS NULL, id DESC
           LIMIT 1`
        )
        .get(appRow.id, typeCode, envRow.id);
      if (!type) throw new HttpError(404, 'type not found');

      const released = db
        .prepare(`SELECT id FROM config_versions WHERE app_id IS ? AND status = 'RELEASED' ORDER BY release_time DESC, id DESC LIMIT 1`)
        .get(type.app_id ?? null);
      if (!released) throw new HttpError(404, 'no released version');

      const rows = db
        .prepare(
          `SELECT key_value, data_json, status
           FROM config_data
           WHERE version_id = ? AND type_id = ? AND (env_id = ? OR env_id IS NULL)
           ORDER BY env_id IS NULL, key_value`
        )
        .all(released.id, type.id, envRow.id);
      res.json(
        rows.map((r) => ({
          key: r.key_value,
          data: safeParseJson(r.data_json, {}),
          status: r.status
        }))
      );
    })
  );

  return router;
}

module.exports = { createConfigRouter };

