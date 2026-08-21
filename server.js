require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// On Railway, use /data for persistent storage; locally use project root
const DB_PATH = process.env.RAILWAY_ENVIRONMENT
  ? '/data/database.db'
  : 'database.db';

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables and run migrations
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_order INTEGER UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL,
      title TEXT DEFAULT '',
      link_url TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      codes_sent TEXT DEFAULT '',
      codes_count INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Settings table — stores global config like serial_count
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Default serial count = 1
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('serial_count', '1')`);

  // Per-email override table
  db.run(`
    CREATE TABLE IF NOT EXISTS email_overrides (
      email TEXT PRIMARY KEY,
      serial_count INTEGER NOT NULL
    )
  `);

  // Migrations for older installs
  db.run(`ALTER TABLE codes ADD COLUMN serial_order INTEGER`, () => {});
  db.run(`ALTER TABLE codes ADD COLUMN title TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE codes ADD COLUMN link_url TEXT DEFAULT ''`, () => {});
  // Safe migrations — ignore errors if columns already exist
  db.run(`ALTER TABLE submissions ADD COLUMN codes_sent TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE submissions ADD COLUMN codes_count INTEGER DEFAULT 0`, () => {});
  // Drop old NOT NULL constraint by recreating table if `code` column exists
  db.all(`PRAGMA table_info(submissions)`, [], (err, cols) => {
    if (err || !cols) return;
    const hasOldCode = cols.some(c => c.name === 'code');
    if (hasOldCode) {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS submissions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          codes_sent TEXT DEFAULT '',
          codes_count INTEGER DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`INSERT INTO submissions_new (id, email, codes_sent, codes_count, timestamp)
          SELECT id, email, COALESCE(codes_sent, code, ''), COALESCE(codes_count, 0), timestamp
          FROM submissions`);
        db.run(`DROP TABLE submissions`);
        db.run(`ALTER TABLE submissions_new RENAME TO submissions`);
        console.log('Migrated submissions table — removed old code column');
      });
    }
  });

  // Backfill serial_order for existing rows that don't have it
  db.run(`UPDATE codes SET serial_order = id WHERE serial_order IS NULL OR serial_order = 0`);
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

// Configure nodemailer with Zoho Mail
// Try port 587 (STARTTLS) first — port 465 (SSL) is often blocked on cloud hosts
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.in',
  port: 587,
  secure: false,          // STARTTLS on port 587
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  if (req.session.loggedIn) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

app.get('/admin/codes', (req, res) => {
  if (req.session.loggedIn) {
    res.sendFile(path.join(__dirname, 'public', 'codes.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

app.get('/admin/users', (req, res) => {
  if (req.session.loggedIn) {
    res.sendFile(path.join(__dirname, 'public', 'users.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ── Settings ─────────────────────────────────────────────────────────────────

// GET serial count
app.get('/api/settings/serial-count', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  db.get(`SELECT value FROM settings WHERE key = 'serial_count'`, [], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ serial_count: parseInt(row ? row.value : 1) });
  });
});

// PUT serial count
app.put('/api/settings/serial-count', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  const n = parseInt(req.body.serial_count);
  if (!n || n < 1) return res.status(400).json({ error: 'Must be a positive number' });

  // Cap at total codes available
  db.get(`SELECT COUNT(*) as count FROM codes`, [], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const max = row.count;
    if (n > max) return res.status(400).json({ error: `Only ${max} code(s) exist. Cannot set higher than ${max}.` });

    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('serial_count', ?)`, [String(n)], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ success: true, serial_count: n });
    });
  });
});

// ── Submissions ───────────────────────────────────────────────────────────────

app.get('/api/submissions', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  db.all('SELECT * FROM submissions ORDER BY timestamp DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// ── Get Code (public) ─────────────────────────────────────────────────────────

app.post('/api/get-code', (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Check for per-email override first, then fall back to global setting
  db.get(`SELECT serial_count FROM email_overrides WHERE email = ?`, [email.toLowerCase()], (err, overrideRow) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (overrideRow) {
      // Use per-email override
      sendCodes(email, overrideRow.serial_count, res);
    } else {
      // Use global default
      db.get(`SELECT value FROM settings WHERE key = 'serial_count'`, [], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        sendCodes(email, parseInt(row ? row.value : 1), res);
      });
    }
  });
});

