const { HttpError } = require('./errors');
const { getRole } = require('./http');

function requireRole(req, allowed) {
  const role = getRole(req);
  if (!allowed.includes(role)) throw new HttpError(403, 'forbidden');
}

function isAdmin(req) {
  return getRole(req) === 'admin';
}

module.exports = { requireRole, isAdmin };

