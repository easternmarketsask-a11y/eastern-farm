/**
 * achievements.js — Lifetime achievements engine.
 *
 * Loads data/achievements.json. After any relevant state change, callers
 * invoke Farm.achievements.checkAll() — this scans every catalog entry,
 * unlocks the ones whose `check` now passes, credits East Points, and
 * shows a 🏆 toast (one per unlock, staggered).
 *
 * Supported check types (extend this switch to add more):
 *   { type: 'stat',   key: <state field>, min: <number> }
 *   { type: 'level',  min: <number> }
 *   { type: 'crops_set',          ids: [<cropId>, ...] }   — all must be in cropsEverGrown
 *   { type: 'festival_harvests',  festival: <id>, min: N } — uses state.festivalHarvests[id]
 *
 * Achievements live forever in state.completedAchievements. Resetting the
 * game clears them (via state.reset()). They are NOT retroactive — if you
 * add a new achievement and ship it, players whose stats already qualify
 * will unlock it on their next checkAll() call (we run checkAll() on boot).
 */
(function() {
  const achievements = {
    catalog: [],
    loaded: false,

    async load() {
      try {
        const res = await fetch('../data/achievements.json');
        const data = await res.json();
        this.catalog = data.achievements || [];
        this.loaded = true;
      } catch (e) {
        console.error('achievements load failed', e);
        this.catalog = [];
        this.loaded = true;
      }
    },

    isUnlocked(id) {
      const list = (Farm.state.data && Farm.state.data.completedAchievements) || [];
      return list.includes(id);
    },

    evaluate(ach) {
      const data = Farm.state.data;
      const c = ach.check || {};
      switch (c.type) {
        case 'stat':
          return (data[c.key] || 0) >= (c.min || 1);
        case 'level':
          return (data.level || 1) >= (c.min || 1);
        case 'crops_set':
          return (c.ids || []).every(id => (data.cropsEverGrown || []).includes(id));
        case 'festival_harvests':
          return ((data.festivalHarvests || {})[c.festival] || 0) >= (c.min || 1);
        default:
          return false;
      }
    },

    // Returns { current, target } for the progress bar, or null if not progressable.
    progress(ach) {
      const data = Farm.state.data;
      const c = ach.check || {};
      switch (c.type) {
        case 'stat': {
          const v = data[c.key] || 0;
          return { current: Math.min(v, c.min), target: c.min };
        }
        case 'level':
          return { current: Math.min(data.level || 1, c.min), target: c.min };
        case 'crops_set': {
          const ids = c.ids || [];
          const have = ids.filter(id => (data.cropsEverGrown || []).includes(id)).length;
          return { current: have, target: ids.length };
        }
        case 'festival_harvests': {
          const v = ((data.festivalHarvests || {})[c.festival]) || 0;
          return { current: Math.min(v, c.min), target: c.min };
        }
        default:
          return null;
      }
    },

    checkAll() {
      if (!this.loaded || this.catalog.length === 0) return;
      const data = Farm.state.data;
      if (!data) return;
      data.completedAchievements = data.completedAchievements || [];
      const newlyUnlocked = [];
      this.catalog.forEach(ach => {
        if (data.completedAchievements.includes(ach.id)) return;
        if (this.evaluate(ach)) {
          data.completedAchievements.push(ach.id);
          if (ach.reward_points) {
            Farm.state.addEastPoints(ach.reward_points, {
              source: 'achievement:' + ach.id,
              description: 'Achievement unlock: ' + (ach.name_zh || ach.name_en || ach.id),
            });
          }
          newlyUnlocked.push(ach);
        }
      });
      if (newlyUnlocked.length > 0) {
        Farm.state.save();
        if (Farm.ui) Farm.ui.refreshHUD();
        this._showUnlockToasts(newlyUnlocked);
      }
    },

    _showUnlockToasts(list) {
      const lang = Farm.state.data.language;
      list.forEach((ach, i) => {
        const name = lang === 'en' ? ach.name_en : ach.name_zh;
        setTimeout(() => {
          Farm.ui.toast('🏆 ' + name + '  +' + (ach.reward_points || 0) + '<span class="points-icon"></span>', 3200);
          if (Farm.audio) Farm.audio.play('achievement');
          // Completion high-light: a light confetti burst makes unlocking an
          // achievement feel like a milestone, not just another toast.
          if (Farm.ui.showConfetti) Farm.ui.showConfetti(24, 1800);
        }, 250 + i * 900);
      });
    },

    // ============ View helpers (called from main.js openCollection) ============

    renderListHTML() {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const descKey = lang === 'en' ? 'desc_en' : 'desc_zh';
      const lockedLabel = lang === 'en' ? 'Locked' : '未解锁';

      if (this.catalog.length === 0) {
        return '<p style="text-align:center;color:var(--warm-text-soft);padding:24px;">' +
          (lang === 'en' ? 'No achievements yet.' : '暂无成就') + '</p>';
      }

      return '<div class="ach-list">' + this.catalog.map(ach => {
        const unlocked = this.isUnlocked(ach.id);
        const prog = this.progress(ach);
        const pct = prog && prog.target > 0 ? Math.min(100, prog.current / prog.target * 100) : 0;
        const name = ach[nameKey] || ach.name_zh;
        const desc = unlocked ? (ach[descKey] || ach.desc_zh) : lockedLabel;
        const progRow = prog && !unlocked ? `
          <div class="ach-bar"><div class="ach-fill" style="width:${pct}%"></div></div>
          <div class="ach-progress">${prog.current} / ${prog.target}</div>
        ` : '';
        return `
          <div class="ach-card ${unlocked ? 'unlocked' : 'locked'}">
            <div class="ach-icon">${unlocked ? ach.icon : '🔒'}</div>
            <div class="ach-body">
              <div class="ach-name">${name}</div>
              <div class="ach-desc">${desc}</div>
              ${progRow}
            </div>
            <div class="ach-reward">+${ach.reward_points || 0}<span class="points-icon"></span></div>
          </div>
        `;
      }).join('') + '</div>';
    },

    unlockedCount() {
      return (Farm.state.data.completedAchievements || []).length;
    },
    totalCount() {
      return this.catalog.length;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.achievements = achievements;
})();
