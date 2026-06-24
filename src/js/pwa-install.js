/* pwa-install.js — encourage "Add to Home Screen".
 *
 * iOS Safari never fires `beforeinstallprompt`, so for iOS we show a one-time
 * guide ("Share → Add to Home Screen"). Android/desktop Chrome use the real
 * `beforeinstallprompt` event with an Install button. A "don't show again"
 * flag (set when the user closes the banner) keeps us from nagging.
 *
 * Self-contained: attaches nothing to Farm except reading the current
 * language for bilingual copy (guarded — works even before state loads).
 */
(function () {
  const DISMISS_KEY = 'ef_pwa_install_dismissed_v1';

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
  }
  function isIpad() {
    const ua = window.navigator.userAgent;
    // iPadOS 13+ reports a desktop (Macintosh) UA but has touch.
    return /ipad/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  }
  // In-app webviews (WeChat etc.) CAN'T add to home screen — players must open
  // the page in a real browser (Safari/Chrome) first.
  function isInAppBrowser() {
    return /MicroMessenger|QQ\/|QQBrowser|Weibo|WeiBo|DingTalk|Quark|UCBrowser|FBAN|FBAV|Instagram|Line\//i.test(window.navigator.userAgent);
  }
  function isWeChat() {
    return /MicroMessenger/i.test(window.navigator.userAgent);
  }
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }
  function en() {
    return ((window.Farm && Farm.state && Farm.state.data && Farm.state.data.language) || 'zh') === 'en';
  }

  // Don't nag a brand-new player to "install" before they've felt any value —
  // that's a textbook first-run anti-pattern. Wait for a win moment: the player
  // has harvested at least once, OR is a returning visitor (login streak ≥ 2).
  // This delays the prompt by seconds for first-timers (it fires right after
  // their first harvest) while still surfacing it for everyone engaged. The
  // module stays self-contained — it only READS Farm.state, never wires into it.
  function engaged() {
    try {
      const d = window.Farm && Farm.state && Farm.state.data;
      if (!d) return false;
      return (d.totalHarvests || 0) > 0 || d.firstHarvestCelebrated === true || (d.loginStreak || 0) >= 2;
    } catch (e) { return false; }
  }
  // Run `cb` as soon as the player is engaged; poll cheaply until then, and
  // give up after ~10 min so we never leave a dangling interval.
  function whenEngaged(cb) {
    if (engaged()) { cb(); return; }
    let tries = 0;
    const iv = setInterval(() => {
      if (engaged()) { clearInterval(iv); cb(); }
      else if (++tries > 120) { clearInterval(iv); }
    }, 5000);
  }

  function showBanner(innerHTML, onAction) {
    if (document.getElementById('pwaInstallBanner')) return;
    const el = document.createElement('div');
    el.id = 'pwaInstallBanner';
    el.className = 'pwa-install-banner';
    el.innerHTML = innerHTML;
    document.body.appendChild(el);
    const closeBtn = el.querySelector('.pwa-install-close');
    if (closeBtn) closeBtn.onclick = () => { setDismissed(); el.remove(); };
    const actBtn = el.querySelector('.pwa-install-action');
    if (actBtn && onAction) actBtn.onclick = onAction;
  }

  // Android / desktop Chrome: real install prompt.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (isStandalone() || dismissed()) return;
    whenEngaged(() => {
    if (isStandalone() || dismissed() || !deferredPrompt) return;
    showBanner(
      '<span class="pwa-install-text">' +
        (en() ? '🌱 Add Eastern Farm to your home screen' : '🌱 把东方农场加到主屏幕，每天玩更方便') +
      '</span>' +
      '<button class="pwa-install-action">' + (en() ? 'Install' : '添加') + '</button>' +
      '<button class="pwa-install-close" aria-label="close">✕</button>',
      async () => {
        const banner = document.getElementById('pwaInstallBanner');
        if (deferredPrompt) {
          deferredPrompt.prompt();
          try { await deferredPrompt.userChoice; } catch (e) {}
          deferredPrompt = null;
        }
        if (banner) banner.remove();
      }
    );
    });
  });

  // Environment-aware "add to home screen" guide (iOS has no install event).
  function maybeShowGuide() {
    if (isStandalone() || dismissed()) return;

    // In-app browsers (WeChat/QQ/…) can't add to home screen — guide the user
    // to open the page in a real browser first. This is the common case since
    // links are shared in WeChat groups.
    if (isInAppBrowser()) {
      showBanner(
        '<span class="pwa-install-text">' +
          (en()
            ? '🌱 To install: open this page in your browser (Safari/Chrome) first — tap the “···” menu → “Open in Browser”.'
            : (isWeChat()
                ? '🌱 想加到主屏幕：先点右上角「···」→「在浏览器打开」，再用 Safari 添加到主屏幕。'
                : '🌱 想加到主屏幕：请先用 Safari/Chrome 打开本页面，再添加到主屏幕。')) +
        '</span>' +
        '<button class="pwa-install-close" aria-label="close">✕</button>'
      );
      return;
    }

    if (!isIOS()) return; // Android/desktop use the beforeinstallprompt button

    // On iPhone the Share button is in the bottom toolbar; on iPad it's top.
    const where = isIpad()
      ? (en() ? 'the Share button (top bar)' : '顶部「分享」按钮')
      : (en() ? 'the Share button (bottom bar)' : '底部「分享」按钮');
    showBanner(
      '<span class="pwa-install-text">' +
        (en()
          ? '🌱 Add to Home Screen: tap ' + where + ', then “Add to Home Screen”.'
          : '🌱 添加到主屏幕：点' + where + '，选「添加到主屏幕」。') +
      '</span>' +
      '<button class="pwa-install-close" aria-label="close">✕</button>'
    );
  }

  window.addEventListener('load', () => { setTimeout(() => whenEngaged(maybeShowGuide), 2500); });
})();
