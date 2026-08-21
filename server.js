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

        // Build email HTML list — only show link, warn if missing
        const linkListHtml = codes.map((c, i) => {
          const linkCell = c.link_url
            ? `<a href="${c.link_url}" style="color:#667eea;font-weight:700;text-decoration:none;word-break:break-all;font-size:14px;">${c.link_url}</a>`
            : `<span style="color:#e74c3c;font-size:13px;">⚠ Link not set yet — check back soon</span>`;
          return `<tr>
            <td style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-size:13px;">${i + 1}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #eee;font-weight:600;color:#2c3e50;">${c.title || ''}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #eee;">${linkCell}</td>
          </tr>`;
        }).join('');

        // Plain text version reduces spam score significantly
        const plainText = codes.map((c, i) =>
          `${i + 1}. ${c.title || 'Episode ' + (i+1)}\n   ${c.link_url || '(link coming soon)'}`
        ).join('\n\n');

        const mailOptions = {
          from: `Hidden Future Entertainment <${process.env.EMAIL_USER}>`,
          to: email,
          subject: `Your content access — Hidden Future Entertainment`,
          text: `Hi,\n\nThank you for your interest in Hidden Future Entertainment.\n\nHere ${codes.length === 1 ? 'is your access link' : 'are your access links'}:\n\n${plainText}\n\nIf you did not request this, please ignore this email.\n\nBest regards,\nHidden Future Entertainment`,
          html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;padding:28px 36px;">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">Hidden Future Entertainment</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 8px 0;font-size:16px;font-weight:bold;color:#1a1a2e;">Hi there,</p>
            <p style="margin:0 0 24px 0;font-size:14px;color:#555555;line-height:1.6;">
              Thank you for your interest. Here ${codes.length === 1 ? 'is your access link' : 'are your access links'} for the content you requested:
            </p>

            <!-- Links table -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f8f8f8;">
                <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#888888;text-transform:uppercase;width:32px;">#</td>
                <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#888888;text-transform:uppercase;">Title</td>
                <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#888888;text-transform:uppercase;">Link</td>
              </tr>
              ${linkListHtml}
            </table>

            <p style="margin:0 0 6px 0;font-size:13px;color:#777777;line-height:1.6;">
              Click the link to access the content. This was sent exclusively to you.
            </p>
            <p style="margin:0;font-size:13px;color:#777777;line-height:1.6;">
              If you did not request this email, you can safely ignore it.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f8f8;padding:20px 36px;border-top:1px solid #e8e8e8;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;line-height:1.6;">
              Hidden Future Entertainment &nbsp;|&nbsp; This is a transactional email sent because you submitted your address on our website.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
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
