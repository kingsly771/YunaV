const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { getDB } = require('../config/database');
const { generateOTP, normalizePhone, sendOTP } = require('../config/whatsapp');

// Rate limiter: max 5 OTP requests per 10 min per IP
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please wait 10 minutes.' }
});

// ── POST /api/auth/send-otp ───────────────────────────────────
router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    phone = normalizePhone(phone);
    if (!/^\+\d{7,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    const db = getDB();
    db.prepare(`UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0`).run(phone);

    const otp = generateOTP(6);
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 min

    db.prepare(`INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)`)
      .run(phone, otp, expiresAt);

    await sendOTP(phone, otp);

    res.json({ success: true, message: 'OTP sent via WhatsApp' });
  } catch (err) {
    console.error('send-otp error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP. ' + err.message });
  }
});

// ── POST /api/auth/verify-otp ─────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    let { phone, otp, name } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    phone = normalizePhone(phone);
    const now = Math.floor(Date.now() / 1000);
    const db = getDB();

    const record = db.prepare(
      `SELECT * FROM otp_codes WHERE phone = ? AND code = ? AND used = 0 AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(phone, otp.toString(), now);

    if (!record) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(record.id);

    let user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
    const isNewUser = !user;

    if (!user) {
      const id = uuidv4();
      const displayName = name ? name.trim() : `User${phone.slice(-4)}`;
      db.prepare(`INSERT INTO users (id, phone, name) VALUES (?, ?, ?)`)
        .run(id, phone, displayName);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    }

    req.session.userId = user.id;
    req.session.phone  = user.phone;

    db.prepare(`UPDATE users SET is_online = 1 WHERE id = ?`).run(user.id);

    res.json({
      success: true,
      user: {
        id:        user.id,
        phone:     user.phone,
        name:      user.name,
        avatar:    user.avatar,
        status:    user.status,
        isNewUser: isNewUser || !user.name
      }
    });
  } catch (err) {
    console.error('verify-otp error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', (req, res) => {
  if (req.session.userId) {
    getDB().prepare(
      `UPDATE users SET is_online = 0, last_seen = strftime('%s','now') WHERE id = ?`
    ).run(req.session.userId);
  }
  req.session.destroy(() => res.json({ success: true }));
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = getDB().prepare(
    `SELECT id, phone, name, avatar, status, is_online FROM users WHERE id = ?`
  ).get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
