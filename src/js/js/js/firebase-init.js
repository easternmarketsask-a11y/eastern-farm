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

  /* 🔒 可重入：SDK 现在不在，不代表永远不在（2026-08-12）
     index.html 把 5 个 gstatic 脚本改成了动态按序加载（原来是 defer，会把 50 个
     本地游戏模块一起扣住 → 弱网下游戏永远打不开）。所以本文件执行时 SDK 很可能
     还在路上。此时不能像从前那样一口咬定 available:false 就完事 —— 要留个
     Farm.fbLateInit 回调，等 SDK 落地再补初始化，否则登录/云存档会静默失效。 */
  function boot() {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      fallback('SDK script missing');
      return false;
    }
    return init();
  }

  function init() {
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
      // Callable factory (needs firebase-functions-compat.js). Returns null if unavailable.
      callable: (name) => {
        try { return firebase.app().functions('us-central1').httpsCallable(name); }
        catch (e) { return null; }
      },
    };
      console.log('🔥 Firebase initialized (project: eastern-market-members)');
      return true;
    } catch (e) {
      fallback(e.message);
      return false;
    }
  }

  window.Farm = window.Farm || {};

  // 快路径：SDK 已经到了（网速好 / 已缓存）→ 立刻初始化，行为与从前完全一致
  if (boot()) return;

  // 慢路径：SDK 还在路上 → 由 index.html 的动态加载器在全部落地后回调
  window.Farm.fbLateInit = function () {
    if (window.Farm.fb && window.Farm.fb.available) return;   // 已经好了，别重复
    if (!init()) return;
    // 补跑依赖 Firebase 的初始化。只有在 main.js 已经试过一次（那次因为
    // available:false 提前返回了）时才补，否则会和 main.js 稍后那次重复注册
    // onAuthStateChanged。见 main.js 里的 Farm.__fbAuthInitTried。
    if (!window.Farm.__fbAuthInitTried) return;
    try { if (Farm.fbAuth && Farm.fbAuth.init) Farm.fbAuth.init(); } catch (e) {}
    try { if (Farm.fbQueue && Farm.fbQueue.install) Farm.fbQueue.install(); } catch (e) {}
  };
})();
