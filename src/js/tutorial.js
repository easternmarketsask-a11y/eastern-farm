/**
 * tutorial.js — Welcome overlay for true first-time players.
 *
 * Shows ONCE, immediately after the splash dismisses, when:
 *   - state.tutorialV1Done === false
 *   - cropsEverGrown is empty (secondary guard, e.g. for old saves that
 *     pre-date the tutorialV1Done flag)
 *
 * Design: single concise 3-step panel, not a multi-step coach. Multi-step
 * coaches are easy to abandon mid-way and feel like an obstacle. One short
 * panel sets expectations + lets the player start playing immediately.
 */
(function() {
  const tutorial = {
    maybeShow() {
      const data = Farm.state.data;
      if (!data) return;
      if (data.tutorialV1Done) return;
      if ((data.cropsEverGrown || []).length > 0) {
        // Already played before this flag existed — mark done silently
        data.tutorialV1Done = true;
        Farm.state.save();
        return;
      }
      this._render();
    },

    _render() {
      const lang = Farm.state.data.language || 'zh';
      const t = (k) => Farm.i18n.t(k);
      const html = `
        <div class="tutorial-modal">
          <h2 class="modal-title" style="margin-bottom:4px;">${t('tutorial_title')}</h2>
          <p class="modal-subtitle" style="margin-top:0;">${t('tutorial_subtitle')}</p>
          <div class="tutorial-steps">
            <div class="tutorial-step">
              <div class="tutorial-step-icon">🌱</div>
              <div class="tutorial-step-text">
                <div class="tutorial-step-title">${t('tutorial_step1_title')}</div>
                <div class="tutorial-step-body">${t('tutorial_step1_body')}</div>
              </div>
            </div>
            <div class="tutorial-step">
              <div class="tutorial-step-icon">⏳</div>
              <div class="tutorial-step-text">
                <div class="tutorial-step-title">${t('tutorial_step2_title')}</div>
                <div class="tutorial-step-body">${t('tutorial_step2_body')}</div>
              </div>
            </div>
            <div class="tutorial-step">
              <div class="tutorial-step-icon">🏪</div>
              <div class="tutorial-step-text">
                <div class="tutorial-step-title">${t('tutorial_step3_title')}</div>
                <div class="tutorial-step-body">${t('tutorial_step3_body')}</div>
              </div>
            </div>
          </div>
          <div class="btn-row" style="margin-top:18px;">
            <button class="btn" id="tutorialStartBtn" style="flex:1;font-size:15px;padding:14px;">
              ${t('tutorial_btn_start')}
            </button>
          </div>
          <div class="tutorial-help-hint" style="text-align:center;margin-top:10px;font-size:12px;color:var(--warm-text-soft);">
            ${lang === 'en'
              ? 'Full guide any time: <b>☰ menu → ❓ How to</b>.'
              : '想再看玩法？点右上角 <b>☰ 菜单 → ❓ 怎么玩</b>。'}
          </div>
        </div>
      `;
      Farm.ui.showModal(html);
      // 统一收尾：主按钮 / ✕ / 点背板关闭都走同一条路（audit P2 tutorial.js:73
      // 2026-07-07）。以前只有主按钮置 tutorialV1Done + 起 spotlight——点 ✕ 的
      // 玩家下次又弹同一欢迎窗、本会话 spotlight 丢失、期间种过菜还会被静默标记
      // 「引导已完成」。关闭 ≠ 没看过：任何关闭方式都视为确认。
      const finishTutorial = () => {
        Farm.state.data.tutorialV1Done = true;
        Farm.state.save();
        Farm.ui.hideModal();
        if (Farm.audio) Farm.audio.play('plant');
        // Hand off to the spotlight: walk them through the first
        // plant → harvest → sell once the welcome panel is gone.
        if (Farm.spotlight && Farm.spotlight.maybeStart) {
          setTimeout(() => Farm.spotlight.maybeStart(), 500);
        }
      };
      const btn = document.getElementById('tutorialStartBtn');
      if (btn) btn.onclick = finishTutorial;
      const modal = document.getElementById('modal');
      const xBtn = modal && modal.querySelector('.modal-close-x');
      if (xBtn) xBtn.onclick = finishTutorial;
      const backdrop = modal && modal.querySelector('.modal-backdrop');
      if (backdrop) backdrop.onclick = finishTutorial;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.tutorial = tutorial;
})();
