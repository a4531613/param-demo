const { port } = require('./config');
const { getDb } = require('./db');
const { createApp } = require('./createApp');

function start() {
  const db = getDb();
  const app = createApp({ db });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Config Center backend listening on http://localhost:${port}`);
  });
}

module.exports = { start };

