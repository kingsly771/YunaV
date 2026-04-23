/**
 * ════════════════════════════════════════════════════════════
 * YUNAV-HBDCHAT — Firebase Configuration
 * ════════════════════════════════════════════════════════════
 *
 * HOW TO GET YOUR FIREBASE CONFIG:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a new project (or use existing)
 * 3. Click the </> (Web) icon to add a web app
 * 4. Copy the firebaseConfig object and paste it below
 * 5. In Firebase Console → Authentication → Sign-in method
 *    → Enable "Google"
 *
 * ════════════════════════════════════════════════════════════
 */

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Do not edit below this line
window.__FIREBASE_CONFIG__ = FIREBASE_CONFIG;
