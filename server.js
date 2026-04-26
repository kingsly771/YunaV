require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const session  = require('express-session');
const FileStore = require('session-file-store')(session);
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');

const { initDB, getDB }  = require('./config/database');
const authRoutes         = require('./routes/auth');
const apiRoutes          = require('./routes/api');
const modRoutes          = require('./routes/moderation');

const app    = express();
const server = http.createServer(app);

// Trust Render/reverse-proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

// Ensure sessions directory exists
const fs = require('fs');
const sessionsDir = './data/sessions';
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

const sessionMiddleware = session({
  store: new FileStore({ path: sessionsDir, retries: 1, ttl: 604800, logFn: ()=>{} }),
  secret:            process.env.SESSION_SECRET || 'yunav-hbdchat-secret-2024',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
});

const io = new Server(server, { cors: { origin: true, credentials: true } });
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
app.use('/api',      modRoutes);

app.get('/webhook', (req, res) => {
  const { 'hub.mode':mode, 'hub.challenge':challenge, 'hub.verify_token':token } = req.query;
  (mode==='subscribe' && token===process.env.WHATSAPP_VERIFY_TOKEN) ? res.status(200).send(challenge) : res.sendStatus(403);
});
app.post('/webhook', (_,res) => res.sendStatus(200));
app.get('*', (_,res) => res.sendFile(path.join(__dirname,'public','index.html')));

// ── Socket.io ─────────────────────────────────────────────────
const connectedUsers = new Map(); // userId → socketId

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  if (!userId) { socket.disconnect(); return; }

  const db = getDB();

  // Shadow-ban check — still connect but flag it
  const shadowBan = db.prepare(
    `SELECT id FROM bans WHERE user_id=? AND type='shadow' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > strftime('%s','now')) LIMIT 1`
  ).get(userId);
  const isShadowBanned = !!shadowBan;

  connectedUsers.set(userId, socket.id);
  db.prepare(`UPDATE users SET is_online=1 WHERE id=?`).run(userId);
  if (!isShadowBanned) io.emit('user:status', { userId, isOnline: true });
  socket.join(`user:${userId}`);

  socket.on('conversation:join', (convId) => {
    const conv = db.prepare(`SELECT * FROM conversations WHERE id=? AND (user1_id=? OR user2_id=?)`).get(convId,userId,userId);
    if (conv) socket.join(`conv:${convId}`);
  });
  socket.on('conversation:leave', (convId) => socket.leave(`conv:${convId}`));

  socket.on('message:send', (data, cb) => {
    try {
      const { convId, content, type='text' } = data;
      if (!convId || !content?.trim()) return;

      // Check for active non-shadow ban (prevents sending)
      const activeBan = db.prepare(
        `SELECT id FROM bans WHERE user_id=? AND type!='shadow' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > strftime('%s','now')) LIMIT 1`
      ).get(userId);
      if (activeBan) { if(cb) cb({ error:'banned' }); return; }

      const conv = db.prepare(`SELECT * FROM conversations WHERE id=? AND (user1_id=? OR user2_id=?)`).get(convId,userId,userId);
      if (!conv) return;

      const msgId = uuidv4();
      const now   = Math.floor(Date.now()/1000);
      db.prepare(`INSERT INTO messages (id,conv_id,sender_id,content,type,created_at) VALUES (?,?,?,?,?,?)`).run(msgId,convId,userId,content.trim().slice(0,2000),type,now);

      const sender = db.prepare(`SELECT id,name,avatar FROM users WHERE id=?`).get(userId);
      const message = { id:msgId, conv_id:convId, sender_id:userId, sender_name:sender.name, sender_avatar:sender.avatar, content:content.trim(), type, read_at:null, created_at:now };

      if (isShadowBanned) {
        // Shadow ban: only the sender sees the message (fake delivery)
        socket.emit('message:new', message);
      } else {
        io.to(`conv:${convId}`).emit('message:new', message);
        const otherId = conv.user1_id===userId ? conv.user2_id : conv.user1_id;
        io.to(`user:${otherId}`).emit('conversation:update', { convId, lastMessage:content.trim(), lastMessageAt:now, senderId:userId });
      }

      if(cb) cb({ success:true, messageId:msgId });
    } catch(err) { console.error('message:send error:',err); if(cb) cb({ error:'Failed to send' }); }
  });

  socket.on('typing:start', ({ convId }) => {
    if (!isShadowBanned) socket.to(`conv:${convId}`).emit('typing:start', { userId, convId });
  });
  socket.on('typing:stop', ({ convId }) => socket.to(`conv:${convId}`).emit('typing:stop', { userId, convId }));

  socket.on('messages:read', ({ convId }) => {
    const result = db.prepare(`UPDATE messages SET read_at=strftime('%s','now') WHERE conv_id=? AND sender_id!=? AND read_at IS NULL`).run(convId, userId);
    if (result.changes>0) socket.to(`conv:${convId}`).emit('messages:read', { convId, readBy:userId });
  });

  // Admin: force-disconnect a user (ban enforcement)
  socket.on('admin:kick', ({ targetUserId }) => {
    const admin = db.prepare(`SELECT role FROM users WHERE id=?`).get(userId);
    if (admin?.role !== 'admin') return;
    const targetSocket = connectedUsers.get(targetUserId);
    if (targetSocket) {
      io.to(`user:${targetUserId}`).emit('force:logout', { reason:'banned' });
    }
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(userId);
    const lastSeen = Math.floor(Date.now()/1000);
    db.prepare(`UPDATE users SET is_online=0,last_seen=? WHERE id=?`).run(lastSeen,userId);
    if (!isShadowBanned) io.emit('user:status', { userId, isOnline:false, lastSeen });
  });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => console.log(`\n🎉 YUNAV-HBDCHAT → http://localhost:${PORT}\n`));
}).catch(err => { console.error('Startup failed:', err); process.exit(1); });
