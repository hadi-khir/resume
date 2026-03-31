const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'resumeforge.db');

let db = null;
let ready = null; // promise that resolves when DB is ready

// Persist DB to disk after writes
function persist() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Initialize database
ready = (async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB file or create new
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new SQL.Database();
  }

  // Schema - all queries use parameterized inputs (?) to prevent SQL injection
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'My Resume',
      template TEXT NOT NULL DEFAULT 'modern',
      data TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id)');

  // Sessions table (used by our custom session store)
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    )
  `);

  persist();
  return db;
})();

// Helper: run a query that returns rows
function getOne(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function getAll(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function runSql(sql, params) {
  db.run(sql, params);
  var changes = db.getRowsModified();
  var lastIdResult = db.exec('SELECT last_insert_rowid()');
  var lastId = (lastIdResult.length > 0 && lastIdResult[0].values.length > 0)
    ? lastIdResult[0].values[0][0]
    : 0;
  persist();
  return { lastId: lastId, changes: changes };
}

module.exports = {
  ready,

  createUser(email, name, passwordHash) {
    const result = runSql(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
      [email, name, passwordHash]
    );
    return { id: result.lastId, email, name };
  },

  findUserByEmail(email) {
    return getOne(
      'SELECT id, email, name, password_hash FROM users WHERE email = ?',
      [email]
    );
  },

  findUserById(id) {
    return getOne(
      'SELECT id, email, name FROM users WHERE id = ?',
      [id]
    );
  },

  createResume(userId, name, template, data) {
    const dataJson = typeof data === 'string' ? data : JSON.stringify(data);
    const result = runSql(
      'INSERT INTO resumes (user_id, name, template, data) VALUES (?, ?, ?, ?)',
      [userId, name, template, dataJson]
    );
    return { id: result.lastId, name, template };
  },

  listResumes(userId) {
    return getAll(
      'SELECT id, name, template, updated_at FROM resumes WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    );
  },

  getResume(id, userId) {
    const row = getOne(
      'SELECT id, name, template, data, created_at, updated_at FROM resumes WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (!row) return null;
    row.data = JSON.parse(row.data);
    return row;
  },

  updateResume(id, userId, name, template, data) {
    const dataJson = typeof data === 'string' ? data : JSON.stringify(data);
    const result = runSql(
      'UPDATE resumes SET name = ?, template = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [name, template, dataJson, id, userId]
    );
    return result.changes > 0;
  },

  deleteResume(id, userId) {
    const result = runSql(
      'DELETE FROM resumes WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return result.changes > 0;
  },

  // Session store methods
  getSession(sid) {
    const row = getOne('SELECT data, expires FROM sessions WHERE sid = ?', [sid]);
    if (!row) return null;
    if (row.expires && row.expires < Date.now()) {
      runSql('DELETE FROM sessions WHERE sid = ?', [sid]);
      return null;
    }
    return JSON.parse(row.data);
  },

  setSession(sid, data, maxAge) {
    const expires = Date.now() + (maxAge || 7 * 24 * 60 * 60 * 1000);
    const existing = getOne('SELECT sid FROM sessions WHERE sid = ?', [sid]);
    if (existing) {
      runSql('UPDATE sessions SET data = ?, expires = ? WHERE sid = ?',
        [JSON.stringify(data), expires, sid]);
    } else {
      runSql('INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)',
        [sid, JSON.stringify(data), expires]);
    }
  },

  destroySession(sid) {
    runSql('DELETE FROM sessions WHERE sid = ?', [sid]);
  },

  cleanExpiredSessions() {
    runSql('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
  },

  close() {
    if (db) {
      persist();
      db.close();
    }
  }
};
