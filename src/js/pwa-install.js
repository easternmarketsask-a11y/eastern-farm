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
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }
  function en() {
    return ((window.Farm && Farm.state && Farm.state.data && Farm.state.data.language) || 'zh') === 'en';
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

  // iOS: no install event — show a how-to guide instead.
  function maybeShowIOSGuide() {
    if (isStandalone() || dismissed() || !isIOS()) return;
    showBanner(
      '<span class="pwa-install-text">' +
        (en()
          ? '🌱 Add to Home Screen: tap Share, then “Add to Home Screen”.'
          : '🌱 添加到主屏幕：点底部「分享」，选「添加到主屏幕」。') +
      '</span>' +
      '<button class="pwa-install-close" aria-label="close">✕</button>'
    );
  }

  window.addEventListener('load', () => { setTimeout(maybeShowIOSGuide, 2500); });
})();
