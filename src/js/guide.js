/**
 * guide.js — 「怎么玩」How-to-Play guide (Farm.guide)
 *
 * The one-time welcome tutorial (tutorial.js) sets expectations then vanishes;
 * the coach (coach.js) teaches single rules just-in-time. Neither is a place a
 * confused player can go to ask "wait, what can I actually DO here?".
 *
 * This is that place: a re-openable, scrollable overview of the WHOLE game.
 * Reachable any time from the header ❓ button and the 今日 panel.
 *
 *   Farm.guide.open()  → render the guide modal
 *
 * ── 2026-08-24 整体升级（Chris：「怎么玩需要整体升级优化」）───────────────
 * 改版前是 12 条平铺的 emoji 卡片，两个问题：
 *   ① **教的是已经不存在的玩法** —— 头两条都写着「把谷仓的菜卖给东方超市」，
 *      而大宗收购 2026-08-22 就随订单制一起删掉了（state.deliverWarehouse /
 *      warehouse.deliver() 都已移除）。新玩家照着做会找不到那个按钮。
 *   ② 12 条一样重，没有主次，找不到自己要的那条。
 * 现在：**五章分组** + 每条一个简笔画图标（与 promo/sketch-cards 同一套线条语言）。
 *
 * 🔒 内容红线（改这个文件前先对一遍）：
 *   - 卖菜只有订单制。**不许再出现「卖谷仓」「大宗收购」**。
 *   - 顺菜必须写「按半价留下菜钱」（2026-08-22 Chris 定），只写「顺一棵」是漏了。
 *   - 超市积分必须带「每天有上限」，不能说成无限。
 *   - 车能开（2026-08-20），别只写「能买」。
 *
 * 文案按 promo/README「写卡片文案的四条判据」来：一眼看懂 / 主语是你 /
 * 具体但不用行话 / 一条一个念头。
 *
 * Content is inlined bilingual (same pattern as rewards.js / daily.js) rather
 * than i18n keys, because it's long-form copy that reads better edited in place.
 */
