const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function createRoutes(db) {
  const router = express.Router();

  function auth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'No token' });
    const row = db.prepare(`
      SELECT u.id, u.username, u.name, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token);
    if (!row) return res.status(401).json({ error: 'Invalid token' });
    req.user = row;
    next();
  }

  function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  }

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)")
      .run([token, user.id, Date.now()]);
    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role }
    });
  });

  router.post('/logout', auth, (req, res) => {
    const token = req.headers['x-auth-token'];
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    res.json({ ok: true });
  });

  router.get('/me', auth, (req, res) => {
    res.json({ user: req.user });
  });

  router.get('/users', auth, (req, res) => {
    const users = db.prepare("SELECT id, username, name, role FROM users ORDER BY name").all();
    res.json({ users });
  });

  router.post('/users', auth, adminOnly, (req, res) => {
    const { username, password, name, role } = req.body || {};
    if (!username || !password || !name) return res.status(400).json({ error: 'Missing fields' });
    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) return res.status(400).json({ error: 'Пользователь уже существует' });
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)"
    ).run([username, hash, name, role === 'admin' ? 'admin' : 'user']);
    res.json({ id: Number(result.lastInsertRowid) });
  });

  router.delete('/users/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  router.get('/board', auth, (req, res) => {
    const board = db.prepare("SELECT * FROM boards ORDER BY id LIMIT 1").get();
    if (!board) return res.status(404).json({ error: 'No board' });
    const columns = db.prepare(
      "SELECT * FROM columns WHERE board_id = ? ORDER BY position"
    ).all([board.id]);
    const columnIds = columns.map(c => c.id);
    const cards = columnIds.length === 0 ? [] : db.prepare(`
      SELECT c.*, u.name AS assignee_name
      FROM cards c
      LEFT JOIN users u ON u.id = c.assignee_id
      WHERE c.column_id IN (${columnIds.map(() => '?').join(',')})
      ORDER BY c.position
    `).all(columnIds);
    res.json({ board, columns, cards });
  });

  router.post('/cards', auth, (req, res) => {
    const { column_id, title, description, assignee_id, deadline } = req.body || {};
    if (!column_id || !title) return res.status(400).json({ error: 'Missing fields' });
    const maxPos = db.prepare(
      "SELECT COALESCE(MAX(position), -1) AS p FROM cards WHERE column_id = ?"
    ).get([column_id]).p;
    const result = db.prepare(`
      INSERT INTO cards (column_id, title, description, assignee_id, deadline, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run([
      column_id,
      title,
      description || '',
      assignee_id || null,
      deadline || null,
      maxPos + 1,
      Date.now()
    ]);
    res.json({ id: Number(result.lastInsertRowid) });
  });

  router.put('/cards/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
    if (!card) return res.status(404).json({ error: 'Not found' });
    const { title, description, assignee_id, deadline } = req.body || {};
    db.prepare(`
      UPDATE cards SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        assignee_id = ?,
        deadline = ?
      WHERE id = ?
    `).run([
      title ?? null,
      description ?? null,
      assignee_id ?? null,
      deadline ?? null,
      id
    ]);
    res.json({ ok: true });
  });

  router.delete('/cards/:id', auth, (req, res) => {
    db.prepare("DELETE FROM cards WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  router.post('/cards/:id/move', auth, (req, res) => {
    const id = Number(req.params.id);
    const { column_id, position } = req.body || {};
    if (column_id == null || position == null) return res.status(400).json({ error: 'Missing fields' });
    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
    if (!card) return res.status(404).json({ error: 'Not found' });

    const destColumn = db.prepare("SELECT * FROM columns WHERE id = ?").get(column_id);
    if (!destColumn) return res.status(400).json({ error: 'Bad column' });

    db.exec('BEGIN');
    try {
      db.prepare(`
        UPDATE cards SET position = position - 1
        WHERE column_id = ? AND position > ?
      `).run([card.column_id, card.position]);

      db.prepare(`
        UPDATE cards SET position = position + 1
        WHERE column_id = ? AND position >= ?
      `).run([column_id, position]);

      const lastColumn = db.prepare(
        "SELECT id FROM columns WHERE board_id = ? ORDER BY position DESC LIMIT 1"
      ).get([destColumn.board_id]);

      const completedAt = (lastColumn && lastColumn.id === column_id)
        ? (card.completed_at || Date.now())
        : null;

      db.prepare(`
        UPDATE cards SET column_id = ?, position = ?, completed_at = ?
        WHERE id = ?
      `).run([column_id, position, completedAt, id]);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true });
  });

  router.get('/reports/summary', auth, (req, res) => {
    const from = Number(req.query.from) || 0;
    const to = Number(req.query.to) || Date.now();

    const byUser = db.prepare(`
      SELECT u.id, u.name,
        SUM(CASE WHEN c.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN c.completed_at IS NULL THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN c.completed_at IS NULL AND c.deadline IS NOT NULL AND c.deadline < ? THEN 1 ELSE 0 END) AS overdue,
        AVG(CASE WHEN c.completed_at IS NOT NULL THEN (c.completed_at - c.created_at) END) AS avg_duration_ms
      FROM users u
      LEFT JOIN cards c ON c.assignee_id = u.id
        AND c.created_at BETWEEN ? AND ?
      WHERE u.role = 'user'
      GROUP BY u.id
      ORDER BY u.name
    `).all([Date.now(), from, to]);

    const overdueCards = db.prepare(`
      SELECT c.*, u.name AS assignee_name
      FROM cards c
      LEFT JOIN users u ON u.id = c.assignee_id
      WHERE c.completed_at IS NULL
        AND c.deadline IS NOT NULL
        AND c.deadline < ?
      ORDER BY c.deadline
    `).all([Date.now()]);

    res.json({ byUser, overdueCards });
  });

  return router;
}

module.exports = { createRoutes };
