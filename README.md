# Hidden Future Entertainment - Landing Page

A simple, mobile-first landing page for collecting email addresses and distributing access codes.

## Features

- 📱 Mobile-first responsive design
- 📧 Email collection with automatic code distribution
- 🔐 Admin panel with authentication
- 💾 SQLite database (no external database required)
- 📊 Admin dashboard to view all submissions
- 🎨 Light theme with modern UI

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Email**: Nodemailer
- **Frontend**: Pure HTML/CSS/JavaScript (no frameworks)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Email Settings

Edit `server.js` and update the email configuration (lines 31-36):

```javascript
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: 'your-email@gmail.com', // Your email
    pass: 'your-app-password' // Your app-specific password
  }
});
```

**For Gmail:**
1. Enable 2-factor authentication
2. Generate an app-specific password: https://myaccount.google.com/apppasswords
3. Use that password in the configuration

### 3. Add Access Codes to Database

You can add codes in two ways:

**Option A: Using the API endpoint**

Create a file `add-codes.js`:

```javascript
const codes = [
  'CODE-001-DEMO',
  'CODE-002-DEMO',
  'CODE-003-DEMO',
  'CODE-004-DEMO',
  'CODE-005-DEMO'
];

fetch('http://localhost:3000/api/add-codes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ codes })
})
.then(res => res.json())
.then(data => console.log('Codes added:', data))
.catch(err => console.error('Error:', err));
```

Then run: `node add-codes.js`

**Option B: Using SQLite directly**

```bash
npm install -g better-sqlite3
node -e "const db = require('better-sqlite3')('database.db'); const stmt = db.prepare('INSERT INTO codes (code) VALUES (?)'); ['CODE-001', 'CODE-002', 'CODE-003'].forEach(code => stmt.run(code));"
```

### 4. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## Usage

### Main Landing Page
- Visit: `http://localhost:3000`
- Users enter their email and click "Get Code"
- An access code is automatically sent to their email

### Admin Panel
- Visit: `http://localhost:3000/admin`
- Login credentials:
  - Username: `baldeosaheb`
  - Password: `admin-baldeo`
- View all email submissions and assigned codes
- Auto-refreshes every 30 seconds

## Database Schema

### `codes` table
- `id`: Auto-increment primary key
- `code`: Unique access code
- `used`: Boolean (0 = available, 1 = used)

### `submissions` table
- `id`: Auto-increment primary key
- `email`: User's email address
- `code`: Assigned access code
- `timestamp`: Submission date/time

## Project Structure

```
.
├── server.js           # Express server and API routes
├── package.json        # Dependencies
├── database.db         # SQLite database (auto-created)
├── public/
│   ├── index.html      # Landing page
│   ├── login.html      # Admin login page
│   └── admin.html      # Admin dashboard
└── README.md           # This file
```

## Security Notes

1. Change the session secret in `server.js` (line 26)
2. Use environment variables for sensitive data in production
3. Enable HTTPS in production
4. Consider rate limiting for the email endpoint
5. Update admin credentials before deployment

## Customization

### QR Code
The QR code in the landing page is embedded as SVG. To change it:
1. Generate a new QR code (use https://www.qr-code-generator.com/)
2. Convert to SVG format
3. Base64 encode the SVG
4. Replace the `data:image/svg+xml;base64,...` in `public/index.html`

### Email Template
Edit the email template in `server.js` (lines 95-104)

### Styling
All styles are inline in the HTML files for easy customization

## Troubleshooting

**Email not sending:**
- Check email credentials in `server.js`
- Verify app-specific password for Gmail
- Check spam folder
- Review server console for errors

**Database errors:**
- Delete `database.db` and restart to recreate
- Ensure write permissions in the project directory

**Admin login not working:**
- Clear browser cookies/session
- Verify credentials match those in `server.js` (line 54)

## License

MIT