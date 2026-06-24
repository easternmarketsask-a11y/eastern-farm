/**
 * events.js — Festival event detection.
 *
 * V1 simplified: checks current date against hardcoded windows.
 * P1 task 1.4 may want to load from data/events.json instead.
 */
(function() {
  // Hardcoded festival windows for V1. Replace with data/events.json later.
  const FESTIVALS = {
    spring_festival: {
      name_zh: '春节',
      name_en: 'Spring Festival',
      windows: [
        { start: '2026-02-03', end: '2026-02-23' },
        { start: '2027-01-23', end: '2027-02-12' },
        // Chinese New Year 2028 is Jan 26 (Year of the Monkey) — the old
        // 02-11→03-02 window was ~2 weeks too late and missed the festival
        // entirely. Window follows the others: 14 days before → 6 days after.
        { start: '2028-01-12', end: '2028-02-01' },
        { start: '2029-01-30', end: '2029-02-19' },   // CNY 2029-02-13 (Rooster)
        { start: '2030-01-20', end: '2030-02-09' },   // CNY 2030-02-03 (Dog)
      ],
      decorations: '🏮',
    },
    mid_autumn: {
      name_zh: '中秋节',
      name_en: 'Mid-Autumn Festival',
      windows: [
        { start: '2026-09-19', end: '2026-09-29' },
        { start: '2027-09-08', end: '2027-09-18' },
        { start: '2028-09-27', end: '2028-10-07' },
        { start: '2029-09-16', end: '2029-09-26' },   // Mid-Autumn 2029-09-22
        { start: '2030-09-06', end: '2030-09-16' },   // Mid-Autumn 2030-09-12
      ],
      decorations: '🌕',
    },
  };

  const events = {
    activeFestival: null,

    check() {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      this.activeFestival = null;
      for (const [id, def] of Object.entries(FESTIVALS)) {
        for (const w of def.windows) {
          if (todayStr >= w.start && todayStr <= w.end) {
            this.activeFestival = { id, ...def };
            break;
          }
        }
        if (this.activeFestival) break;
      }
      this.updateBanner();
    },

    getActiveFestivalId() {
      return this.activeFestival ? this.activeFestival.id : null;
    },

    updateBanner() {
      if (this.activeFestival) {
        const lang = Farm.state.data.language;
        const name = this.activeFestival[lang === 'en' ? 'name_en' : 'name_zh'];
        const text = Farm.i18n.t('festival_active_banner', { festival: this.activeFestival.decorations + ' ' + name });
        Farm.ui.setFestivalBanner(text);
      } else {
        Farm.ui.setFestivalBanner('');
      }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.events = events;
})();
