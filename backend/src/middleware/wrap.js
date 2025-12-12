function wrap(handler) {
  return (req, res, next) => {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { wrap };

