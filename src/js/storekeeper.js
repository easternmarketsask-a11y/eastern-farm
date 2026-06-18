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
            zh: [
              '新年快乐！种一盆年橘讨吉利吧。',
              '春节限定作物上架：水仙、年橘、水仙——只在这周能种。',
              '东方超市春节年货已经备齐：年糕、汤圆、对联、糖果都有。',
              '腊月二十三小年到，记得吃饺子。',
              '春节期间收获作物送积分翻倍——多种几棵年橘讨彩头。',
              '来店里逛年货：133-412 Willowgrove Square。',
            ],
            en: [
              "Happy Lunar New Year! Plant a kumquat for fortune.",
              "Festival-only crops are unlocked this week: narcissus + kumquat.",
              "Eastern Market is stocked for New Year — rice cakes, tangyuan, couplets, candies.",
              "Plant kumquats — they're the festival good-luck crop.",
              "Bonus EP this week for festival harvests!",
              "Come visit the store: 133-412 Willowgrove Square.",
            ],
          },
          mid_autumn: {
            zh: [
              '中秋节快乐！今晚月亮特别圆。',
              '中秋限定作物：芋头、柚子、桂花——这周才能种。',
              '东方超市月饼到货——双黄莲蓉、抹茶豆沙、五仁、冰皮多种口味。',
              '芋头 + 柚子 + 桂花，一盘中秋的家。',
              '中秋这周送积分翻倍，记得多种节日作物。',
              '萨城晚上看月亮：南萨斯卡通河岸最美。',
            ],
            en: [
              "Happy Mid-Autumn! The moon is full tonight.",
              "Festival-only crops this week: taro, pomelo, osmanthus.",
              "Mooncakes are in at Eastern Market — lotus, matcha, mixed nut, snow-skin.",
              "Taro + pomelo + osmanthus — a plate of home.",
              "Bonus EP all week for festival harvests!",
              "Best moon-viewing in Saskatoon: along the South Sask River.",
            ],
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

  // Tap 小东 → open his order board (he IS the Eastern Market buyer, so this
  // is the most thematic entry point). The greeting line still rotates on its
  // own via refresh() calls elsewhere.
  document.addEventListener('DOMContentLoaded', () => {
    const npc = document.getElementById('storekeeper');
    if (npc) {
      npc.style.cursor = 'pointer';
      npc.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        if (Farm.orders) Farm.orders.open();
        else storekeeper.refresh();
      };
    }
  });
})();
