const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/database');
const requireAuth = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Avatar upload ─────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `avatar_${req.session.userId}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'))
});

// ── GET /api/users/search?q= ──────────────────────────────────
router.get('/users/search', requireAuth, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ users: [] });
  const like = `%${q}%`;
  const users = getDB().prepare(
    `SELECT id, phone, name, avatar, status, is_online, last_seen
     FROM users WHERE id != ? AND (phone LIKE ? OR name LIKE ?) LIMIT 10`
  ).all(req.session.userId, like, like);
  res.json({ users });
});

// ── GET /api/users/:id ────────────────────────────────────────
router.get('/users/:id', requireAuth, (req, res) => {
  const user = getDB().prepare(
    `SELECT id, phone, name, avatar, status, is_online, last_seen FROM users WHERE id = ?`
  ).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ── PATCH /api/profile ────────────────────────────────────────
router.patch('/profile', requireAuth, (req, res) => {
  const { name, status } = req.body;
  const db = getDB();
  if (name)            db.prepare(`UPDATE users SET name   = ? WHERE id = ?`).run(name.trim().slice(0,50),   req.session.userId);
  if (status !== undefined) db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status.slice(0,100), req.session.userId);
  const user = db.prepare(
    `SELECT id, phone, name, avatar, status FROM users WHERE id = ?`
  ).get(req.session.userId);
  res.json({ user });
});

// ── POST /api/profile/avatar ──────────────────────────────────
router.post('/profile/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = `/uploads/${req.file.filename}`;
  getDB().prepare(`UPDATE users SET avatar = ? WHERE id = ?`).run(avatarUrl, req.session.userId);
  res.json({ avatar: avatarUrl });
});

// ── GET /api/conversations ────────────────────────────────────
router.get('/conversations', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const db  = getDB();

  const convs = db.prepare(`
    SELECT
      c.id,
      c.created_at,
      CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END AS other_id,
      u.name      AS other_name,
      u.avatar    AS other_avatar,
      u.status    AS other_status,
      u.is_online AS other_online,
      u.last_seen AS other_last_seen,
      (SELECT content    FROM messages WHERE conv_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE conv_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*)   FROM messages WHERE conv_id = c.id AND sender_id != ? AND read_at IS NULL) AS unread_count
    FROM conversations c
    JOIN users u ON u.id = (CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END)
    WHERE c.user1_id = ? OR c.user2_id = ?
    ORDER BY last_message_at DESC
  `).all(uid, uid, uid, uid, uid);

  res.json({ conversations: convs });
});

// ── GET /api/conversations/:id/messages ───────────────────────
router.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const db  = getDB();

  const conv = db.prepare(
    `SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)`
  ).get(req.params.id, uid, uid);
  if (!conv) return res.status(403).json({ error: 'Access denied' });

  const { before, limit = 50 } = req.query;
  let sql = `
    SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conv_id = ?`;
  const params = [req.params.id];

  if (before) { sql += ` AND m.created_at < ?`; params.push(parseInt(before)); }
  sql += ` ORDER BY m.created_at DESC LIMIT ?`;
  params.push(parseInt(limit));

  const messages = db.prepare(sql).all(...params).reverse();

  // Mark as read
  db.prepare(
    `UPDATE messages SET read_at = strftime('%s','now')
     WHERE conv_id = ? AND sender_id != ? AND read_at IS NULL`
  ).run(req.params.id, uid);

  res.json({ messages });
});

// ── POST /api/conversations/start ────────────────────────────
router.post('/conversations/start', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const { targetUserId } = req.body;
  if (!targetUserId || targetUserId === uid)
    return res.status(400).json({ error: 'Invalid target user' });

  const db = getDB();

  if (!db.prepare(`SELECT id FROM users WHERE id = ?`).get(targetUserId))
    return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare(`
    SELECT * FROM conversations
    WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
  `).get(uid, targetUserId, targetUserId, uid);

  if (existing) return res.json({ conversationId: existing.id });

  const id = uuidv4();
  db.prepare(`INSERT INTO conversations (id, user1_id, user2_id) VALUES (?, ?, ?)`)
    .run(id, uid, targetUserId);
  res.json({ conversationId: id });
});

module.exports = router;
