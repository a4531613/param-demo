const { nowIso } = require('../utils/time');

function requestLogger(req, res, next) {
  const start = Date.now();
  const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  req.id = id;
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    const ms = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`${nowIso()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms rid=${id}`);
  });
  next();
}

module.exports = { requestLogger };

