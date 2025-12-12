const { HttpError } = require('../utils/errors');

function errorHandler(err, req, res, _next) {
  const isHttp = err instanceof HttpError;
  const isSqlite = err && err.name === 'SqliteError';
  const status = isHttp ? err.status : isSqlite ? 400 : 500;

  const payload = { error: err?.message || 'internal error' };
  if (isHttp && err.details !== undefined) payload.details = err.details;
  if (process.env.NODE_ENV !== 'production' && !isHttp) payload.stack = err?.stack;
  if (req?.id) payload.requestId = req.id;

  if (res.headersSent) return;
  res.status(status).json(payload);
}

module.exports = { errorHandler };

