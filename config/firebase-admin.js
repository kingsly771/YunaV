/**
 * Firebase Admin SDK initializer
 * Verifies Google ID tokens sent from the frontend
 */
const admin = require('firebase-admin');

let _initialized = false;

function initFirebaseAdmin() {
  if (_initialized) return admin;

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      const fs   = require('fs');
      const path = require('path');
      const saPath = path.join(__dirname, '..', 'firebase-service-account.json');

      if (fs.existsSync(saPath)) {
        const serviceAccount = require(saPath);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      } else if (process.env.FIREBASE_PROJECT_ID) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId:  process.env.FIREBASE_PROJECT_ID
        });
      } else {
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
      // Fix: properly decode base64url JWT payload
      const parts  = idToken.split('.');
      const b64    = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
      return payload;
    }
  }

  return app.auth().verifyIdToken(idToken);
}

module.exports = { initFirebaseAdmin, verifyIdToken };
