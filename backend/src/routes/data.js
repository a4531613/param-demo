const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function createDataRouter({ db }) {
  const router = express.Router();

  function ensureKeyExistsAcrossEnvs({ versionId, appId, typeId, keyValue, dataJson, status, actor, nowVal }) {
    if (!appId) return;
    const envIds = db.prepare(`SELECT id FROM environments WHERE app_id = ?`).all(appId).map((r) => r.id);
    if (!envIds.length) return;
    const insertMissing = db.prepare(`
      INSERT OR IGNORE INTO config_data (type_id, version_id, env_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
      VALUES (@type_id, @version_id, @env_id, @key_value, @data_json, @status, @actor, @actor, @now, @now)
    `);

    const tx = db.transaction(() => {
      envIds.forEach((envId) => {
        insertMissing.run({
          type_id: typeId,
          version_id: versionId,
          env_id: envId,
          key_value: keyValue,
          data_json: JSON.stringify(dataJson || {}),
          status: status || 'DISABLED',
          actor,
          now: nowVal
        });
      });
    });
    tx();
  }

  router.get(
    '/versions/:versionId/data',
    wrap((req, res) => {
      const versionId = toInt(req.params.versionId, 'versionId');
      const { typeId, envId } = req.query;
      if (!typeId) throw new HttpError(400, 'typeId required');
      if (!envId) throw new HttpError(400, 'envId required');
      const rows = db
        .prepare(`SELECT * FROM config_data WHERE version_id = ? AND type_id = ? AND env_id = ? ORDER BY id DESC`)
        .all(versionId, typeId, envId);
      res.json(rows);
    })
  );

  router.get(
    '/versions/:versionId/data/all',
    wrap((req, res) => {
      const versionId = toInt(req.params.versionId, 'versionId');
      const rows = db
        .prepare(`SELECT id, type_id, version_id, env_id, key_value, data_json, status FROM config_data WHERE version_id = ? ORDER BY env_id, key_value`)
        .all(versionId);
      res.json(rows);
    })
  );

  router.post(
    '/versions/:versionId/data',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const versionId = toInt(req.params.versionId, 'versionId');
      const body = req.body || {};
      const actor = getActor(req);

      const version = db.prepare(`SELECT status, app_id FROM config_versions WHERE id = ?`).get(versionId);
      if (!version) throw new HttpError(404, 'version not found');
      if (version.status !== 'RELEASED') throw new HttpError(400, 'only released version editable');
      if (!body.typeId) throw new HttpError(400, 'typeId required');
      if (!body.envId) throw new HttpError(400, 'envId required');

      const env = db.prepare(`SELECT * FROM environments WHERE id = ?`).get(body.envId);
      if (!env) throw new HttpError(404, 'env not found');
      const typeRow = db.prepare(`SELECT * FROM config_types WHERE id = ?`).get(body.typeId);
      if (!typeRow) throw new HttpError(404, 'type not found');
      if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) throw new HttpError(400, 'type not belong to app');
      if (env.app_id && version.app_id && env.app_id !== version.app_id) throw new HttpError(400, 'env not belong to app');

      const stmt = db.prepare(`
        INSERT INTO config_data (type_id, version_id, env_id, key_value, data_json, status, create_user, update_user, create_time, update_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(version_id, type_id, env_id, key_value) DO UPDATE SET
          data_json=excluded.data_json,
          status=excluded.status,
          update_user=excluded.update_user,
          update_time=excluded.update_time
      `);
      stmt.run(
        body.typeId,
        versionId,
        body.envId,
        body.keyValue,
        JSON.stringify(body.dataJson || {}),
        body.status || 'ENABLED',
        actor,
        actor,
        nowIso(),
        nowIso()
      );

      ensureKeyExistsAcrossEnvs({
        versionId,
        appId: version.app_id ?? null,
        typeId: body.typeId,
        keyValue: body.keyValue,
        dataJson: body.dataJson || {},
        status: body.status || 'ENABLED',
        actor,
        nowVal: nowIso()
      });
      audit(db, actor, 'UPSERT_DATA', 'ConfigData', versionId, body);
      res.json({ ok: true });
    })
  );

  router.delete(
    '/versions/:versionId/data/by-key',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const versionId = toInt(req.params.versionId, 'versionId');
      const typeId = toInt(req.query.typeId, 'typeId');
      const keyValue = String(req.query.keyValue || '').trim();
      const actor = getActor(req);
      const nowVal = nowIso();

      if (!keyValue) throw new HttpError(400, 'keyValue required');

      const version = db.prepare(`SELECT status, app_id FROM config_versions WHERE id = ?`).get(versionId);
      if (!version) throw new HttpError(404, 'version not found');
      if (version.status !== 'RELEASED') throw new HttpError(400, 'only released version editable');

      const typeRow = db.prepare(`SELECT id, app_id FROM config_types WHERE id = ?`).get(typeId);
      if (!typeRow) throw new HttpError(404, 'type not found');
      if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) throw new HttpError(400, 'type not belong to app');

      const tx = db.transaction(() => {
        // ensure the key exists across envs, then disable across all envs
        ensureKeyExistsAcrossEnvs({
          versionId,
          appId: version.app_id ?? null,
          typeId,
          keyValue,
          dataJson: {},
          status: 'DISABLED',
          actor,
          nowVal
        });

        const info = db
          .prepare(
            `UPDATE config_data
             SET status = 'DISABLED', update_user = ?, update_time = ?
             WHERE version_id = ? AND type_id = ? AND key_value = ?`
          )
          .run(actor, nowVal, versionId, typeId, keyValue);
        return info;
      });

      const info = tx();
      audit(db, actor, 'DISABLE_DATA_BY_KEY', 'ConfigData', versionId, { typeId, keyValue, affected: info.changes, now: nowVal });
      res.json({ ok: true, affected: info.changes });
    })
  );

  // Permanent delete: only allowed when all env records of the key are DISABLED.
  router.delete(
    '/versions/:versionId/data/by-key/hard',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const versionId = toInt(req.params.versionId, 'versionId');
      const typeId = toInt(req.query.typeId, 'typeId');
      const keyValue = String(req.query.keyValue || '').trim();
      const actor = getActor(req);
      const nowVal = nowIso();

      if (!keyValue) throw new HttpError(400, 'keyValue required');

      const version = db.prepare(`SELECT status, app_id FROM config_versions WHERE id = ?`).get(versionId);
      if (!version) throw new HttpError(404, 'version not found');
      if (version.status !== 'RELEASED') throw new HttpError(400, 'only released version editable');

      const typeRow = db.prepare(`SELECT id, app_id FROM config_types WHERE id = ?`).get(typeId);
      if (!typeRow) throw new HttpError(404, 'type not found');
      if (typeRow.app_id && version.app_id && typeRow.app_id !== version.app_id) throw new HttpError(400, 'type not belong to app');

      const notDisabled = db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM config_data
           WHERE version_id = ? AND type_id = ? AND key_value = ? AND status <> 'DISABLED'`
        )
        .get(versionId, typeId, keyValue)?.c;
      if (Number(notDisabled || 0) > 0) throw new HttpError(400, 'only disabled data deletable');

      const info = db
        .prepare(`DELETE FROM config_data WHERE version_id = ? AND type_id = ? AND key_value = ?`)
        .run(versionId, typeId, keyValue);

      audit(db, actor, 'PURGE_DATA_BY_KEY', 'ConfigData', versionId, { typeId, keyValue, deleted: info.changes, now: nowVal });
      res.json({ ok: true, deleted: info.changes });
    })
  );

  router.delete(
    '/data/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const row = db
        .prepare(
          `SELECT cd.id, cd.status AS data_status, v.status AS version_status
           FROM config_data cd JOIN config_versions v ON cd.version_id = v.id
           WHERE cd.id = ?`
        )
        .get(id);
      if (!row) throw new HttpError(404, 'not found');
      if (row.version_status !== 'RELEASED') throw new HttpError(400, 'only released version editable');
      if (row.data_status !== 'DISABLED') throw new HttpError(400, 'only disabled data deletable');
      const info = db.prepare(`DELETE FROM config_data WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_DATA', 'ConfigData', id, {});
      res.json({ id });
    })
  );

  return router;
}

module.exports = { createDataRouter };
