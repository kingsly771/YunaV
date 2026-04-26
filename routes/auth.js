const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/database');

function getActiveBan(db, userId) {
  return db.prepare(`
    SELECT * FROM bans WHERE user_id=? AND lifted_at IS NULL
    AND (expires_at IS NULL OR expires_at > strftime('%s','now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Email, password and name are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  try {
    const db = getDB();
    const existing = db.prepare(`SELECT id FROM users WHERE email=?`).get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = await bcrypt.hash(password, 12);
    const id   = uuidv4();
    db.prepare(`INSERT INTO users (id,email,password_hash,name) VALUES (?,?,?,?)`)
      .run(id, email.toLowerCase(), hash, name.trim());

    const user = db.prepare(`SELECT id,email,name,avatar,status,is_online,role FROM users WHERE id=?`).get(id);
    req.session.userId   = id;
    req.session.isNewUser = true;
    await new Promise((res, rej) => req.session.save(e => e ? rej(e) : res()));
    res.json({ success: true, user, isNewUser: true });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const db   = getDB();
    const user = db.prepare(`SELECT * FROM users WHERE email=?`).get(email.toLowerCase());
    if (!user || !user.password_hash)
      return res.status(401).json({ error: 'No account found with this email.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    const ban = getActiveBan(db, user.id);
    if (ban && ban.type !== 'shadow')
      return res.status(403).json({ banned: true, ban: { type: ban.type, reason: ban.reason, expiresAt: ban.expires_at } });

    db.prepare(`UPDATE users SET is_online=1 WHERE id=?`).run(user.id);
    req.session.userId   = user.id;
    req.session.isNewUser = false;
    await new Promise((res, rej) => req.session.save(e => e ? rej(e) : res()));

    const safeUser = db.prepare(`SELECT id,email,name,avatar,status,is_online,role FROM users WHERE id=?`).get(user.id);
    res.json({ success: true, user: safeUser, isNewUser: false });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db   = getDB();
  const user = db.prepare(`SELECT id,email,name,avatar,status,is_online,role FROM users WHERE id=?`).get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ban = db.prepare(`SELECT * FROM bans WHERE user_id=? AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > strftime('%s','now')) AND type!='shadow' ORDER BY created_at DESC LIMIT 1`).get(req.session.userId);
  if (ban) return res.status(403).json({ banned: true, ban: { type: ban.type, reason: ban.reason, expiresAt: ban.expires_at } });

  const warnings  = db.prepare(`SELECT * FROM warnings WHERE user_id=? AND acked=0`).all(req.session.userId);
  const isNewUser = req.session.isNewUser || false;
  res.json({ user: { ...user, isNewUser }, warnings });
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', (req, res) => {
  if (req.session.userId)
    getDB().prepare(`UPDATE users SET is_online=0,last_seen=strftime('%s','now') WHERE id=?`).run(req.session.userId);
  req.session.destroy(() => res.json({ success: true }));
});

// ── POST /api/auth/ack-warning ────────────────────────────────
router.post('/ack-warning', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  getDB().prepare(`UPDATE warnings SET acked=1 WHERE user_id=? AND acked=0`).run(req.session.userId);
  res.json({ success: true });
});

module.exports = router;
