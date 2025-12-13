const express = require('express');
const { wrap } = require('../middleware/wrap');
const { HttpError } = require('../utils/errors');
const { toInt } = require('../utils/http');

function createSearchRouter({ db }) {
  const router = express.Router();

  router.get(
    '/search/data',
    wrap((req, res) => {
      const appId = req.query.appId ? toInt(req.query.appId, 'appId') : null;
      const envId = req.query.envId ? toInt(req.query.envId, 'envId') : null;
      const typeId = req.query.typeId ? toInt(req.query.typeId, 'typeId') : null;
      const groupId = req.query.groupId ? toInt(req.query.groupId, 'groupId') : null;
      const q = String(req.query.q || '').trim();
      const pageRaw = req.query.page ? Number(req.query.page) : 1;
      const pageSizeRaw = req.query.pageSize ? Number(req.query.pageSize) : (req.query.limit ? Number(req.query.limit) : 10);
      const page = Math.max(Number.isFinite(pageRaw) ? pageRaw : 1, 1);
      const pageSize = Math.min(Math.max(Number.isFinite(pageSizeRaw) ? pageSizeRaw : 10, 1), 100);
      const offset = (page - 1) * pageSize;

      if (!q) throw new HttpError(400, 'q required');

      const like = `%${q}%`;
      const baseFromWhere = `
        FROM config_data cd
        JOIN config_versions v ON cd.version_id = v.id
        JOIN config_types t ON cd.type_id = t.id
        LEFT JOIN applications a ON v.app_id = a.id
        LEFT JOIN environments e ON cd.env_id = e.id
        LEFT JOIN config_type_groups g ON t.group_id = g.id
        WHERE v.status IN ('RELEASED', 'ARCHIVED')
          AND (? IS NULL OR v.app_id = ?)
          AND (? IS NULL OR cd.env_id = ?)
          AND (? IS NULL OR cd.type_id = ?)
          AND (? IS NULL OR t.group_id = ?)
          AND (cd.key_value LIKE ? OR cd.data_json LIKE ?)
      `;
      const params = [appId, appId, envId, envId, typeId, typeId, groupId, groupId, like, like];

      const total = db.prepare(`SELECT COUNT(1) AS c ${baseFromWhere}`).get(...params)?.c || 0;
      const rows = db
        .prepare(
          `
          SELECT
            cd.id,
            cd.version_id,
            v.version_no,
            v.status AS version_status,
            v.app_id,
            a.app_name,
            cd.env_id,
            e.env_name,
            cd.type_id,
            t.type_name,
            t.group_id,
            g.group_name,
            cd.key_value,
            cd.status,
            cd.data_json,
            cd.update_time
          ${baseFromWhere}
          ORDER BY v.id DESC, t.sort_order, t.id, cd.key_value
          LIMIT ? OFFSET ?
        `
        )
        .all(...params, pageSize, offset);

      res.json({ rows, total, page, pageSize });
    })
  );

  return router;
}

module.exports = { createSearchRouter };
