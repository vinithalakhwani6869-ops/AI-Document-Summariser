const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

function getPrivateKey() {
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    return "";
  }
  return process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
}

function hasAdminCredentials() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
}

function ensureFirebaseAdminApp() {
  if (!hasAdminCredentials()) {
    throw new Error(
      "Firebase Admin credentials are missing. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in backend/.env."
    );
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getPrivateKey(),
      }),
    });
  }
  return getApps()[0];
}

function getFirebaseAuth() {
  ensureFirebaseAdminApp();
  return getAuth();
}

function getFirebaseDb() {
  ensureFirebaseAdminApp();
  return getFirestore();
}

function getPublicFirebaseConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
  };
}

function hasPublicFirebaseConfig() {
  const config = getPublicFirebaseConfig();

  return Boolean(
    config.apiKey && config.authDomain && config.projectId && config.storageBucket && config.messagingSenderId && config.appId
  );
}

module.exports = {
  getFirebaseAuth,
  getFirebaseDb,
  getPublicFirebaseConfig,
  hasAdminCredentials,
  hasPublicFirebaseConfig,
};