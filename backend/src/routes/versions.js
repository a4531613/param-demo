const express = require('express');
const { wrap } = require('../middleware/wrap');
const { requireRole } = require('../utils/auth');
const { HttpError } = require('../utils/errors');
const { toInt, getActor } = require('../utils/http');
const { nowIso } = require('../utils/time');
const { audit } = require('../audit');

function canTransitionStatus(current, target) {
  if (current === target) return true;
  if (current === 'PENDING_RELEASE' && target === 'RELEASED') return true;
  if (current === 'RELEASED' && (target === 'ARCHIVED' || target === 'PENDING_RELEASE')) return true;
  if (current === 'ARCHIVED' && target === 'RELEASED') return true;
  return false;
}

function diffList(aList, bList, key) {
  const mapA = new Map(aList.map((x) => [x[key], x]));
  const mapB = new Map(bList.map((x) => [x[key], x]));
  const added = [];
  const removed = [];
  const changed = [];
  mapB.forEach((val, k) => { if (!mapA.has(k)) added.push(val); });
  mapA.forEach((val, k) => { if (!mapB.has(k)) removed.push(val); });
  mapA.forEach((val, k) => {
    if (mapB.has(k) && JSON.stringify(val) !== JSON.stringify(mapB.get(k))) {
      changed.push({ before: val, after: mapB.get(k) });
    }
  });
  return { added, removed, changed };
}

const versionAllowedStatuses = new Set(['PENDING_RELEASE', 'RELEASED', 'ARCHIVED']);

