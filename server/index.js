const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { initDb } = require('./db');
const { createRoutes } = require('./routes');

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function startServer({ dbPath, port = 4317 }) {
  const db = initDb(dbPath);
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createRoutes(db));

  app.get('/health', (req, res) => res.json({ ok: true, version: '0.1.0' }));

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', (err) => {
      if (err) return reject(err);
      const ip = getLocalIp();
      console.log(`Neuralab server listening on http://${ip}:${port}`);
      resolve({ server, db, ip, port });
    });
  });
}

module.exports = { startServer, getLocalIp };
