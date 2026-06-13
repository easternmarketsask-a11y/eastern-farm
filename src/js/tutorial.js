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
              ? 'Tap <b>❓ 玩法</b> at the top any time for the full guide.'
              : '想再看玩法？随时点顶部的 <b>❓ 玩法</b>。'}
          </div>
        </div>
      `;
      Farm.ui.showModal(html);
      const btn = document.getElementById('tutorialStartBtn');
      if (btn) {
        btn.onclick = () => {
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
      }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.tutorial = tutorial;
})();
