const express = require('express');
const { createAppsRouter } = require('./apps');
const { createEnvsRouter } = require('./envs');
const { createTypesRouter } = require('./types');
const { createVersionsRouter } = require('./versions');
const { createFieldsRouter } = require('./fields');
const { createDataRouter } = require('./data');
const { createExportRouter } = require('./export');
const { createConfigRouter } = require('./config');
const { createAuditRouter } = require('./audit');

function createApiRouter({ db }) {
  const router = express.Router();
  router.use(createAppsRouter({ db }));
  router.use(createEnvsRouter({ db }));
  router.use(createTypesRouter({ db }));
  router.use(createVersionsRouter({ db }));
  router.use(createFieldsRouter({ db }));
  router.use(createDataRouter({ db }));
  router.use(createExportRouter({ db }));
  router.use(createConfigRouter({ db }));
  router.use(createAuditRouter({ db }));
  return router;
}

module.exports = { createApiRouter };

