const { HttpError } = require('./errors');

function toInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || Number.isNaN(n)) throw new HttpError(400, `${name} must be a number`);
  return n;
}

function toOptionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  return n;
}

function getActor(req) {
  return req.headers['x-user'] || 'system';
}

function getRole(req) {
  return String(req.headers['x-role'] || '').toLowerCase();
}

module.exports = { toInt, toOptionalInt, getActor, getRole };

