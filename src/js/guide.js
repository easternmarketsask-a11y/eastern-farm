/**
 * guide.js — 「怎么玩」How-to-Play guide (Farm.guide)
 *
 * The one-time welcome tutorial (tutorial.js) sets expectations then vanishes;
 * the coach (coach.js) teaches single rules just-in-time. Neither is a place a
 * confused player can go to ask "wait, what can I actually DO here?".
 *
 * This is that place: a re-openable, scrollable, sectioned overview of the WHOLE
 * game — core loop, currencies, real rewards, daily stuff, neighbors, festivals,
 * leveling. Reachable any time from the header ❓ button and the 今日 panel.
 *
 *   Farm.guide.open()  → render the guide modal
 *
 * Content is inlined bilingual (same pattern as rewards.js / daily.js) rather
 * than i18n keys, because it's long-form copy that reads better edited in place.
 */
(function() {
  // Each section: { icon, zh:{title,body}, en:{title,body} }.
  // Keep bodies to 1-2 short sentences — this is a friendly overview, not a manual.
  const SECTIONS = [
    {
      icon: '🌱',
      zh: { title: '三步上手', body: '点空地<b>种</b>菜 → 菜熟了点一下<b>收</b>进仓库 → 把仓库的菜<b>卖</b>给东方超市换农场币。就这么简单。' },
      en: { title: 'Start in 3 steps', body: 'Tap soil to <b>plant</b> → tap ripe crops to <b>harvest</b> → <b>sell</b> from your barn for coins. That\'s the whole loop.' },
    },
    {
      icon: '💧',
      zh: { title: '让菜长更快', body: '点正在生长的作物可以<b>浇水</b>加速；有化肥时还能<b>施肥</b>一次顶很久。不管它也不会枯——这是个轻松的农场，没有压力。' },
      en: { title: 'Speed things up', body: 'Tap a growing crop to <b>water</b> it (faster) or <b>fertilize</b> (big boost). Crops never wilt if you forget — this farm is cozy, no pressure.' },
    },
    {
      icon: '🪙',
      zh: { title: '两种货币', body: '<b>农场币</b>天天用：买种子、扩建农场、买装饰。<b>超市积分</b>很珍贵，是能换真东西的。' },
      en: { title: 'Two currencies', body: '<b>Coins</b> are for everyday play — seeds, expansions, décor. <b>Store Points</b> are rare and worth real things.' },
    },
    {
      icon: '🎫',
      zh: { title: '积分换真优惠', body: '攒够<b>超市积分</b>，在积分页换成优惠券码，截图带到东方超市，到店就能用。玩游戏，真省钱。' },
      en: { title: 'Real store rewards', body: 'Save up <b>Store Points</b>, redeem a coupon code, and use it at Eastern Market in store. Play the game, save for real.' },
    },
    {
      icon: '📅',
      zh: { title: '每天来领奖', body: '每日<b>签到</b>（连签 7 天有大奖）、每日<b>任务</b>、每日<b>大转盘</b>——花 5 分钟就有得领。' },
      en: { title: 'Come back daily', body: 'Daily <b>sign-in</b> (7-day streak = big prize), daily <b>tasks</b>, and a daily <b>lottery wheel</b>. Five minutes a day pays off.' },
    },
    {
      icon: '🏘',
      zh: { title: '串门 & 顺菜', body: '走访邻居能赚币，帮邻居浇水、点赞也有奖。农场到 <b>Lv7</b> 解锁「顺菜」，可以去邻居成熟的地里顺一把 😏' },
      en: { title: 'Neighbors & mischief', body: 'Visit neighbors for coins; help and like them for more. Reach <b>Lv7</b> to unlock "borrowing" a crop from a neighbor\'s ripe plot 😏' },
    },
    {
      icon: '🏮',
      zh: { title: '节日有活动', body: '春节、中秋等真实节日都有专属玩法和奖励，跟着节气一起种、一起过节。' },
      en: { title: 'Festival events', body: 'Spring Festival, Mid-Autumn and more bring special events and rewards — play along with the real calendar.' },
    },
    {
      icon: '🏆',
      zh: { title: '升级解锁更多', body: '收获、卖菜、做任务都涨经验。升级会解锁新的菜、新地块和新玩法，越玩越丰富。' },
      en: { title: 'Level up', body: 'Harvesting, selling and tasks all give XP. Leveling up unlocks new crops, plots and features — the farm grows with you.' },
    },
  ];

  const guide = {
    open() {
      const lang = Farm.state.data.language === 'en' ? 'en' : 'zh';
      const EN = lang === 'en';

      const cards = SECTIONS.map((s, i) => {
        const c = s[lang];
        return `
          <div class="guide-card">
            <div class="guide-card-icon">${s.icon}</div>
            <div class="guide-card-text">
              <div class="guide-card-title"><span class="guide-card-step">${i + 1}</span>${c.title}</div>
              <div class="guide-card-body">${c.body}</div>
            </div>
          </div>`;
      }).join('');

      const html = `
        <div class="guide-modal">
          <h2 class="modal-title">${EN ? 'How to Play' : '怎么玩'}</h2>
          <p class="modal-subtitle" style="margin-top:0;">${EN
            ? 'Everything you can do on the farm — at a glance.'
            : '在农场里能做的事，一页看明白。'}</p>
          <div class="guide-list">${cards}</div>
          ${this._settingsHtml(EN)}
          <div class="btn-row" style="margin-top:14px;">
            <button class="btn" id="guideStartBtn" style="flex:1;font-size:15px;padding:14px;">
              🌱 ${EN ? "Let's farm!" : '开始种菜'}
            </button>
          </div>
        </div>
      `;
      Farm.ui.showModal(html);
      this._wireSettings();

      const btn = document.getElementById('guideStartBtn');
      if (btn) btn.onclick = () => {
        Farm.ui.hideModal();
        if (Farm.audio) Farm.audio.play('tap');
      };
    },

    // 指南底部的小设置区。
    // 2026-08-11：原来这里还有「🎨 农场画风」三选一（Hay Day 等距 / 俯视像素 /
    // 经典竖排），切换会 location.reload() 换渲染器。三套渲染器已收编成 iso 一套
    // （见 state.farmStyle()），切换器随之移除，只留走动小动物开关。
    _settingsHtml(EN) {
      const petsOn = !!(Farm.state && Farm.state.data && Farm.state.data.petsEnabled);
      return '<div style="margin-top:14px;"><div style="font:600 13px/1 system-ui,sans-serif;color:#555;margin-bottom:7px;">🐾 ' +
        (EN ? 'Walking pets' : '走动小动物') + '</div><button id="guidePetsToggle" style="padding:9px 16px;border-radius:12px;cursor:pointer;font:600 12px/1.2 system-ui,sans-serif;border:2px solid ' +
        (petsOn ? '#FF9800' : '#e0e0e0') + ';background:' + (petsOn ? '#FFF3E0' : '#fff') + ';color:' + (petsOn ? '#E8522A' : '#666') + ';">' +
        (petsOn ? (EN ? '✓ On' : '✓ 开启') : (EN ? 'Off' : '已关闭')) + '</button></div>';
    },
    _wireSettings() {
      const pt = document.getElementById('guidePetsToggle');
      if (pt) pt.onclick = () => {
        Farm.state.data.petsEnabled = !Farm.state.data.petsEnabled; Farm.state.save();
        if (Farm.audio) Farm.audio.play('tap');
        const on = Farm.state.data.petsEnabled, EN = Farm.state.data.language === 'en';
        pt.textContent = on ? (EN ? '✓ On' : '✓ 开启') : (EN ? 'Off' : '已关闭');
        pt.style.border = '2px solid ' + (on ? '#FF9800' : '#e0e0e0'); pt.style.background = on ? '#FFF3E0' : '#fff'; pt.style.color = on ? '#E8522A' : '#666';
        if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
      };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.guide = guide;
})();
