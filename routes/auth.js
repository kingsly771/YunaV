const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB }         = require('../config/database');
const { verifyIdToken } = require('../config/firebase-admin');

function getActiveBan(db, userId) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT * FROM bans
    WHERE user_id = ? AND lifted_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, now);
}

// ── POST /api/auth/firebase ───────────────────────────────────
router.post('/firebase', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    const decoded = await verifyIdToken(idToken);
    const { uid, email='', name='', picture=null } = decoded;
    if (!uid) return res.status(401).json({ error: 'Invalid token' });

    const db = getDB();
    let user = db.prepare(`SELECT * FROM users WHERE firebase_uid = ?`).get(uid);
    const isNewUser = !user;

    if (!user) {
      const id = uuidv4();
      db.prepare(`INSERT INTO users (id,firebase_uid,email,name,avatar) VALUES (?,?,?,?,?)`)
        .run(id, uid, email, name||email.split('@')[0]||'User', picture);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    } else {
      db.prepare(`UPDATE users SET email=?,name=COALESCE(NULLIF(name,''),?),avatar=COALESCE(avatar,?),is_online=1 WHERE id=?`)
        .run(email, name, picture, user.id);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    }

    // Check for shadow ban — don't reveal it, just continue silently
    const ban = getActiveBan(db, user.id);
    if (ban && ban.type !== 'shadow') {
      // Real ban — block login
      return res.status(403).json({
        banned: true,
        ban: {
          type:      ban.type,
          reason:    ban.reason,
          expiresAt: ban.expires_at,
        }
      });
    }

    db.prepare(`UPDATE users SET is_online=1 WHERE id=?`).run(user.id);
    req.session.userId = user.id;

    // Unacked warnings
    const warnings = db.prepare(
      `SELECT * FROM warnings WHERE user_id=? AND acked=0 ORDER BY created_at DESC`
    ).all(user.id);

    res.json({
      success: true, isNewUser,
      user: { id:user.id, email:user.email, name:user.name, avatar:user.avatar, status:user.status, role:user.role, isNewUser },
      warnings
    });
  } catch (err) {
    console.error('firebase auth error:', err.message);
    res.status(401).json({ error: 'Authentication failed: ' + err.message });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', (req, res) => {
  if (req.session.userId) {
    getDB().prepare(`UPDATE users SET is_online=0,last_seen=strftime('%s','now') WHERE id=?`).run(req.session.userId);
  }
  req.session.destroy(() => res.json({ success: true }));
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db   = getDB();
  const user = db.prepare(`SELECT id,email,name,avatar,status,is_online,role FROM users WHERE id=?`).get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Check for active ban (could have been issued after login)
  const ban = db.prepare(`SELECT * FROM bans WHERE user_id=? AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > strftime('%s','now')) AND type != 'shadow' ORDER BY created_at DESC LIMIT 1`).get(req.session.userId);
  if (ban) return res.status(403).json({ banned: true, ban: { type:ban.type, reason:ban.reason, expiresAt:ban.expires_at } });

  const warnings = db.prepare(`SELECT * FROM warnings WHERE user_id=? AND acked=0`).all(req.session.userId);
  res.json({ user, warnings });
});

// ── POST /api/auth/ack-warning ────────────────────────────────
router.post('/ack-warning', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  getDB().prepare(`UPDATE warnings SET acked=1 WHERE user_id=? AND acked=0`).run(req.session.userId);
  res.json({ success: true });
});

module.exports = router;
