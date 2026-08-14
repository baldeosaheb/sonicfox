require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new sqlite3.Database('database.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      used INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 hour
}));

// Configure nodemailer with Zoho Mail
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.in',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Routes
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

// Admin login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Admin logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get all submissions (admin only)
app.get('/api/submissions', (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  db.all('SELECT * FROM submissions ORDER BY timestamp DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Submit email and get code
app.post('/api/get-code', (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Get an unused code
  db.get('SELECT * FROM codes WHERE used = 0 LIMIT 1', [], (err, codeRow) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!codeRow) {
      return res.status(500).json({ error: 'No codes available. Please contact support.' });
    }

    // Mark code as used
    db.run('UPDATE codes SET used = 1 WHERE id = ?', [codeRow.id], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Save submission
      db.run('INSERT INTO submissions (email, code) VALUES (?, ?)', [email, codeRow.code], (err) => {
        if (err) {
          console.error('Error saving submission:', err);
        }

        // Send email
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: 'Your Access Code - Hidden Future Entertainment',
          html: `
            <h2>Welcome to the Hidden Future of Entertainment!</h2>
            <p>Thank you for your interest in our exclusive demo.</p>
            <p>Your access code is: <strong style="font-size: 24px; color: #4CAF50;">${codeRow.code}</strong></p>
            <p>This is a trial version with restricted features. Use this code to access the product.</p>
            <br>
            <p>Best regards,<br>Hidden Future Entertainment Team</p>
          `
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.error('Email error:', error);
            // Even if email fails, we still return success since code was assigned
            return res.json({ 
              success: true, 
              message: 'Code assigned but email delivery may be delayed. Please check your spam folder.',
              code: codeRow.code 
            });
          }
          res.json({ success: true, message: 'Code sent to your email!' });
        });
      });
    });
  });
});

// Helper endpoint to add codes (for initial setup)
app.post('/api/add-codes', (req, res) => {
  const { codes } = req.body;
  
  if (!Array.isArray(codes)) {
    return res.status(400).json({ error: 'Codes must be an array' });
  }

  let added = 0;
  let processed = 0;

  codes.forEach((code) => {
    db.run('INSERT OR IGNORE INTO codes (code) VALUES (?)', [code], function(err) {
      processed++;
      if (!err && this.changes > 0) {
        added++;
      }
      
      if (processed === codes.length) {
        res.json({ success: true, added });
      }
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});

// Made with Bob
