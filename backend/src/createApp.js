const path = require('path');
const express = require('express');
const cors = require('cors');
const { jsonLimit, rootDir } = require('./config');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const { createApiRouter } = require('./routes');

function createApp({ db }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: jsonLimit }));
  app.use(requestLogger);

  app.use('/api', createApiRouter({ db }));

  // Static (serve frontend build if exists)
  const frontDist = path.join(rootDir, 'frontend', 'dist');
  app.use(express.static(frontDist));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

