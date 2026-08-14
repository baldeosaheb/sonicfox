# Quick Setup Guide

## ⚡ Quick Start (5 minutes)

### 1. Email Configuration (IMPORTANT)

Before running the server, you MUST configure email settings in `server.js`:

**For Gmail:**
1. Go to your Google Account settings
2. Enable 2-Factor Authentication
3. Generate an App Password: https://myaccount.google.com/apppasswords
4. Update `server.js` lines 53-58:

```javascript
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'your-actual-email@gmail.com',  // ← Change this
    pass: 'your-16-char-app-password'      // ← Change this
  }
});
```

Also update line 142 with your email address.

### 2. Start the Server

```bash
npm start
```

### 3. Access the Application

- **Landing Page**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin
  - Username: `baldeosaheb`
  - Password: `admin-baldeo`

## 📝 Adding More Codes

Edit `add-codes.js` and add your codes to the array, then run:

```bash
node add-codes.js
```

## 🎨 Customization

### Change QR Code
1. Generate your QR code at https://www.qr-code-generator.com/
2. Download as SVG
3. Convert to base64: https://base64.guru/converter/encode/image
4. Replace the `data:image/svg+xml;base64,...` in `public/index.html` (line 183)

### Change Admin Credentials
Edit `server.js` line 77:
```javascript
if (username === 'your-username' && password === 'your-password') {
```

### Change Colors/Styling
All CSS is inline in the HTML files for easy customization.

## 🔧 Troubleshooting

**Email not sending?**
- Verify email credentials in `server.js`
- Check if 2FA is enabled and app password is correct
- Look for errors in the terminal

**Can't login to admin?**
- Clear browser cookies
- Verify credentials in `server.js`

**Database errors?**
- Delete `database.db` and restart
- Run `node add-codes.js` again

## 📦 Database Info

- **Type**: SQLite (file-based, no server needed)
- **Location**: `database.db` in project root
- **Tables**: `codes`, `submissions`

## 🚀 Production Deployment

1. Set environment variables for sensitive data
2. Enable HTTPS
3. Change session secret
4. Add rate limiting
5. Update admin credentials
6. Consider using a production-grade database

## 📱 Testing

1. Open http://localhost:3000 in your browser
2. Enter an email address
3. Click "Get Code"
4. Check the email inbox (and spam folder)
5. Login to admin panel to see the submission

Enjoy! 🎉