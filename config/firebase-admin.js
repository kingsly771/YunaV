/**
 * Firebase Admin SDK initializer
 * Verifies Google ID tokens sent from the frontend
 */
const admin = require('firebase-admin');

let _initialized = false;

function initFirebaseAdmin() {
  if (_initialized) return admin;

  // Option A: Service account JSON file (recommended for local dev)
  // Download from Firebase Console → Project Settings → Service Accounts → Generate new private key
  // Save as firebase-service-account.json in project root (keep out of git!)

  // Option B: Environment variable (recommended for Render/production)
  // Set FIREBASE_SERVICE_ACCOUNT to the full JSON string (one line)

  // Option C: FIREBASE_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS env var path

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Env var: full JSON string
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      const fs   = require('fs');
      const path = require('path');
      const saPath = path.join(__dirname, '..', 'firebase-service-account.json');

      if (fs.existsSync(saPath)) {
        // Local file
        const serviceAccount = require(saPath);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      } else if (process.env.FIREBASE_PROJECT_ID) {
        // Application Default Credentials (Google Cloud environments)
        admin.initializeApp({
          credential:   admin.credential.applicationDefault(),
          projectId:    process.env.FIREBASE_PROJECT_ID
        });
      } else {
        // DEV MODE: no credentials — token verification will be skipped
        console.warn('⚠️  Firebase Admin: no credentials found. Running in DEV mode (token verification DISABLED).');
        admin.initializeApp({ projectId: 'dev-project' });
      }
    }

    _initialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.error('Firebase Admin init error:', err.message);
    throw err;
  }

  return admin;
}

/**
 * Verify a Firebase ID token from the client.
 * Returns the decoded token payload (uid, email, name, picture, etc.)
 */
async function verifyIdToken(idToken) {
  const app = initFirebaseAdmin();

  // DEV bypass: if no real credentials, decode without verifying
  // NEVER use in production!
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    const fs   = require('fs');
    const path = require('path');
    const saPath = path.join(__dirname, '..', 'firebase-service-account.json');
    const hasFile = fs.existsSync(saPath);

    if (!hasFile && !process.env.FIREBASE_PROJECT_ID) {
      console.warn('⚠️  DEV MODE: skipping token verification');
      // Minimal decode (base64url, no signature check)
      const parts   = idToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload;
    }
  }

  return app.auth().verifyIdToken(idToken);
}

module.exports = { initFirebaseAdmin, verifyIdToken };
