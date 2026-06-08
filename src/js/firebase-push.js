/* firebase-push.js — Web Push (FCM) opt-in + token registration. (Farm.push)
 *
 * iOS only allows web push once the game is installed as a PWA (Add to Home
 * Screen) AND opened from the home-screen icon, on a SECURE origin (https or
 * localhost). On http LAN IPs the service worker won't even register, so this
 * module simply no-ops there.
 *
 * Flow:
 *   - boot → Farm.push.init(): if permission is already granted, silently
 *     refresh the token + bump push.lastOpenedAt.
 *   - first harvest → Farm.farm calls maybePromptAfterHarvest(): a gentle
 *     pre-prompt banner ("turn on reminders?") so we don't waste the one-shot
 *     native permission dialog. Declining sets a flag so we stop nagging.
 *
 * Token + opt-in + lastOpenedAt are stored on members/{uid}.push (same doc as
 * gameStats — single source of truth). The daily reminder Cloud Function
 * (Task 5b, in EasternMarket_app/functions) reads these to decide who to push.
 *
 * VAPID PUBLIC key (safe to ship client-side). The PRIVATE key is managed by
 * Firebase server-side and is NOT used here.
 */
(function () {
  const VAPID_PUBLIC_KEY = 'BE1Q7xTpMUAk2IwyISXxYxuR_EadC50sNWlmung9yde55tSKlTj-DcyAaWOEw50LbVmJlZx2-NL6QGfLIquPjRs';
  const DISMISS_KEY = 'ef_push_prompt_dismissed_v1';

  function en() {
    return ((window.Farm && Farm.state && Farm.state.data && Farm.state.data.language) || 'zh') === 'en';
  }
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }
  function uid() {
    return (window.Farm && Farm.fbAuth && Farm.fbAuth.uid && Farm.fbAuth.uid()) || null;
  }
  function supported() {
    try {
      return 'serviceWorker' in navigator && 'PushManager' in window &&
        window.firebase && firebase.messaging &&
        (typeof firebase.messaging.isSupported !== 'function' || firebase.messaging.isSupported());
    } catch (e) { return false; }
  }

  async function storeToken(token) {
    const id = uid();
    if (!id || !Farm.fb || !Farm.fb.db) return;
    try {
      await Farm.fb.db.collection('members').doc(id).set({
        push: {
          fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
          optIn: true,
          lang: (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh',
          lastOpenedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
    } catch (e) { console.warn('[push] storeToken failed', e); }
  }

  const push = {
    _msgBound: false,
    _prompted: false,

    init() {
      if (!supported()) return;
      // Let Firebase Auth settle, then act on an already-granted permission.
      setTimeout(() => {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          this._registerToken();
        }
      }, 3000);
    },

    async _registerToken() {
      try {
        const reg = await navigator.serviceWorker.ready;  // our root caching+FCM SW
        const messaging = firebase.messaging();
        const token = await messaging.getToken({
          vapidKey: VAPID_PUBLIC_KEY,
          serviceWorkerRegistration: reg,
        });
        if (token) await storeToken(token);
        if (!this._msgBound) {
          this._msgBound = true;
          messaging.onMessage((payload) => {
            const n = (payload && payload.notification) || {};
            if (Farm.ui && n.title) {
              Farm.ui.toast('🔔 ' + n.title + (n.body ? ' · ' + n.body : ''), 4200);
            }
          });
        }
      } catch (e) {
        console.warn('[push] token register failed', e);
      }
    },

    // Called from farm.js after a successful harvest. Shows a one-time gentle
    // pre-prompt only when it makes sense to ask.
    maybePromptAfterHarvest() {
      if (!supported() || this._prompted) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
      if (dismissed() || !uid()) return;  // need a login to store the token
      this._prompted = true;
      this._showPrompt();
    },

    _showPrompt() {
      if (document.getElementById('pushPromptBanner')) return;
      const el = document.createElement('div');
      el.id = 'pushPromptBanner';
      el.className = 'pwa-install-banner';
      el.innerHTML =
        '<span class="pwa-install-text">' +
          (en() ? '🔔 Turn on reminders so we can tell you when your crops are ready?'
                : '🔔 开启提醒，菜熟了第一时间叫你？') +
        '</span>' +
        '<button class="pwa-install-action" id="pushPromptYes">' + (en() ? 'Turn on' : '开启') + '</button>' +
        '<button class="pwa-install-close" id="pushPromptNo" aria-label="close">✕</button>';
      document.body.appendChild(el);
      const yes = document.getElementById('pushPromptYes');
      const no = document.getElementById('pushPromptNo');
      if (yes) yes.onclick = () => { el.remove(); this.requestAndRegister(); };
      if (no) no.onclick = () => { setDismissed(); el.remove(); };
    },

    async requestAndRegister() {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          await this._registerToken();
          if (Farm.ui) Farm.ui.toast(en() ? '🔔 Reminders on!' : '🔔 提醒已开启！', 3000);
        } else {
          setDismissed();  // denied — don't nag again
        }
      } catch (e) {
        console.warn('[push] requestPermission failed', e);
      }
    },
  };

  window.Farm = window.Farm || {};
  Farm.push = push;

  // Self-init after load (init() internally waits for auth to settle).
  window.addEventListener('load', () => push.init());
})();
