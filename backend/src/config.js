const path = require('path');

const rootDir = path.resolve(__dirname, '..');

module.exports = {
  rootDir,
  dbPath: path.join(rootDir, 'config-center.db'),
  port: Number(process.env.PORT) || 8000,
  jsonLimit: process.env.JSON_LIMIT || '2mb'
};

