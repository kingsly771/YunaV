# 🎂 YUNAV-HBDCHAT

> A modern real-time birthday chat platform — WhatsApp OTP auth, Socket.io messaging, birthday aesthetics.

![YUNAV-HBDCHAT](https://img.shields.io/badge/YUNAV-HBDCHAT-purple?style=for-the-badge)

---

## ✨ Features

- 🔐 **WhatsApp OTP Authentication** (Meta Cloud API or Twilio)
- 💬 **Real-time messaging** via Socket.io
- 👤 **User profiles** with avatars, name, status
- 🟢 **Online/offline indicators** with last-seen timestamps
- ✓✓ **Read receipts** (blue ticks like WhatsApp)
- ⌨️ **Typing indicators** with animated dots
- 😊 **Emoji picker** with birthday emojis (🎉🎂🎈🥳)
- 📱 **Mobile-first responsive design**
- 🌙/☀️ **Dark and Light mode**
- 🎊 **Birthday confetti animations**

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3 (Grid/Flex), Vanilla JS |
| Backend | Node.js + Express |
| Real-time | Socket.io |
| Database | SQLite (better-sqlite3) |
| Auth | WhatsApp Cloud API / Twilio |
| Deployment | Render / Railway |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/yunav-hbdchat.git
cd yunav-hbdchat
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
PORT=3000
SESSION_SECRET=your-secret-here

# Meta WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_token
WHATSAPP_VERIFY_TOKEN=your_verify_token
APP_URL=http://localhost:3000
```

### 3. Run Locally

```bash
npm run dev    # Development (with nodemon)
# or
npm start      # Production
```

App runs at: **http://localhost:3000**

> **DEV MODE**: If no WhatsApp API is configured, OTPs are printed to the console — great for local testing!

---

## 📲 WhatsApp API Setup

### Option A: Meta WhatsApp Cloud API (Recommended — Free)

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a new App → Select "Business"
3. Add **WhatsApp** product
4. Under WhatsApp → Getting Started:
   - Copy **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - Generate/copy **Access Token** → `WHATSAPP_ACCESS_TOKEN`
5. Set `WHATSAPP_VERIFY_TOKEN` to any random string
6. Under **Webhooks**, set URL: `https://your-app.onrender.com/webhook`
   - Subscribe to: `messages`

### Option B: Twilio WhatsApp

1. Sign up at [twilio.com](https://twilio.com)
2. Go to Messaging → Senders → WhatsApp Senders
3. Activate sandbox or request production number
4. Set in `.env`:
   ```env
   TWILIO_ACCOUNT_SID=ACxxx
   TWILIO_AUTH_TOKEN=xxx
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
   ```
5. Also run: `npm install twilio`

---

## 🌐 Deploy to Render (Free)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add Environment Variables from your `.env`
6. Deploy!

The `render.yaml` file is pre-configured for one-click deployment.

---

## 📁 Project Structure

```
yunav-hbdchat/
├── server.js              # Main server + Socket.io
├── package.json
├── render.yaml            # Render deployment config
├── .env.example
├── config/
│   ├── database.js        # SQLite schema setup
│   └── whatsapp.js        # OTP sending service
├── routes/
│   ├── auth.js            # Login/OTP/logout routes
│   └── api.js             # Users, conversations, messages
├── middleware/
│   └── auth.js            # Session auth guard
└── public/
    ├── index.html         # Single-page app
    ├── css/style.css      # All styles
    ├── js/app.js          # Frontend logic
    └── uploads/           # Avatar uploads (auto-created)
```

---

## 🔧 Configuration Notes

- **Database**: SQLite file is created at `data/yunav.db` automatically
- **Uploads**: Avatar images stored at `public/uploads/`
- **Sessions**: 7-day cookie sessions with `express-session`
- **Rate limiting**: OTP requests limited to 3 per 10 minutes per IP

---

## 🎨 Customization

- Edit CSS variables in `public/css/style.css` under `:root` to change colors
- Modify birthday emojis throughout the HTML
- Add more country codes to the phone select in `index.html`

---

## 📝 License

MIT — Made with 🎉🎂 by VALENHART
