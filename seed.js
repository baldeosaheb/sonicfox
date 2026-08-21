/**
 * Railway startup script — seeds initial codes if DB is empty.
 * Runs automatically before server starts via railway.json.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.RAILWAY_ENVIRONMENT ? '/data/database.db' : 'database.db';

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_order INTEGER UNIQUE NOT NULL,
    code TEXT UNIQUE NOT NULL,
    title TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('serial_count', '1')`);

  db.run(`ALTER TABLE codes ADD COLUMN serial_order INTEGER`, () => {});
  db.run(`ALTER TABLE codes ADD COLUMN title TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE submissions ADD COLUMN codes_sent TEXT DEFAULT ''`, () => {});

  db.run(`UPDATE codes SET serial_order = id WHERE serial_order IS NULL OR serial_order = 0`);

  // Seed default codes only if table is empty
  db.get('SELECT COUNT(*) as count FROM codes', [], (err, row) => {
    if (err || row.count > 0) { db.close(); return; }

    const codes = [
      [1, 'Episode 1',  'DEMO-2026-001'],
      [2, 'Episode 2',  'DEMO-2026-002'],
      [3, 'Episode 3',  'DEMO-2026-003'],
      [4, 'Episode 4',  'DEMO-2026-004'],
      [5, 'Episode 5',  'DEMO-2026-005'],
      [6, 'Episode 6',  'DEMO-2026-006'],
      [7, 'Episode 7',  'DEMO-2026-007'],
      [8, 'Episode 8',  'DEMO-2026-008'],
      [9, 'Episode 9',  'DEMO-2026-009'],
      [10,'Episode 10', 'DEMO-2026-010'],
    ];

    const stmt = db.prepare('INSERT OR IGNORE INTO codes (serial_order, title, code) VALUES (?, ?, ?)');
    codes.forEach(([order, title, code]) => stmt.run(order, title, code));
    stmt.finalize(() => {
      console.log('Seeded 10 default codes');
      db.close();
    });
  });
});
