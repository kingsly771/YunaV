require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const session  = require('express-session');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');

const { initDB, getDB } = require('./config/database');
const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');

const app    = express();
const server = http.createServer(app);

const sessionMiddleware = session({
  secret:            process.env.SESSION_SECRET || 'yunav-hbdchat-secret-2024',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000
  }
});

const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

// Share express session with socket.io
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api',      apiRoutes);

// WhatsApp webhook verification
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});
app.post('/webhook', (_req, res) => res.sendStatus(200));

// SPA fallback
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── Socket.io ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  if (!userId) { socket.disconnect(); return; }

  const db = getDB();
  console.log(`✅ User connected: ${userId}`);

  db.prepare(`UPDATE users SET is_online = 1 WHERE id = ?`).run(userId);
  io.emit('user:status', { userId, isOnline: true });
  socket.join(`user:${userId}`);

  socket.on('conversation:join',  (convId) => {
    const conv = db.prepare(
      `SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)`
    ).get(convId, userId, userId);
    if (conv) socket.join(`conv:${convId}`);
  });

  socket.on('conversation:leave', (convId) => socket.leave(`conv:${convId}`));

  socket.on('message:send', (data, cb) => {
    try {
      const { convId, content, type = 'text' } = data;
      if (!convId || !content?.trim()) return;

      const conv = db.prepare(
        `SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)`
      ).get(convId, userId, userId);
      if (!conv) return;

      const msgId = uuidv4();
      const now   = Math.floor(Date.now() / 1000);

      db.prepare(
        `INSERT INTO messages (id, conv_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(msgId, convId, userId, content.trim().slice(0, 2000), type, now);

      const sender = db.prepare(`SELECT id, name, avatar FROM users WHERE id = ?`).get(userId);

      const message = {
        id: msgId, conv_id: convId, sender_id: userId,
        sender_name: sender.name, sender_avatar: sender.avatar,
        content: content.trim(), type, read_at: null, created_at: now
      };

      io.to(`conv:${convId}`).emit('message:new', message);

      const otherId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
      io.to(`user:${otherId}`).emit('conversation:update', {
        convId, lastMessage: content.trim(), lastMessageAt: now, senderId: userId
      });

      if (cb) cb({ success: true, messageId: msgId });
    } catch (err) {
      console.error('message:send error:', err);
      if (cb) cb({ error: 'Failed to send' });
    }
  });

  socket.on('typing:start', ({ convId }) =>
    socket.to(`conv:${convId}`).emit('typing:start', { userId, convId }));

  socket.on('typing:stop', ({ convId }) =>
    socket.to(`conv:${convId}`).emit('typing:stop', { userId, convId }));

  socket.on('messages:read', ({ convId }) => {
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%s','now')
       WHERE conv_id = ? AND sender_id != ? AND read_at IS NULL`
    ).run(convId, userId);
    if (result.changes > 0)
      socket.to(`conv:${convId}`).emit('messages:read', { convId, readBy: userId });
  });

  socket.on('disconnect', () => {
    const lastSeen = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?`).run(lastSeen, userId);
    io.emit('user:status', { userId, isOnline: false, lastSeen });
    console.log(`❌ User disconnected: ${userId}`);
  });
});

// ── Boot ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🎉 YUNAV-HBDCHAT running → http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
