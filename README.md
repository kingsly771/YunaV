# 🎂 YUNAV-HBDCHAT

> Modern real-time birthday chat — **Google Sign-In via Firebase**, Socket.io messaging, birthday aesthetics.

---

## ✨ Features
- 🔐 **Google Sign-In** (Firebase Authentication — one click, no forms)
- 💬 **Real-time messaging** via Socket.io
- 👤 **User profiles** — avatar, name, status (auto-populated from Google)
- 🟢 **Online/offline + last seen** indicators
- ✓✓ **Read receipts** (blue ticks)
- ⌨️ **Typing indicators** with animated dots
- 😊 **Emoji picker** with birthday emojis 🎉🎂🎈🥳
- 📱 **Mobile-first responsive** design
- 🌙/☀️ **Dark / Light mode**
- 🎊 **Confetti animations** on auth screen

---

## 🛠 Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | HTML5, CSS3, Vanilla JS             |
| Auth        | Firebase Auth (Google provider)     |
| Backend     | Node.js + Express                   |
| Real-time   | Socket.io                           |
| Database    | SQLite via sql.js (pure JS)         |
| Deployment  | Render / Railway (free tier)        |

---

## 🚀 Quick Start

### 1. Clone & install
```bash
git clone https://github.com/YOUR_USERNAME/yunav-hbdchat.git
cd yunav-hbdchat
npm install
```

### 2. Set up Firebase

#### Frontend config
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project → Add Web App (`</>` icon)
3. Copy the `firebaseConfig` object
4. Edit `public/js/firebase-config.js` and paste your values:
```js
const FIREBASE_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
};
```

5. In Firebase Console → **Authentication** → **Sign-in method** → Enable **Google**
6. Add your domain to **Authorized domains** (e.g. `your-app.onrender.com`)

#### Backend service account
1. Firebase Console → Project Settings → **Service Accounts**
2. Click **Generate new private key** → download JSON
3. **Local dev**: save it as `firebase-service-account.json` in project root (already gitignored)
4. **Production (Render)**: set env var `FIREBASE_SERVICE_ACCOUNT` to the full JSON content (one line)

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env — set SESSION_SECRET and paste FIREBASE_SERVICE_ACCOUNT
```

### 4. Run
```bash
npm run dev    # development (nodemon)
npm start      # production
# → http://localhost:3000
```

---

## 🌐 Deploy to Render (free)

1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → connect repo
3. Build: `npm install` | Start: `npm start`
4. Environment variables:
   - `SESSION_SECRET` = any long random string
   - `FIREBASE_SERVICE_ACCOUNT` = paste your service account JSON (one line)
   - `NODE_ENV` = `production`
5. Add your Render URL to Firebase → Authentication → Authorized domains

---

## 📁 Project Structure
```
yunav-hbdchat/
├── server.js                    # Express + Socket.io
├── config/
│   ├── database.js              # sql.js SQLite wrapper
│   └── firebase-admin.js        # Token verification
├── routes/
│   ├── auth.js                  # POST /firebase, /logout, GET /me
│   └── api.js                   # Users, conversations, messages
├── middleware/auth.js
└── public/
    ├── index.html               # SPA
    ├── css/style.css
    ├── js/
    │   ├── firebase-config.js   # ← YOU EDIT THIS
    │   └── app.js               # Frontend logic
    └── uploads/                 # Avatar storage
```

---

## 📝 License
MIT — Made with 🎉🎂 by VALENHART
