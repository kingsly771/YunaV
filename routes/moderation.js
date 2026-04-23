/**
 * Moderation & Admin Routes
 * All /api/mod/* endpoints require admin role
 * /api/reports is available to regular users (submit only)
 */
const express     = require('express');
const router      = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB }   = require('../config/database');
const requireAuth = require('../middleware/auth');

// ── Middleware: require admin role ────────────────────────────
function requireAdmin(req, res, next) {
  const user = getDB().prepare(`SELECT role FROM users WHERE id=?`).get(req.session.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  next();
}

// ════════════════════════════════════
// USER-FACING: Submit report
// ════════════════════════════════════
router.post('/reports', requireAuth, (req, res) => {
  const { reportedId, reason, details='' } = req.body;
  if (!reportedId || !reason) return res.status(400).json({ error: 'reportedId and reason required' });
  if (reportedId === req.session.userId) return res.status(400).json({ error: 'Cannot report yourself' });

  const db = getDB();
  if (!db.prepare(`SELECT id FROM users WHERE id=?`).get(reportedId))
    return res.status(404).json({ error: 'User not found' });

  // Deduplicate: one open report per pair
  const existing = db.prepare(
    `SELECT id FROM reports WHERE reporter_id=? AND reported_id=? AND status='pending'`
  ).get(req.session.userId, reportedId);
  if (existing) return res.json({ success: true, duplicate: true });

  db.prepare(`INSERT INTO reports (id,reporter_id,reported_id,reason,details) VALUES (?,?,?,?,?)`)
    .run(uuidv4(), req.session.userId, reportedId, reason, details.trim().slice(0,500));

  res.json({ success: true });
});

// ════════════════════════════════════
// ADMIN: Stats overview
// ════════════════════════════════════
router.get('/admin/stats', requireAuth, requireAdmin, (req, res) => {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  res.json({
    pendingReports: db.prepare(`SELECT COUNT(*) AS c FROM reports WHERE status='pending'`).get().c,
    activeBans:     db.prepare(`SELECT COUNT(*) AS c FROM bans WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`).get(now).c,
    totalWarnings:  db.prepare(`SELECT COUNT(*) AS c FROM warnings`).get().c,
    totalUsers:     db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c,
    totalMessages:  db.prepare(`SELECT COUNT(*) AS c FROM messages`).get().c,
  });
});

// ════════════════════════════════════
// ADMIN: Reports queue
// ════════════════════════════════════
router.get('/admin/reports', requireAuth, requireAdmin, (_req, res) => {
  const reports = getDB().prepare(`
    SELECT r.*,
      reporter.name AS reporter_name, reporter.avatar AS reporter_avatar,
      reported.name AS reported_name, reported.avatar AS reported_avatar, reported.email AS reported_email
    FROM reports r
    JOIN users reporter ON reporter.id = r.reporter_id
    JOIN users reported ON reported.id = r.reported_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC LIMIT 100
  `).all();
  res.json({ reports });
});

router.post('/admin/reports/:id/resolve', requireAuth, requireAdmin, (req, res) => {
  const { resolution } = req.body; // 'dismiss' | 'warn' | 'ban'
  getDB().prepare(`UPDATE reports SET status='resolved', resolved_by=?, resolution=? WHERE id=?`)
    .run(req.session.userId, resolution||'dismissed', req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════
// ADMIN: Users list / search
// ════════════════════════════════════
router.get('/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { q='' } = req.query;
  const now = Math.floor(Date.now() / 1000);
  const like = `%${q}%`;
  const users = getDB().prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM warnings WHERE user_id=u.id) AS warning_count,
      (SELECT COUNT(*) FROM bans WHERE user_id=u.id AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)) AS active_bans
    FROM users u
    WHERE u.name LIKE ? OR u.email LIKE ?
    ORDER BY u.created_at DESC LIMIT 60
  `).all(now, like, like);
  res.json({ users });
});

// ════════════════════════════════════
// ADMIN: Issue warning
// ════════════════════════════════════
router.post('/admin/warn/:userId', requireAuth, requireAdmin, (req, res) => {
  const { reason, details='' } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });

  const db     = getDB();
  const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Insert warning
  db.prepare(`INSERT INTO warnings (id,user_id,warned_by,reason,details) VALUES (?,?,?,?,?)`)
    .run(uuidv4(), target.id, req.session.userId, reason, details.trim().slice(0,500));

  // Auto-escalation: 3 warnings → 7-day temp ban; 5 warnings → permanent
  const warnCount = db.prepare(`SELECT COUNT(*) AS c FROM warnings WHERE user_id=?`).get(target.id).c;
  let autoBan = null;
  if (warnCount >= 5) {
    autoBan = { type:'permanent', reason:'Auto-escalation: 5+ warnings' };
  } else if (warnCount >= 3) {
    autoBan = { type:'temporary', reason:'Auto-escalation: 3+ warnings', hours: 168 };
  }
  if (autoBan) {
    const expiresAt = autoBan.hours
      ? Math.floor(Date.now()/1000) + autoBan.hours*3600
      : null;
    db.prepare(`INSERT INTO bans (id,user_id,banned_by,type,reason,expires_at) VALUES (?,?,?,?,?,?)`)
      .run(uuidv4(), target.id, req.session.userId, autoBan.type, autoBan.reason, expiresAt);
  }

  res.json({ success: true, warnCount, autoBan });
});

// ════════════════════════════════════
// ADMIN: Issue ban
// ════════════════════════════════════
router.post('/admin/ban/:userId', requireAuth, requireAdmin, (req, res) => {
  const { type='temporary', reason, notes='', hours=24 } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  if (!['temporary','permanent','shadow'].includes(type))
    return res.status(400).json({ error: 'Invalid ban type' });

  const db     = getDB();
  const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') return res.status(403).json({ error: 'Cannot ban an admin' });

  // Lift any existing bans first
  db.prepare(`UPDATE bans SET lifted_at=strftime('%s','now'),lifted_by=? WHERE user_id=? AND lifted_at IS NULL`).run(req.session.userId, target.id);

  const expiresAt = type==='temporary'
    ? Math.floor(Date.now()/1000) + parseInt(hours)*3600
    : null;

  db.prepare(`INSERT INTO bans (id,user_id,banned_by,type,reason,notes,expires_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uuidv4(), target.id, req.session.userId, type, reason, notes.trim(), expiresAt);

  // Force offline if active
  db.prepare(`UPDATE users SET is_online=0 WHERE id=?`).run(target.id);

  res.json({ success: true });
});

// ════════════════════════════════════
// ADMIN: Lift ban
// ════════════════════════════════════
router.post('/admin/unban/:userId', requireAuth, requireAdmin, (req, res) => {
  getDB().prepare(`UPDATE bans SET lifted_at=strftime('%s','now'),lifted_by=? WHERE user_id=? AND lifted_at IS NULL`)
    .run(req.session.userId, req.params.userId);
  res.json({ success: true });
});

// ════════════════════════════════════
// ADMIN: Active bans list
// ════════════════════════════════════
router.get('/admin/bans', requireAuth, requireAdmin, (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const bans = getDB().prepare(`
    SELECT b.*, u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar,
           a.name AS admin_name
    FROM bans b
    JOIN users u ON u.id = b.user_id
    JOIN users a ON a.id = b.banned_by
    WHERE b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)
    ORDER BY b.created_at DESC LIMIT 100
  `).all(now);
  res.json({ bans });
});

// ════════════════════════════════════
// ADMIN: Promote / demote user role
// ════════════════════════════════════
router.post('/admin/role/:userId', requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  getDB().prepare(`UPDATE users SET role=? WHERE id=?`).run(role, req.params.userId);
  res.json({ success: true });
});

module.exports = router;
