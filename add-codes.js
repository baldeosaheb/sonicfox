const sqlite3 = require('sqlite3').verbose();

// Sample codes - replace with your actual codes
const codes = [
  'DEMO-2026-001',
  'DEMO-2026-002',
  'DEMO-2026-003',
  'DEMO-2026-004',
  'DEMO-2026-005',
  'DEMO-2026-006',
  'DEMO-2026-007',
  'DEMO-2026-008',
  'DEMO-2026-009',
  'DEMO-2026-010'
];

const db = new sqlite3.Database('database.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  // Create table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      used INTEGER DEFAULT 0
    )
  `);

  let added = 0;
  let processed = 0;

  const stmt = db.prepare('INSERT OR IGNORE INTO codes (code) VALUES (?)');

  codes.forEach((code) => {
    stmt.run(code, function(err) {
      processed++;
      
      if (!err && this.changes > 0) {
        added++;
        console.log(`✓ Added: ${code}`);
      } else if (!err) {
        console.log(`- Skipped (already exists): ${code}`);
      } else {
        console.error(`✗ Error adding ${code}:`, err.message);
      }

      if (processed === codes.length) {
        stmt.finalize();
        
        console.log(`\n✓ Successfully added ${added} new code(s) to the database`);
        
        // Show total codes
        db.get('SELECT COUNT(*) as count FROM codes', [], (err, total) => {
          if (err) {
            console.error('Error getting total:', err);
            db.close();
            return;
          }
          
          db.get('SELECT COUNT(*) as count FROM codes WHERE used = 0', [], (err, available) => {
            if (err) {
              console.error('Error getting available:', err);
              db.close();
              return;
            }
            
            console.log(`\nDatabase Status:`);
            console.log(`- Total codes: ${total.count}`);
            console.log(`- Available codes: ${available.count}`);
            console.log(`- Used codes: ${total.count - available.count}`);
            
            db.close((err) => {
              if (err) {
                console.error('Error closing database:', err);
              }
            });
          });
        });
      }
    });
  });
});

// Made with Bob
