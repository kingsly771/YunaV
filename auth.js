const { getDB } = require('../config/database');

module.exports = function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required' });

  const db   = getDB();
  const now  = Math.floor(Date.now() / 1000);

  // Check for active ban
  const ban = db.prepare(`
    SELECT * FROM bans
    WHERE user_id = ? AND active = 1
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY issued_at DESC LIMIT 1
  `).get(req.session.userId, now);

  if (ban) {
    const isTempBan = ban.type === 'temporary';
    return res.status(403).json({
      error:     'banned',
      ban: {
        type:      ban.type,
        reason:    ban.reason,
        details:   ban.details,
        expiresAt: ban.expires_at,
        issuedAt:  ban.issued_at,
      }
    });
  }

  next();
};

module.exports.requireAdmin = function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required' });
  const user = getDB().prepare(`SELECT role FROM users WHERE id = ?`).get(req.session.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};
