/**
 * storekeeper.js — The Eastern Market shopkeeper NPC.
 * Rotates greetings, occasionally contextual.
 */
(function() {
  const storekeeper = {
    refresh() {
      // Decide what to say
      const data = Farm.state.data;
      const lang = data.language;

      let lines = [];

      // Festival mode lines
      if (Farm.events && Farm.events.activeFestival) {
        // V1: a couple of canned festival lines per festival.
        // P1 task 1.4 should pull from data/events.json _storekeeper_greetings_*
        const fest = Farm.events.activeFestival.id;
        const festLines = {
          spring_festival: {
            zh: ['新年快乐！种一盆年橘讨吉利吧。', '春节到，东方超市的年货已经备好。', '腊月二十三小年到，记得吃饺子。'],
            en: ["Happy Lunar New Year! Plant a kumquat for fortune.", "Spring Festival shelves are stocked at Eastern Market.", "Don't forget the dumplings!"]
          },
          mid_autumn: {
            zh: ['中秋节快乐！今晚月亮特别圆。', '芋头 + 柚子 + 桂花，一盘中秋的家。', '东方超市月饼到货——双黄莲蓉、抹茶豆沙。'],
            en: ["Happy Mid-Autumn! The moon is full tonight.", "Taro + pomelo + osmanthus — a plate of home.", "Mooncakes are in at Eastern Market!"]
          },
        };
        const pool = festLines[fest];
        if (pool) lines = pool[lang] || pool.zh;
      }

      // Default pool from i18n
      if (lines.length === 0) {
        lines = lang === 'en' ? Farm.i18n.storekeeper_pool_en : Farm.i18n.storekeeper_pool_zh;
      }

      // Context: new player
      if (data.coins === 100 && Object.values(data.sessionStats.harvested).reduce((s,n)=>s+n,0) === 0) {
        const newPlayerLine = lang === 'en'
          ? "Tap a brown plot to plant your first seed."
          : "点击棕色的地块种下第一粒种子。";
        Farm.ui.setStorekeeperLine(newPlayerLine);
        return;
      }

      if (lines.length === 0) {
        Farm.ui.setStorekeeperLine(lang === 'en' ? 'Hello!' : '你好!');
        return;
      }

      const line = lines[Math.floor(Math.random() * lines.length)];
      Farm.ui.setStorekeeperLine(line);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.storekeeper = storekeeper;

  // Click to refresh
  document.addEventListener('DOMContentLoaded', () => {
    const npc = document.getElementById('storekeeper');
    if (npc) {
      npc.style.cursor = 'pointer';
      npc.onclick = () => storekeeper.refresh();
    }
  });
})();
