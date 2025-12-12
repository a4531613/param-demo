const express = require('express');
const { wrap } = require('../middleware/wrap');
const { safeParseJson } = require('../utils/safeJson');

function createAuditRouter({ db }) {
  const router = express.Router();

  router.get(
    '/audit',
    wrap((_req, res) => {
      const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100`).all();
      res.json(rows.map((r) => ({ ...r, details: safeParseJson(r.details, r.details) })));
    })
  );

  return router;
}

module.exports = { createAuditRouter };