function sendCodes(email, count, res) {
    // Fetch the first N codes by serial_order
    db.all(
      `SELECT * FROM codes ORDER BY serial_order ASC LIMIT ?`,
      [count],
      (err, codes) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!codes || codes.length === 0) {
          return res.status(500).json({ error: 'No codes available. Please contact support.' });
        }

        // Save submission with count
        const codesSent = codes.map(c => c.code).join(', ');
        db.run(
          'INSERT INTO submissions (email, codes_sent, codes_count) VALUES (?, ?, ?)',
          [email, codesSent, codes.length],
          (err) => { if (err) console.error('Submission save error:', err); }
        );

        // Build email HTML list — show clickable link if available, else code text
        const linkListHtml = codes.map((c, i) => {
          const linkCell = c.link_url
            ? `<a href="${c.link_url}" style="color:#667eea;font-weight:700;text-decoration:none;word-break:break-all;">${c.link_url}</a>`
            : `<span style="font-family:monospace;background:#f8f9fa;color:#3a3a6e;padding:2px 6px;border-radius:4px;">${c.code}</span>`;
          return `<tr>
            <td style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-size:13px;">${i + 1}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #eee;font-weight:600;color:#2c3e50;">${c.title || ''}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #eee;">${linkCell}</td>
          </tr>`;
        }).join('');

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: 'Your Access Link(s) - Hidden Future Entertainment',
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:30px 20px;">
              <h2 style="color:#2c3e50;margin-bottom:8px;">Welcome to the Hidden Future of Entertainment!</h2>
              <p style="color:#7f8c8d;margin-bottom:24px;">Thank you for your interest. Here ${codes.length === 1 ? 'is your access link' : 'are your access links'}:</p>
              <table style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #eee;">
                <thead>
                  <tr style="background:#f0f4ff;">
                    <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;">#</th>
                    <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;">TITLE</th>
                    <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;">LINK</th>
                  </tr>
                </thead>
                <tbody>${linkListHtml}</tbody>
              </table>
              <p style="color:#95a5a6;font-size:13px;margin-top:24px;">Click the link(s) above to access the content. These links are shared exclusively with you.</p>
              <p style="color:#95a5a6;font-size:13px;">Best regards,<br><strong style="color:#2c3e50;">Hidden Future Entertainment Team</strong></p>
            </div>
          `
        };

        // Set a 15s timeout so the request never hangs if SMTP is slow/blocked
        let responded = false;
        const emailTimeout = setTimeout(() => {
          if (!responded) {
            responded = true;
            console.error(`Email timeout after 15s — SMTP host: smtp.zoho.in:587 — to: ${email}`);
            res.json({ success: true, message: 'Link saved! Email delivery may be delayed — please check your spam folder.' });
          }
        }, 15000);

        transporter.sendMail(mailOptions, (error) => {
          clearTimeout(emailTimeout);
          if (responded) return;
          responded = true;
          if (error) {
            console.error(`Email send error to ${email}:`, error.message);
            return res.json({ success: true, message: 'Link saved! Email delivery may be delayed — please check your spam folder.' });
          }
          console.log(`Email sent to ${email} — ${codes.length} link(s)`);
          res.json({ success: true, message: `${codes.length} link${codes.length > 1 ? 's' : ''} sent to your email!` });
        });
      }
    );
}

// ── Users / Email Overrides (admin only) ─────────────────────────────────────

// GET all unique emails with their submission count, last seen, and override
app.get('/api/users', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  db.all(`
    SELECT
      s.email,
      COUNT(s.id)        AS submission_count,
      MAX(s.timestamp)   AS last_seen,
      GROUP_CONCAT(s.codes_count) AS counts_history,
      o.serial_count     AS override
    FROM submissions s
    LEFT JOIN email_overrides o ON LOWER(o.email) = LOWER(s.email)
    GROUP BY LOWER(s.email)
    ORDER BY last_seen DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// PUT set/update per-email override
app.put('/api/users/override', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  const { email, serial_count } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const n = parseInt(serial_count);
  if (!n || n < 1) return res.status(400).json({ error: 'Must be at least 1' });

  db.run(
    `INSERT OR REPLACE INTO email_overrides (email, serial_count) VALUES (?, ?)`,
    [email.toLowerCase(), n],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ success: true });
    }
  );
});

// DELETE per-email override (revert to global)
app.delete('/api/users/override/:email', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  db.run(`DELETE FROM email_overrides WHERE LOWER(email) = LOWER(?)`, [req.params.email], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ success: true });
  });
});

// ── Codes CRUD (admin only) ───────────────────────────────────────────────────

app.get('/api/codes', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  db.all('SELECT * FROM codes ORDER BY serial_order ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/codes', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  const { code, title, link_url, serial_order: reqOrder } = req.body;
  if (!code || !code.trim()) return res.status(400).json({ error: 'Code is required' });

  db.get('SELECT MAX(serial_order) as max FROM codes', [], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const nextOrder = reqOrder ? parseInt(reqOrder) : (row.max || 0) + 1;
    db.run(
      'INSERT INTO codes (serial_order, code, title, link_url) VALUES (?, ?, ?, ?)',
      [nextOrder, code.trim(), (title || '').trim(), (link_url || '').trim()],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Code already exists' });
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, id: this.lastID });
      }
    );
  });
});

app.put('/api/codes/:id', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  const { code, title, serial_order, link_url } = req.body;
  const { id } = req.params;
  if (!code || !code.trim()) return res.status(400).json({ error: 'Code is required' });

  db.run(
    'UPDATE codes SET code = ?, title = ?, serial_order = ?, link_url = ? WHERE id = ?',
    [code.trim(), (title || '').trim(), serial_order, (link_url || '').trim(), id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Code or serial order already exists' });
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) return res.status(404).json({ error: 'Code not found' });
      res.json({ success: true });
    }
  );
});

app.delete('/api/codes/:id', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  db.run('DELETE FROM codes WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Code not found' });
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