function createVersionsRouter({ db }) {
  const router = express.Router();

  router.get(
    '/types/:typeId/versions',
    wrap((req, res) => {
      const typeId = toInt(req.params.typeId, 'typeId');
      const type = db.prepare(`SELECT app_id FROM config_types WHERE id = ?`).get(typeId);
      if (!type) throw new HttpError(404, 'type not found');
      const rows = db.prepare(`SELECT * FROM config_versions WHERE app_id = ? ORDER BY id DESC`).all(type.app_id);
      res.json(rows);
    })
  );

  router.post(
    '/types/:typeId/versions',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const typeId = toInt(req.params.typeId, 'typeId');
      const body = req.body || {};
      const typeRow = db.prepare(`SELECT app_id FROM config_types WHERE id = ?`).get(typeId);
      if (!typeRow) throw new HttpError(404, 'type not found');
      const actor = getActor(req);
      const stmt = db.prepare(`
        INSERT INTO config_versions (app_id, version_no, status, description, enabled, create_user, create_time, update_user, update_time)
        VALUES (?, ?, 'PENDING_RELEASE', ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        typeRow.app_id,
        body.versionNo || String(Date.now()),
        body.description || '',
        body.enabled === false ? 0 : 1,
        actor,
        nowIso(),
        actor,
        nowIso()
      );
      audit(db, actor, 'CREATE_VERSION', 'ConfigVersion', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  router.post(
    '/versions',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const body = req.body || {};
      const actor = getActor(req);
      const versionNo = body.versionNo || String(Date.now());
      const stmt = db.prepare(`
        INSERT INTO config_versions (app_id, version_no, status, description, enabled, create_user, create_time, update_user, update_time)
        VALUES (?, ?, 'PENDING_RELEASE', ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        body.appId || null,
        versionNo,
        body.description || '',
        body.enabled === false ? 0 : 1,
        actor,
        nowIso(),
        actor,
        nowIso()
      );
      audit(db, actor, 'CREATE_VERSION', 'ConfigVersion', info.lastInsertRowid, body);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  router.patch(
    '/versions/:id/publish',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const version = db.prepare(`SELECT * FROM config_versions WHERE id = ?`).get(id);
      if (!version) throw new HttpError(404, 'version not found');
      if (!['PENDING_RELEASE', 'ARCHIVED'].includes(version.status)) {
        throw new HttpError(400, 'only PENDING_RELEASE or ARCHIVED can be published');
      }
      const actor = getActor(req);
      const tx = db.transaction(() => {
        db.prepare(`UPDATE config_versions SET status = 'RELEASED', release_user = ?, release_time = ? WHERE id = ?`).run(actor, nowIso(), id);
      });
      tx();
      audit(db, actor, 'PUBLISH_VERSION', 'ConfigVersion', id, {});
      res.json({ id, status: 'RELEASED' });
    })
  );

  router.get(
    '/versions',
    wrap((req, res) => {
      const { appId, status } = req.query;
      let sql = `
        SELECT v.*, a.app_code
        FROM config_versions v
        LEFT JOIN applications a ON v.app_id = a.id
        WHERE 1=1
      `;
      const params = [];
      if (appId) { sql += ` AND v.app_id = ?`; params.push(appId); }
      if (status) { sql += ` AND v.status = ?`; params.push(status); }
      sql += ` ORDER BY v.id DESC`;
      res.json(db.prepare(sql).all(params));
    })
  );

  router.patch(
    '/versions/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const body = req.body || {};
      const actor = getActor(req);
      const version = db.prepare(`SELECT id, status, app_id FROM config_versions WHERE id = ?`).get(id);
      if (!version) throw new HttpError(404, 'not found');

      let statusChanged = false;
      if (body.status) {
        const targetStatus = body.status;
        if (!versionAllowedStatuses.has(targetStatus)) throw new HttpError(400, 'invalid status');
        if (!canTransitionStatus(version.status, targetStatus)) throw new HttpError(400, 'status transition not allowed');
        const tx = db.transaction(() => {
          if (targetStatus === 'RELEASED') {
            db.prepare(`UPDATE config_versions SET status = 'RELEASED', release_user = ?, release_time = ? WHERE id = ?`).run(actor, nowIso(), id);
          } else if (targetStatus === 'PENDING_RELEASE') {
            db.prepare(`UPDATE config_versions SET status = 'PENDING_RELEASE', release_user = NULL, release_time = NULL WHERE id = ?`).run(id);
          } else if (targetStatus === 'ARCHIVED') {
            db.prepare(`UPDATE config_versions SET status = 'ARCHIVED', update_user = ?, update_time = ? WHERE id = ?`).run(actor, nowIso(), id);
          }
        });
        tx();
        statusChanged = true;
      }

      const hasMetaUpdate =
        body.versionNo !== undefined ||
        body.description !== undefined ||
        body.effectiveFrom !== undefined ||
        body.effectiveTo !== undefined ||
        body.enabled !== undefined;
      if (hasMetaUpdate && version.status !== 'PENDING_RELEASE') {
        throw new HttpError(400, 'only pending version editable');
      }

      const info = db
        .prepare(
          `
          UPDATE config_versions
          SET version_no = COALESCE(@version_no, version_no),
              description = COALESCE(@description, description),
              effective_from = COALESCE(@effective_from, effective_from),
              effective_to = COALESCE(@effective_to, effective_to),
              enabled = COALESCE(@enabled, enabled),
              update_user = @actor,
              update_time = @now
          WHERE id = @id
        `
        )
        .run({
          id,
          version_no: body.versionNo ?? null,
          description: body.description ?? null,
          effective_from: body.effectiveFrom ?? null,
          effective_to: body.effectiveTo ?? null,
          enabled: body.enabled === undefined ? null : body.enabled ? 1 : 0,
          actor,
          now: nowIso()
        });
      if (!info.changes && !statusChanged) throw new HttpError(404, 'not found');
      audit(db, actor, 'UPDATE_VERSION', 'ConfigVersion', id, body);
      res.json({ id });
    })
  );

  router.delete(
    '/versions/:id',
    wrap((req, res) => {
      requireRole(req, ['admin', 'appowner']);
      const id = toInt(req.params.id, 'id');
      const actor = getActor(req);
      const version = db.prepare(`SELECT status FROM config_versions WHERE id = ?`).get(id);
      if (!version) throw new HttpError(404, 'not found');
      if (version.status !== 'PENDING_RELEASE') throw new HttpError(400, 'only pending version deletable');
      const info = db.prepare(`DELETE FROM config_versions WHERE id = ?`).run(id);
      if (!info.changes) throw new HttpError(404, 'not found');
      audit(db, actor, 'DELETE_VERSION', 'ConfigVersion', id, {});
      res.json({ id });
    })
  );

  router.get(
    '/versions/:a/diff/:b',
    wrap((req, res) => {
      const a = toInt(req.params.a, 'a');
      const b = toInt(req.params.b, 'b');
      const verA = db.prepare(`SELECT id, app_id FROM config_versions WHERE id = ?`).get(a);
      const verB = db.prepare(`SELECT id, app_id FROM config_versions WHERE id = ?`).get(b);
      if (!verA || !verB) throw new HttpError(404, 'version not found');
      if ((verA.app_id ?? null) !== (verB.app_id ?? null)) throw new HttpError(400, 'versions must belong to same app');

      const fieldsSql = `
        SELECT cf.type_id, cf.field_code, cf.data_type, cf.required, cf.max_length, cf.validate_rule, cf.enum_options, cf.sort_order, cf.id
        FROM config_fields cf
        WHERE cf.type_id IS NULL
        UNION ALL
        SELECT cf.type_id, cf.field_code, cf.data_type, cf.required, cf.max_length, cf.validate_rule, cf.enum_options, cf.sort_order, cf.id
        FROM config_fields cf
        JOIN config_types t ON cf.type_id = t.id
        WHERE t.app_id IS ?
        ORDER BY type_id, sort_order, id
      `;
      const fieldsA = db.prepare(fieldsSql).all(verA.app_id ?? null).map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.field_code}` }));
      const fieldsB = db.prepare(fieldsSql).all(verB.app_id ?? null).map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.field_code}` }));
      const dataA = db
        .prepare(`SELECT type_id, env_id, key_value, data_json, status FROM config_data WHERE version_id = ?`)
        .all(a)
        .map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.env_id ?? ''}|${r.key_value}` }));
      const dataB = db
        .prepare(`SELECT type_id, env_id, key_value, data_json, status FROM config_data WHERE version_id = ?`)
        .all(b)
        .map((r) => ({ ...r, diff_key: `${r.type_id ?? ''}|${r.env_id ?? ''}|${r.key_value}` }));
      res.json({ fields: diffList(fieldsA, fieldsB, 'diff_key'), data: diffList(dataA, dataB, 'diff_key') });
    })
  );

  return router;
}

module.exports = { createVersionsRouter };
