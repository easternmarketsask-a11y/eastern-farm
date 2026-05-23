/**
 * ui.js — Generic UI helpers: modal, toast, currency display, level bar.
 */
(function() {
  const ui = {
    refreshHUD() {
      const s = Farm.state.data;
      const lang = s.language || 'zh';
      document.getElementById('coinsValue').textContent = s.coins.toLocaleString();
      document.getElementById('pointsValue').textContent = s.eastPoints.toLocaleString();
      document.getElementById('levelValue').textContent = s.level;

      // Title (e.g. 新手 / 学徒 / 农神 / 萨城传说)
      const titleEl = document.getElementById('titleLabel');
      if (titleEl) {
        const t = Farm.state.levelTitle ? Farm.state.levelTitle(s.level) : null;
        titleEl.textContent = t ? (lang === 'en' ? t.en : t.zh) : '';
      }

      // XP bar — formula handles any level (level system is open-ended)
      const curT = Farm.state.xpForLevel ? Farm.state.xpForLevel(s.level) : 0;
      const nextT = Farm.state.xpForLevel ? Farm.state.xpForLevel(s.level + 1) : (curT + 1);
      const span = Math.max(1, nextT - curT);
      const progress = Math.max(0, s.xp - curT);
      const pct = Math.min(100, progress / span * 100);
      document.getElementById('xpFill').style.width = pct + '%';
      const xpTextEl = document.getElementById('xpText');
      if (xpTextEl) {
        xpTextEl.textContent = progress.toLocaleString() + ' / ' + span.toLocaleString();
      }
    },

    showModal(html) {
      const modal = document.getElementById('modal');
      const content = document.getElementById('modalContent');
      content.innerHTML = html;
      modal.classList.remove('hidden');
      // Click backdrop to close
      modal.querySelector('.modal-backdrop').onclick = () => this.hideModal();
    },

    hideModal() {
      document.getElementById('modal').classList.add('hidden');
    },

    toast(text, duration) {
      duration = duration || 2500;
      const el = document.getElementById('toast');
      el.textContent = text;
      el.classList.remove('hidden');
      // Restart animation
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        el.classList.add('hidden');
      }, duration);
    },

    floatText(text, x, y, color) {
      const el = document.createElement('div');
      el.className = 'float-coin';
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      if (color) el.style.color = color;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    },

    setStorekeeperLine(text) {
      document.getElementById('storekeeperBubble').textContent = text;
    },

    setFestivalBanner(text) {
      const banner = document.getElementById('festivalBanner');
      if (!text) {
        banner.classList.add('hidden');
      } else {
        document.getElementById('festivalText').textContent = text;
        banner.classList.remove('hidden');
      }
    },

    setTaskBadge(count) {
      const badge = document.getElementById('taskBadge');
      badge.textContent = count > 0 ? count : '';
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.ui = ui;
})();
