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

      // Next plot hint — gives a long-term "next milestone" cue in the status bar
      const nextPlotEl = document.getElementById('nextPlotHint');
      if (nextPlotEl && Farm.state.nextPlotUnlockAt) {
        const nextLv = Farm.state.nextPlotUnlockAt(s.level);
        if (nextLv != null) {
          nextPlotEl.textContent = (lang === 'en' ? '🏞 Lv ' : '🏞 Lv ') + nextLv;
          nextPlotEl.style.display = '';
        } else {
          // Already at max plot tier
          nextPlotEl.textContent = lang === 'en' ? '🏆 MAX' : '🏆 已满';
          nextPlotEl.style.display = '';
        }
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
      // Support inline HTML (for the styled coin-icon span). Callers pass
      // author-controlled strings only — no XSS risk in this code base.
      el.innerHTML = text;
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
      // Support inline HTML so the floating "+5 [coin]" can use the styled
      // coin-icon span instead of the inconsistent 🪙 emoji.
      el.innerHTML = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      if (color) el.style.color = color;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    },

    setStorekeeperLine(text) {
      const bubble = document.getElementById('storekeeperBubble');
      if (!bubble) return;
      // Polish: re-trigger the storekeeperPop CSS animation by toggling
      // the .refresh class off → reflow → on. Without the reflow the
      // browser coalesces the class change and skips the restart.
      bubble.textContent = text;
      bubble.classList.remove('refresh');
      void bubble.offsetWidth;
      bubble.classList.add('refresh');
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

    // Big celebratory modal shown when the player levels up. Shows the level
    // jump, any new title, what got unlocked (plots / EP bonus), and previews
    // the next milestone so the player can see "still room to grow".
    showLevelUpModal(oldLevel, newLevel, opts) {
      opts = opts || {};
      const lang = Farm.state.data.language || 'zh';
      const epAwarded = opts.epAwarded || 0;

      const oldTitle = Farm.state.levelTitle(oldLevel);
      const newTitle = Farm.state.levelTitle(newLevel);
      const titleChanged = newTitle.min !== oldTitle.min;

      // Count plots unlocked between oldLevel+1 and newLevel
      let plotsUnlocked = 0;
      for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
        plotsUnlocked += (Farm.state.PLOT_UNLOCK_AT && Farm.state.PLOT_UNLOCK_AT[lv]) || 0;
      }

      // Next milestones
      const nextTitle = Farm.state.nextTitleAt(newLevel);
      const nextPlotLv = Farm.state.nextPlotUnlockAt(newLevel);
      const nextLevelXp = Farm.state.xpForLevel(newLevel + 1);
      const curLevelXp = Farm.state.xpForLevel(newLevel);
      const curXp = Farm.state.data.xp || 0;
      const intoNext = Math.max(0, curXp - curLevelXp);
      const span = Math.max(1, nextLevelXp - curLevelXp);
      const pct = Math.min(100, intoNext / span * 100);

      // Build "unlocked" list
      const unlockedItems = [];
      if (plotsUnlocked > 0) {
        unlockedItems.push((lang === 'en'
          ? '🏞 +' + plotsUnlocked + ' new plot' + (plotsUnlocked > 1 ? 's' : '')
          : '🏞 新解锁 ' + plotsUnlocked + ' 块地'));
      }
      if (epAwarded > 0) {
        unlockedItems.push('🎫 +' + epAwarded + (lang === 'en' ? ' EP' : ' 东方积分'));
      }
      // Always include a coin bonus mention to make level-up feel rewarding
      unlockedItems.push('<span class="coin-icon"></span> +' + (50 * (newLevel - oldLevel)) + (lang === 'en' ? ' coins' : ' 农场币'));

      const titleZhEn = (t) => lang === 'en' ? t.en : t.zh;

      const titleChipHTML = titleChanged
        ? '<div class="lvup-title-change">' +
            '<span class="lvup-title-old">' + titleZhEn(oldTitle) + '</span>' +
            ' → ' +
            '<span class="lvup-title-new">' + titleZhEn(newTitle) + '</span>' +
          '</div>'
        : '<div class="lvup-title-stay">' + titleZhEn(newTitle) + '</div>';

      const nextHTML = nextTitle || nextPlotLv ? (
        '<div class="lvup-next">' +
          '<div class="lvup-next-label">' + (lang === 'en' ? 'Next milestone' : '下个里程碑') + '</div>' +
          (nextTitle ? (
            '<div class="lvup-next-row">' +
              '<span>🏷 ' + (lang === 'en' ? 'Title' : '称号') + '</span>' +
              '<span>「' + titleZhEn(nextTitle) + '」 ' + (lang === 'en' ? 'at Lv ' : '在 Lv ') + nextTitle.min + '</span>' +
            '</div>'
          ) : '') +
          (nextPlotLv ? (
            '<div class="lvup-next-row">' +
              '<span>🏞 ' + (lang === 'en' ? 'New plot' : '新地块') + '</span>' +
              '<span>Lv ' + nextPlotLv + '</span>' +
            '</div>'
          ) : '') +
          '<div class="lvup-next-bar"><div class="lvup-next-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="lvup-next-xp">' + intoNext.toLocaleString() + ' / ' + span.toLocaleString() +
            ' XP → Lv ' + (newLevel + 1) +
          '</div>' +
        '</div>'
      ) : (
        '<div class="lvup-next lvup-next-max">' +
          '🏆 ' + (lang === 'en' ? 'You\'ve reached the farthest title!' : '已抵达最高称号！') +
        '</div>'
      );

      const html = `
        <div class="lvup-modal">
          <div class="lvup-confetti">🎉</div>
          <div class="lvup-label">${lang === 'en' ? 'Level Up!' : '升级了！'}</div>
          <div class="lvup-jump">
            <span class="lvup-old">Lv ${oldLevel}</span>
            <span class="lvup-arrow">▶</span>
            <span class="lvup-new">Lv ${newLevel}</span>
          </div>
          ${titleChipHTML}
          <div class="lvup-unlocked">
            ${unlockedItems.map(t => '<div class="lvup-unlocked-row">' + t + '</div>').join('')}
          </div>
          ${nextHTML}
          <div class="btn-row">
            <button class="btn" id="lvupOkBtn">${lang === 'en' ? 'Keep growing' : '继续耕耘'}</button>
          </div>
        </div>
      `;
      this.showModal(html);
      document.getElementById('lvupOkBtn').onclick = () => this.hideModal();
      if (Farm.audio) Farm.audio.play('levelUp');
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.ui = ui;
})();