(function() {
  /* 简笔画图标。32×32，线条语言与 promo/sketch-cards 一致：
     stroke-linecap/join 都是 round，只用描边不填色（浅绿块由 .g-wash 给）。
     ⚠️ 显示只有 ~40px，别加细节 —— 加了在手机上就是一团。 */
  const I = {
    sprout: '<path d="M16 28V13"/><path d="M16 18c-5-1-8-5-8-10 5 0 8 4 8 10z"/>'
          + '<path d="M17 15c5-2 8-6 7-11-5 1-8 6-7 11z"/><path d="M8 28h16"/>',
    can:    '<path d="M9 14h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3z"/>'
          + '<path d="M12 14v-3h6v3"/><path d="M23 18l5-3-1 8"/>'
          + '<path d="M5 9c1 2 0 3-1 5M9 6c1 2 0 3-1 5"/>',
    board:  '<path d="M8 28V16M24 28V16"/><rect x="5" y="7" width="22" height="11" rx="2"/>'
          + '<path d="M9 11h6M9 14h9"/><path d="M27 7V3l6 2-6 2"/>',
    wok:    '<path d="M5 15h20a10 10 0 0 1-10 10A10 10 0 0 1 5 15z"/><path d="M25 16l5-2"/>'
          + '<path d="M11 10c1-2 0-3-1-5M16 9c1-2 0-3-1-5M21 10c1-2 0-3-1-5"/>',
    stall:  '<path d="M5 13h22v3H5z"/><path d="M7 16v12h18V16"/><path d="M5 13l3-6h16l3 6"/>'
          + '<path d="M12 28v-6h8v6"/>',
    house:  '<path d="M6 28V14h20v14z"/><path d="M3 15L16 5l13 10"/><path d="M13 28v-7h6v7"/>'
          + '<path d="M22 9V6h3v5"/>',
    car:    '<path d="M4 22v-4l4-1 3-5h10l3 5 4 1v4"/><path d="M4 22h24"/>'
          + '<circle cx="10" cy="23" r="3"/><circle cx="22" cy="23" r="3"/><path d="M11 17h10"/>',
    yard:   '<path d="M4 28V19M11 28V19M18 28V19M25 28V19"/><path d="M2 21h25M2 25h25"/>'
          + '<circle cx="22" cy="10" r="6"/><path d="M22 19v-9"/>',
    cal:    '<rect x="4" y="7" width="24" height="21" rx="2"/><path d="M4 13h24"/>'
          + '<path d="M10 4v6M22 4v6"/><path d="M11 20l4 4 7-8"/>',
    nbr:    '<path d="M3 28V19h9v9z"/><path d="M1 20l6.5-5L14 20"/>'
          + '<path d="M20 28V19h9v9z"/><path d="M18 20l6.5-5L31 20"/><path d="M16 28V13"/>',
    card:   '<rect x="3" y="9" width="26" height="16" rx="2"/><path d="M3 14h26"/>'
          + '<circle cx="23" cy="20" r="2.5"/><path d="M8 20h6"/>',
    coin:   '<circle cx="12" cy="17" r="9"/><circle cx="12" cy="17" r="4.5"/>'
          + '<path d="M22 9a9 9 0 0 1 0 16"/>',
    lantern:'<path d="M16 2v4"/><path d="M12 6h8"/><ellipse cx="16" cy="16" rx="11" ry="9.5"/>'
          + '<path d="M12 26h8"/><path d="M16 26v4"/>',
    star:   '<path d="M16 4l3.5 8.5L28 14l-6 6 1.5 9L16 24.5 8.5 29 10 20l-6-6 8.5-1.5z"/>',
  };

  const svg = (d) => '<svg class="g-ico" viewBox="0 0 32 32" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

  // 五章。每章 { zh, en, items: [{ icon, zh:{title,body}, en:{title,body} }] }
  const CHAPTERS = [
    {
      zh: '先玩起来', en: 'Get going',
      items: [
        {
          icon: 'sprout',
          zh: { title: '种 · 收 · 交货', body: '点空地<b>种</b>下种子，长熟之后点一下<b>收</b>进谷仓，再到谷仓旁边的<b>东超告示牌</b>按订单<b>交货</b>，换农场币。' },
          en: { title: 'Plant · harvest · deliver', body: 'Tap soil to <b>plant</b>, tap a ripe crop to <b>harvest</b> it into your barn, then take it to the <b>Eastern Market board</b> next to the barn and <b>fill an order</b> for coins.' },
        },
        {
          icon: 'can',
          zh: { title: '让菜长得更快', body: '点正在生长的菜可以<b>浇水</b>，剩余时间减少两成；有化肥时可以<b>施肥</b>，收成加倍。建了<b>温室</b>或<b>水井</b>，全场作物一起加快。菜不会枯死，也没有倒计时，隔几天再来都可以。' },
          en: { title: 'Speed things up', body: 'Tap a growing crop to <b>water</b> it (20% off the time left) or <b>fertilize</b> (double the yield). A <b>greenhouse</b> or <b>well</b> speeds up the whole farm. Forget about it and nothing wilts — there are no timers here.' },
        },
      ],
    },
    {
      // 🔒 Chris 2026-08-24：原标题「卖得更贵的三条路」改成这个。
      zh: '赚更多的三个方法', en: 'Three ways to earn more',
      items: [
        {
          icon: 'board',
          zh: { title: '按订单供货给东超', body: '点开<b>东超告示牌</b>。每天有基础补货，另外还会不定期发布订单，价格是平常的一倍半到两倍，大单更高。告示牌顶部<b>提前五天</b>预告要收什么，可以照着提前备货。' },
          en: { title: 'Fill store orders', body: 'Tap the <b>Eastern Market board</b>. There are daily restocks plus orders that appear through the day, paying 1.5–2.2× the base price — big orders more. The board shows what is wanted <b>five days ahead</b>, so you can stock up.' },
        },
        {
          icon: 'wok',
          zh: { title: '农场厨房', body: '<b>农场厨房</b>可以把原料做成一道中餐，成品比原料值钱一倍以上。谷仓存货多的时候，做成菜再卖更划算。' },
          en: { title: 'Farm Kitchen', body: 'The <b>Farm Kitchen</b> turns raw crops into a finished dish worth more than twice the ingredients. Best when your barn is full.' },
        },
        {
          icon: 'stall',
          zh: { title: '摆个菜摊', body: '建一个<b>菜摊</b>，会有路人陆续经过，买走一两棵，出价比平常高。不需要一直守着，回来收钱就可以。' },
          en: { title: 'Run a veggie stand', body: 'Build a <b>veggie stand</b> and passers-by will stop for a crop or two, paying above the base price. You do not need to be watching.' },
        },
      ],
    },
    {
      zh: '建设农场', en: 'Build your farm',
      items: [
        {
          icon: 'house',
          zh: { title: '盖自己的家', body: '一共 30 款房子，从两格的农舍到七格的庄园。占地越大，在农场上看着也越大。点现有的房子<b>改建</b>，只补差价。' },
          en: { title: 'Build your home', body: '30 houses, from a 2×2 cottage to a 7×7 estate — the bigger the plot, the bigger it actually looks on your farm. Tap your house to <b>upgrade</b>; you pay only the difference.' },
        },
        {
          icon: 'car',
          zh: { title: '农场车辆', body: '一共 16 辆车，越贵的跑得越快（走路每秒 2.2 格，最贵的 9.0）。<b>点车上车，再点想去的地方就开过去</b>。要走远路时，农户会自己去把车开来。不用加油，也不会坏。' },
          en: { title: 'Farm vehicles', body: '16 cars — the pricier, the faster (walking is 2.2 cells/s, the top car 9.0). <b>Tap a car to get in, then tap anywhere to drive there.</b> For long trips your farmer goes and fetches the car on their own. No fuel, no breakdowns.' },
        },
        {
          icon: 'yard',
          zh: { title: '布置院子', body: '37 种装饰和小动物：花圃、樱花树、风车、许愿池等等。位置不满意可以按住拖动，拆掉退回一半。地块随等级解锁，另外还可以自己<b>开垦 8 块</b>。' },
          en: { title: 'Decorate the yard', body: '37 decorations and animals — flower beds, cherry trees, a windmill, a wishing well. Press and drag to move anything; remove it and you get half back. Plots unlock as you level, plus <b>8 more you can clear yourself</b>.' },
        },
      ],
    },
    {
      zh: '每天回来看看', en: 'Come back daily',
      items: [
        {
          icon: 'cal',
          zh: { title: '每日签到有奖', body: '每日<b>签到</b>，连续七天有大奖，漏了一天可以用补签卡补上；每天三个<b>任务</b>；每天还可以免费转一次<b>大转盘</b>。五分钟就能领完。' },
          en: { title: 'Daily sign-in rewards', body: 'Daily <b>sign-in</b> (7 days in a row = big prize; miss one and a repair card covers you), three daily <b>tasks</b>, and one free <b>wheel spin</b>. Five minutes does it.' },
        },
        {
          icon: 'nbr',
          zh: { title: '天天串门', body: '右下角<b>邻居</b>列出今天在线的人。可以进去帮忙浇水，也可以在熟了的地里顺走一棵，<b>按半价留下菜钱</b>。叫上一个街坊，两个人各得 200 农场币。' },
          en: { title: 'Visit every day', body: '<b>Neighbours</b> (bottom right) lists who is farming today — all real members. Water their crops, or take one ripe crop and <b>leave half the price behind</b>. Invite a neighbour and you both get 200 coins.' },
        },
        {
          icon: 'star',
          zh: { title: '农场人生', body: '升级会收到东超的来信，每一章有几个小目标，完成后领农场币。<b>农场日记</b>会自动记下你的第一次收获、第一次改建、菜摊的第 50 位客人。' },
          en: { title: 'Your farm story', body: 'Leveling up brings a letter from Eastern Market; each chapter has a few goals worth coins. The <b>Farm Diary</b> quietly records your first harvest, your first upgrade, customer #50 at the stand.' },
        },
      ],
    },
    {
      zh: '钱、积分和节日', en: 'Coins, points and festivals',
      items: [
        {
          icon: 'coin',
          zh: { title: '农场币与超市积分', body: '<b>农场币</b>日常都在用：买种子、盖房子、买车、买装饰、开地。<b>超市积分</b>少得多，也珍贵得多，顶配的豪宅和豪华车要用它来买。' },
          en: { title: 'Farm coins and store points', body: '<b>Farm coins</b> are for everyday play — seeds, houses, cars, décor, new plots. <b>Store points</b> are far scarcer and worth far more; the top-tier estates and luxury cars cost them.' },
        },
        {
          icon: 'card',
          zh: { title: '玩游戏赚超市积分', body: '游戏里挣的<b>超市积分</b>，和你在店里消费攒的是同一本账，每天凌晨自动入账，到店买菜可以直接抵钱。<b>每天有上限</b>。' },
          en: { title: 'Earn real store points', body: 'The <b>store points</b> you earn here are the same points on your member card. They sync to your account overnight and come off your grocery bill in store. There is a <b>daily cap</b>, so they build up over time.' },
        },
        {
          icon: 'lantern',
          zh: { title: '节日活动', body: '春节、清明、端午、中秋、重阳、冬至，每个节日都有各自的活动、种子和音乐。收菜、交货、做任务都会涨经验，<b>升级</b>可以解锁新的菜、新的地块和新玩法。' },
          en: { title: 'Festival events', body: 'Spring Festival, Qingming, Dragon Boat, Mid-Autumn, Double Ninth, Winter Solstice — each brings its own event, seeds and music. Harvesting, delivering and tasks all give XP, and <b>leveling up</b> unlocks new crops, plots and features.' },
        },
      ],
    },
  ];

  const guide = {
    open() {
      const lang = Farm.state.data.language === 'en' ? 'en' : 'zh';
      const EN = lang === 'en';

      const body = CHAPTERS.map((ch, ci) => {
        const cards = ch.items.map((s) => {
          const c = s[lang];
          return `
            <div class="guide-card">
              <div class="guide-card-icon">${svg(I[s.icon])}</div>
              <div class="guide-card-text">
                <div class="guide-card-title">${c.title}</div>
                <div class="guide-card-body">${c.body}</div>
              </div>
            </div>`;
        }).join('');
        return `
          <div class="guide-chapter">
            <div class="guide-chapter-head"><span class="guide-chapter-no">${ci + 1}</span>${ch[lang]}</div>
            <div class="guide-list">${cards}</div>
          </div>`;
      }).join('');

      const html = `
        <div class="guide-modal">
          <h2 class="modal-title">${EN ? 'How to Play' : '怎么玩'}</h2>
          <p class="modal-subtitle" style="margin-top:0;">${EN
            ? 'Everything you can do on the farm — at a glance.'
            : '在农场里能做的事，一页看明白。'}</p>
          ${body}
          <div class="btn-row" style="margin-top:16px;">
            <button class="btn" id="guideStartBtn" style="flex:1;font-size:15px;padding:14px;">
              🌱 ${EN ? 'Back to the farm' : '回到农场'}
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
