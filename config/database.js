/**
 * database.js — sql.js wrapper with better-sqlite3-compatible sync API
 * sql.js is pure JS (no native compilation needed)
 */
const path = require('path');
const fs   = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'yunav.db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ─── Sync wrapper around sql.js ───────────────────────────────────────────────
class SyncDB {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._save();
  }

  _save() {
    try {
      const data = this._db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) { /* ignore during shutdown */ }
  }

  pragma() {} // no-op — sql.js handles this internally

  exec(sql) {
    this._db.run(sql);
    this._save();
    return this;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self._db.prepare(sql);
        stmt.run(params);
        stmt.free();
        self._save();
        return { changes: self._db.getRowsModified() };
      },
      get(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        let row;
        if (stmt.step()) row = stmt.getAsObject();
        stmt.free();
        return row;
      },
      all(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self._db.prepare(sql);
        const rows = [];
        stmt.bind(params);
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      }
    };
  }
}

// ─── Async initializer (call once at startup) ─────────────────────────────────
let _db = null;

async function initDB() {
  if (_db) return _db;

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqlDb = new SQL.Database();
  }

  _db = new SyncDB(sqlDb);

  // Schema migrations
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE,
      password_hash TEXT,
      firebase_uid  TEXT UNIQUE,
      name          TEXT,
      avatar        TEXT DEFAULT NULL,
      status        TEXT DEFAULT '🎉 Ready to celebrate!',
      role          TEXT DEFAULT 'user',
      is_online     INTEGER DEFAULT 0,
      last_seen     INTEGER DEFAULT (strftime('%s','now')),
      created_at    INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      phone      TEXT NOT NULL,
      code       TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      user1_id   TEXT NOT NULL,
      user2_id   TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      conv_id    TEXT NOT NULL,
      sender_id  TEXT NOT NULL,
      content    TEXT NOT NULL,
      type       TEXT DEFAULT 'text',
      read_at    INTEGER DEFAULT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  console.log('✅ Database ready');
  return _db;
}

// Sync accessor — safe to call after initDB() resolves
function getDB() {
  if (!_db) throw new Error('DB not initialized — await initDB() first in server.js');
  return _db;
}

module.exports = { initDB, getDB };
