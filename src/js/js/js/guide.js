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
      zh: { title: '三步上手', body: '点空地<b>种</b>菜 → 菜熟了点一下<b>收</b>进谷仓 → 把谷仓的菜<b>卖</b>给东方超市换农场币。就这么简单。' },
      en: { title: 'Start in 3 steps', body: 'Tap soil to <b>plant</b> → tap ripe crops to <b>harvest</b> → <b>sell</b> from your barn for coins. That\'s the whole loop.' },
    },
    {
      icon: '💧',
      zh: { title: '让菜长更快', body: '点正在生长的作物可以<b>浇水</b>加速；有化肥时还能<b>施肥</b>一次顶很久。不管它也不会枯——这是个轻松的农场，没有压力。' },
      en: { title: 'Speed things up', body: 'Tap a growing crop to <b>water</b> it (faster) or <b>fertilize</b> (big boost). Crops never wilt if you forget — this farm is cozy, no pressure.' },
    },
    {
      icon: '💰',
      zh: { title: '卖得更贵的三条路', body: '直接卖谷仓最省事，但<b>小东订单</b>（点左下角小东）、<b>小东厨房</b>（把菜做成菜）、<b>菜摊</b>（路人溢价来买）都比散卖赚得多。' },
      en: { title: 'Three ways to earn more', body: 'Bulk-selling from the barn is easiest, but <b>Xiaodong\'s orders</b> (tap him bottom-left), the <b>Kitchen</b> (cook dishes) and the <b>veggie stand</b> (passers-by pay extra) all pay better.' },
    },
    {
      icon: '🏡',
      zh: { title: '建造你的家', body: '点右下角<b>建造</b>：摆建筑、挖水塘、放装饰，都能拖动。<b>我的家</b>可以一级级升上去，院子的<b>魅力</b>越高，邻居来了越有面子。' },
      en: { title: 'Build your home', body: 'Tap <b>Build</b> (bottom-right): place buildings, dig a pond, add décor — everything drags. Upgrade <b>My Home</b> level by level; higher <b>charm</b> makes your yard the pride of the road.' },
    },
    {
      icon: '📬',
      zh: { title: '农场人生', body: '升级会收到小东的来信，每一章有几个小目标，完成领农场币。<b>农场日记</b>会自动记下你的大事记——第一次收获、家升级、菜摊第 50 位客人。' },
      en: { title: 'Your farm story', body: 'Leveling up brings letters from Xiaodong; each chapter has a few goals worth coins. The <b>Farm Diary</b> quietly records your milestones — first harvest, home upgrades, customer #50 at the stand.' },
    },
    {
      icon: '🪙',
      zh: { title: '两种货币', body: '<b>农场币</b>天天用：买种子、扩建农场、买装饰。<b>超市积分</b>很珍贵，是能换真东西的。' },
      en: { title: 'Two currencies', body: '<b>Coins</b> are for everyday play — seeds, expansions, décor. <b>Store Points</b> are rare and worth real things.' },
    },
    {
      icon: '🎫',
      // 2026-08-15：优惠券码那套 V1.1 就下线了（rewards.js 不再渲染券档），
      // 这里却还在教玩家「换成券码、截图带到店里」——教的是一个已经不存在的流程。
      zh: { title: '积分是真的', body: '游戏里赚的<b>超市积分</b>就是你会员卡上的积分，每天凌晨自动进账户，到店买菜直接用。玩游戏，真省钱。' },
      en: { title: 'The points are real', body: 'The <b>Store Points</b> you earn here are your Eastern Market member points — they sync to your account daily and you spend them in store. Play the game, save for real.' },
    },
    {
      icon: '📅',
      zh: { title: '每天来领奖', body: '每日<b>签到</b>（连签 7 天有大奖）、每日<b>任务</b>、每日<b>大转盘</b>——花 5 分钟就有得领。' },
      en: { title: 'Come back daily', body: 'Daily <b>sign-in</b> (7-day streak = big prize), daily <b>tasks</b>, and a daily <b>lottery wheel</b>. Five minutes a day pays off.' },
    },
    {
      icon: '🚗',
      zh: { title: '停自己的车', body: '点底部<b>商店</b>，打开<b>汽车</b>分类。农用、家用、越野、豪华都能买。点停好的车可以换款，只补差价。' },
      en: { title: 'Park a car', body: 'Open <b>Shop</b> at the bottom, then the <b>Cars</b> tab. Utility, family, off-road and luxury are for sale. Tap a parked car to change it — you pay only the difference.' },
    },
    {
      icon: '🏘',
      zh: { title: '串门看邻居', body: '右下角<b>邻居</b>列出今天在线的人。走进去浇水或点赞；自己收过一次菜之后，可以在熟了的地里顺一棵。邀请好友，双方各得 200 农场币。' },
      en: { title: 'Visit neighbors', body: 'Tap <b>Neighbors</b> (bottom-right) to see who is online today. Walk in to water or like. After you harvest once, you can take a ripe crop. Invite a friend — 200 coins each.' },
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
          <div class="btn-row" style="margin-top:14px;">
            <button class="btn" id="guideStartBtn" style="flex:1;font-size:15px;padding:14px;">
              🌱 ${EN ? "Let's farm!" : '开始种菜'}
            </button>
          </div>
        </div>
      `;
      Farm.ui.showModal(html);

      const btn = document.getElementById('guideStartBtn');
      if (btn) btn.onclick = () => {
        Farm.ui.hideModal();
        if (Farm.audio) Farm.audio.play('tap');
      };
    },

    // （2026-08-15：原来这里挂着「🐾 走动小动物」开关 —— 设置项放进「怎么玩」
    //   不合适，且与设置页的显示开关重复。已统一搬到「设置 → 农场显示」。）
  };

  window.Farm = window.Farm || {};
  window.Farm.guide = guide;
})();
