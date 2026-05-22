const path = require('path');
const { startServer } = require('./index');

const dbPath = process.env.NEURALAB_DB || path.join(__dirname, '..', 'data', 'neuralab.db');
const port = Number(process.env.PORT) || 4317;

startServer({ dbPath, port }).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
