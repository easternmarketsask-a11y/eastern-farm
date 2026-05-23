/**
 * firebase-init.js — Initialize Firebase (same project as main store).
 *
 * Loads after firebase-app-compat / firebase-auth-compat / firebase-firestore-compat
 * CDN scripts in index.html. If any of those failed to load (e.g. offline,
 * CDN blocked), Farm.fb.available = false and the game continues in guest
 * mode without crashing.
 *
 * Same firebaseConfig as the main store React app
 * (D:/easternmarket.ca/EasternMarket_app/frontend-web/src/lib/firebase.ts).
 * These keys are public client-side keys; security comes from Firestore
 * Security Rules, not from hiding the API key.
 */
(function() {
  const firebaseConfig = {
    apiKey: 'AIzaSyDDhVm_n_TyV2mtp517qUoLU4A9HB1k3No',
    authDomain: 'eastern-market-members.firebaseapp.com',
    projectId: 'eastern-market-members',
    storageBucket: 'eastern-market-members.firebasestorage.app',
    messagingSenderId: '515107029536',
    appId: '1:515107029536:web:9f6caef22bae67aa5af245',
    measurementId: 'G-9V0MS15QQ7',
  };

  function fallback(reason) {
    console.warn('[firebase-init] running without Firebase:', reason);
    window.Farm = window.Farm || {};
    window.Farm.fb = { available: false, reason };
  }

  if (typeof firebase === 'undefined' || !firebase.initializeApp) {
    fallback('SDK script missing');
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const auth = firebase.auth();
    const db = firebase.firestore();
    // Persist auth across reloads
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    window.Farm = window.Farm || {};
    window.Farm.fb = {
      available: true,
      auth,
      db,
      // Convenient sentinel
      serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
      increment: (n) => firebase.firestore.FieldValue.increment(n),
    };
    console.log('🔥 Firebase initialized (project: eastern-market-members)');
  } catch (e) {
    fallback(e.message);
  }
})();
