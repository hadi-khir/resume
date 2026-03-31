require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Custom SQLite Session Store ────────────
class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const data = db.getSession(sid);
      cb(null, data);
    } catch (err) {
      cb(err);
    }
  }
  set(sid, sessionData, cb) {
    try {
      const maxAge = (sessionData.cookie && sessionData.cookie.maxAge) || 7 * 24 * 60 * 60 * 1000;
      db.setSession(sid, sessionData, maxAge);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
  destroy(sid, cb) {
    try {
      db.destroySession(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

// Wait for DB to be ready before starting
async function startServer() {
  await db.ready;

  // Clean expired sessions on startup and every hour
  db.cleanExpiredSessions();
  setInterval(function() { db.cleanExpiredSessions(); }, 60 * 60 * 1000);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false
  }));

  if (isProd) {
    app.set('trust proxy', 1);
  }

  app.use(express.json({ limit: '2mb' }));

  // Sessions
  app.use(session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    genid: function() {
      return crypto.randomUUID();
    },
    cookie: {
      secure: isProd,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  // Static files
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Auth Routes ────────────────────────────

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const BCRYPT_ROUNDS = 12;

  app.post('/api/auth/register', async function(req, res) {
    try {
      var email = req.body.email;
      var name = req.body.name;
      var password = req.body.password;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      var existing = db.findUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      var hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      var user = db.createUser(email, name || '', hash);

      var defaultData = {
        personal: { firstName: '', lastName: '', title: '', email: '', phone: '', location: '', linkedin: '', website: '' },
        summary: '',
        experience: [],
        education: [],
        skills: [],
        projects: [],
        certifications: []
      };
      db.createResume(user.id, 'My Resume', 'modern', defaultData);

      req.session.userId = user.id;
      res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/auth/login', async function(req, res) {
    try {
      var email = req.body.email;
      var password = req.body.password;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      var user = db.findUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      var valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      req.session.userId = user.id;
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/auth/logout', function(req, res) {
    req.session.destroy(function() {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  app.get('/api/auth/me', function(req, res) {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    var user = db.findUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  // ── Resume Routes ──────────────────────────

  app.get('/api/resumes', requireAuth, function(req, res) {
    var resumes = db.listResumes(req.session.userId);
    res.json(resumes);
  });

  app.post('/api/resumes', requireAuth, function(req, res) {
    var name = req.body.name;
    var template = req.body.template;
    var data = req.body.data;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    var dataStr = JSON.stringify(data || {});
    if (dataStr.length > 1024 * 1024) {
      return res.status(400).json({ error: 'Resume data too large' });
    }

    var resume = db.createResume(req.session.userId, name, template || 'modern', data || {});
    res.status(201).json(resume);
  });

  app.get('/api/resumes/:id', requireAuth, function(req, res) {
    var resume = db.getResume(parseInt(req.params.id), req.session.userId);
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json(resume);
  });

  app.put('/api/resumes/:id', requireAuth, function(req, res) {
    var name = req.body.name;
    var template = req.body.template;
    var data = req.body.data;
    var id = parseInt(req.params.id);

    var existing = db.getResume(id, req.session.userId);
    if (!existing) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    var dataStr = JSON.stringify(data || existing.data);
    if (dataStr.length > 1024 * 1024) {
      return res.status(400).json({ error: 'Resume data too large' });
    }

    var updated = db.updateResume(
      id, req.session.userId,
      name || existing.name,
      template || existing.template,
      data || existing.data
    );

    if (!updated) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json({ ok: true });
  });

  app.delete('/api/resumes/:id', requireAuth, function(req, res) {
    var deleted = db.deleteResume(parseInt(req.params.id), req.session.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json({ ok: true });
  });

  // ── Catch-all: serve index.html ────────────
  app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── Start ──────────────────────────────────
  app.listen(PORT, function() {
    console.log('ResumeForge running on port ' + PORT);
  });
}

startServer().catch(function(err) {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', function() {
  db.close();
  process.exit(0);
});
