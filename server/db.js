const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

function initDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      deadline INTEGER,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);

  const adminExists = db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare("INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)")
      .run(['admin', hash, 'Руководитель', 'admin']);
  }

  const boardExists = db.prepare("SELECT id FROM boards LIMIT 1").get();
  if (!boardExists) {
    const now = Date.now();
    const result = db.prepare("INSERT INTO boards (name, created_at) VALUES (?, ?)").run(['Задачи', now]);
    const boardId = Number(result.lastInsertRowid);
    const cols = ['К выполнению', 'В работе', 'Готово'];
    const insertCol = db.prepare("INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)");
    cols.forEach((name, idx) => insertCol.run([boardId, name, idx]));
  }

  return db;
}

module.exports = { initDb };
