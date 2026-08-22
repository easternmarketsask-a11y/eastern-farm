/**
 * orders.js — 东超订单板 / Eastern Market Order Board
 *
 * 2026-08-22 重做（Chris：「如果东方超市不再无限收购，怎样使玩家仍然有生产动力。
 * 改变销售模式，只能根据东方超市的订单供货，不再是自己想卖什么就能卖。」）
 *
 * 谷仓的无限收购已经取消，卖菜只有这一条路。三层需求：
 *   ① 每日基础补货 —— 每天 2–3 样、各自限量、1.0×。收入地板，防止卡死。
 *      必有一样是玩家谷仓里最多的菜（见 store-demand.makeStaples），
 *      所以新手第一次只收一棵也交得掉，不会卡在引导第三步。
 *   ② 不定期订单 —— 随机时刻到达，溢价 1.5–2.2×。主收入。
 *   ③ 大单 —— 少见，多品种、≥2.5×，可带超市积分。
 * 顶上常驻「东超下周想要什么」预告 —— 没有它，随机订单就是「种了没人要」的惩罚；
 * 有了它，这套玩法才是备货。
 *
 * 🔒 需求怎么生成一律问 store-demand.js（纯逻辑、可在 node 里跑经济模拟）。
 *    这里只管界面、接单、交付。别把生成逻辑抄一份回来。
 * 🔒 接单上限（ACCEPT_CAP）：没接的单不能交付，否则上限形同虚设。
 * 🔒 cozy：订单过期只是消失，不扣钱、不掉声望、不影响后续出单节奏。
 * 🔒 超市积分保持稀缺，且 source 必须是白名单里的 'task_completion'（见 fulfill）。
 */
(function () {
  const ORDER_EP_DAILY_CAP = 4;    // max 超市积分 earnable from orders per day

  const orders = {

    // ---- daily EP cap bookkeeping (self-resetting, no daily-reset coupling) ----
    _epState() {
      const d = Farm.state.data;
      const today = Farm.state.getDateString();
      if (!d.orderEp || d.orderEp.date !== today) d.orderEp = { date: today, earned: 0 };
      return d.orderEp;
    },
    _epRemainingToday() {
      return Math.max(0, ORDER_EP_DAILY_CAP - this._epState().earned);
    },

    _sd() { return Farm.storeDemand; },
    _demand() { return Farm.state.data.storeDemand; },

    /* 给 store-demand 的入参。所有「当前世界的样子」都在这里拼好一次性传进去 ——
       那个模块不读全局，这样它才能在 node 里被经济模拟直接调用。 */
    _ctx(extra) {
      const d = Farm.state.data;
      const plots = (d.plots || []).filter((p) => p && p.unlocked).length || 1;
      // 谷仓里存量最多的菜：基础补货必带一样，这是防卡死的地板
      const counts = {};
      (d.warehouse || []).forEach((it) => { counts[it.cropId] = (counts[it.cropId] || 0) + 1; });
      const stockTop = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 1);
      const base = {
        now: Date.now(),
        level: d.level || 1,
        plots: plots,
        sessionsPerDay: 3,
        crops: (Farm.crops && Farm.crops.all) ? Farm.crops.all() : [],
        grown: d.cropsEverGrown || [],
        stockTop: stockTop,
        saleCropIds: (this._demand() && this._demand().saleCropIds) || [],
        dayStrings: this._nextDays(this._sd() ? this._sd().FORECAST_DAYS : 5),
        isInSeason: (def) => !!(Farm.crops && Farm.crops.isInSeason && Farm.crops.isInSeason(def)),
        sellPriceOf: (def) => (Farm.crops && Farm.crops.sellPriceOf) ? Farm.crops.sellPriceOf(def) : def.sell_price,
        rand: Math.random,
      };
      return Object.assign(base, extra || {});
    },

    /* 未来 n 天的日期串。**这是全模块唯一算日期的地方**，走 state 的
       getDateString（与签到/每日任务同源）。萨省 UTC-6，自己拼日界必错一天。 */
    _nextDays(n) {
      const out = [];
      const today = new Date();
      for (let i = 0; i < (n || 5); i++) {
        const d2 = new Date(today.getTime() + i * 86400000);
        out.push(Farm.state.getDateString(d2));
      }
      return out;
    },

    _cropName(cropId) {
      const def = Farm.crops && Farm.crops.get(cropId);
      if (!def) return cropId;
      return Farm.state.data.language === 'en' ? def.name_en : def.name_zh;
    },
    _cropIcon(cropId, px) {
      const def = Farm.crops && Farm.crops.get(cropId);
      if (Farm.cropArt && Farm.cropArt.icon) return Farm.cropArt.icon(cropId, px || 20);
      return (def && def.icon) || '🌱';
    },

    /* 把板面刷成「现在该有的样子」。
       🔒 离线回来**不追发**：离线 3 天时 nextPostAt 已经过去十几个周期，
          按周期数补发会一次砸出几十张单 —— 那既荒唐又等于变相无限收购。
          正确行为是：清掉过期的，然后按「现在」把板面补到上限为止。
       🔒 生成即落档（save），刷新不重 roll，否则玩家可以刷页面反复摇订单。 */
    ensure() {
      const SD = this._sd();
      if (!SD) return null;
      const d = Farm.state.data;
      if (!d.storeDemand) d.storeDemand = { day: '', staples: [], board: [], forecast: [], nextPostAt: 0, lastSyncAt: 0, source: 'local', clearedLegacy: false };
      const sd = d.storeDemand;
      const now = Date.now();
      let dirty = false;

      // 换天：重铺基础补货与预告
      const today = Farm.state.getDateString();
      if (sd.day !== today) {
        sd.day = today;
        sd.staples = SD.makeStaples(this._ctx());
        sd.forecast = SD.makeForecast(this._ctx());
        dirty = true;
      }

      // 过期的单直接消失（不惩罚）
      const before = sd.board.length;
      sd.board = sd.board.filter((o) => o && o.expiresAt > now && Array.isArray(o.items) &&
        o.items.length && o.items.every((it) => Farm.crops.get(it.cropId)));
      if (sd.board.length !== before) dirty = true;

      /* 老存档的一次性「开业清仓单」。
         老玩家的谷仓里躺着一堆按「随时能大宗卖」攒下来的菜。收购一关，这批货
         可能既不在补货单里、也不在订单里 —— 一上线就是「我的东西卖不掉了」。
         所以首次进入新版本时，按**旧的大宗价**把当前库存一次收掉（可以不交，
         留着等溢价更高的订单）。只发一次。 */
      if (!sd.clearedLegacy) {
        const bag = {};
        (d.warehouse || []).forEach((it) => { bag[it.cropId] = (bag[it.cropId] || 0) + 1; });
        const ids = Object.keys(bag).filter((id) => Farm.crops.get(id));
        if (ids.length) {
          let coins = 0;
          const items = ids.map((id) => {
            const def = Farm.crops.get(id);
            const unit = (Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price) || 0;
            coins += unit * bag[id];
            return { cropId: id, qty: bag[id] };
          });
          sd.board.unshift({
            id: 'od_clearance_' + now.toString(36),
            kind: 'clearance', items: items,
            coins: coins, xp: Math.max(4, Math.round(coins / 20)), points: 0,
            postedAt: now,
            // 清仓单给足 7 天，别让老玩家一上线没看见就过期了
            expiresAt: now + 7 * 86400000,
            accepted: true,   // 直接接好，不占接单位（它是迁移用的一次性单）
          });
        }
        sd.clearedLegacy = true;
        dirty = true;
      }

      // 到点补单 —— 一次只补到上限，不按错过的周期数补发
      if (!sd.nextPostAt || sd.nextPostAt <= now) {
        let guard = 0;
        while (sd.board.length < SD.BOARD_CAP && guard++ < 10) {
          const o = SD.makeOrder(this._ctx());
          if (!o) break;
          sd.board.push(o);
          dirty = true;
        }
        sd.nextPostAt = now + SD.nextPostDelay(Math.random);
        dirty = true;
      }

      if (dirty) Farm.state.save();
      return sd;
    },

    acceptedCount() {
      const sd = this._demand();
      // 清仓单是迁移用的一次性单，不占接单位（否则老玩家一进来就少一个位置）
      return sd ? sd.board.filter((o) => o.accepted && o.kind !== 'clearance').length : 0;
    },

    accept(orderId) {
      const SD = this._sd(), sd = this._demand();
      const lang = Farm.state.data.language;
      const o = sd && sd.board.filter((x) => x.id === orderId)[0];
      if (!o || o.accepted) return;
      if (this.acceptedCount() >= SD.ACCEPT_CAP) {
        Farm.ui.toast(lang === 'en'
          ? 'You can only take ' + SD.ACCEPT_CAP + ' orders at a time. Finish or drop one first.'
          : '同时最多接 ' + SD.ACCEPT_CAP + ' 单。先交掉或放弃一单，再接这张。', 2600);
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      o.accepted = true;
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('tap');
      this.refreshBadge();
      this.open();
    },

    // 放弃已接的单：立刻腾出位置，**无任何惩罚**（不扣钱、不冷却）
    abandon(orderId) {
      const sd = this._demand();
      const o = sd && sd.board.filter((x) => x.id === orderId)[0];
      if (!o || !o.accepted) return;
      o.accepted = false;
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('tap');
      this.refreshBadge();
      this.open();
    },

    _canFill(order) {
      const need = {};
      order.items.forEach((it) => { need[it.cropId] = (need[it.cropId] || 0) + it.qty; });
      return Object.keys(need).every((cid) => Farm.state.warehouseCount(cid) >= need[cid]);
    },

    // 徽章：能交的已接订单数（红点的意义要单一，别把「有新单」和「交得出」混在一个数字里）
    fillableCount() {
      const sd = this._demand();
      if (!sd) return 0;
      return sd.board.filter((o) => o.accepted && this._canFill(o)).length;
    },

    // 基础补货里还能交多少（用于徽章与引导：新手的第一笔交付走这条）
    stapleReadyCount() {
      const sd = this._demand();
      if (!sd) return 0;
      return sd.staples.filter((s) =>
        s.filled < s.need && Farm.state.warehouseCount(s.cropId) > 0).length;
    },

    _bulkValue(order) {
      return order.items.reduce((s, it) => {
        const def = Farm.crops.get(it.cropId);
        return s + (def ? (def.sell_price || 0) * it.qty : 0);
      }, 0);
    },

    /* 每日首单 +20%：本来挂在一键卖货上，那是玩家每天回来的钩子之一，
       不该跟着无限收购一起消失 —— 改挂在「今天第一次交东西给东超」上。
       补货和订单都算，谁先交谁拿。 */
    _dailyFirstBonus(baseCoins) {
      const d = Farm.state.data;
      if (d.dailyClaims.firstDeliveryDone) return 0;
      const bonus = Math.round(baseCoins * 0.2);
      if (bonus > 0) Farm.state.addCoins(bonus);
      d.dailyClaims.firstDeliveryDone = true;
      return bonus;
    },

    /* 交付计数。搬自 state.deliverWarehouse（2026-08-22 关掉无限收购）。
       它原来只在那里自增，删掉那条路会让它**永久冻结**，连带静默失效：
       life-story 的 deliver_first / deliver 25 / 100、排行榜与邻居卡片的交付数、
       daily.js 的 isNewbie(<3)、漏斗 sell_first、新手引导第三步的推进判据。 */
    _countDelivery() {
      const d = Farm.state.data;
      d.totalDeliveries = (d.totalDeliveries || 0) + 1;
      if (Farm.track && d.totalDeliveries === 1) Farm.track('sell_first');
    },

    // ============ 交基础补货（地板通道，1.0×，不占接单位）============
    fillStaple(cropId) {
      const lang = Farm.state.data.language;
      const sd = this._demand();
      const s = sd && sd.staples.filter((x) => x.cropId === cropId)[0];
      if (!s) return;
      const room = Math.max(0, s.need - s.filled);
      const have = Farm.state.warehouseCount(cropId);
      const n = Math.min(room, have);
      if (n <= 0) {
        Farm.ui.toast(lang === 'en' ? 'Nothing to hand over yet' : '这样菜暂时交不了', 2000);
        return;
      }
      const def = Farm.crops.get(cropId);
      const unit = (Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price) || 0;
      const coins = unit * n;
      for (let i = 0; i < n; i++) Farm.state.removeFromWarehouse(cropId, 1);
      Farm.state.addCoins(coins);
      s.filled += n;
      const bonus = this._dailyFirstBonus(coins);
      this._countDelivery();
      Farm.state.save();

      if (Farm.ui.flyCoins) {
        Farm.ui.flyCoins(window.innerWidth / 2, window.innerHeight * 0.45, Math.min(8, Math.max(3, n)));
        setTimeout(() => Farm.ui.refreshHUD(), 280);
      } else { Farm.ui.refreshHUD(); }
      if (Farm.audio) Farm.audio.play('coin');
      const coin = '<span class="coin-icon"></span>';
      let msg = (lang === 'en' ? '🏪 Handed over ' : '🏪 交了 ') + n + ' × ' + this._cropName(cropId) +
        ' +' + coins + coin;
      if (bonus > 0) msg += (lang === 'en' ? ' (incl. 🌅 first today +' : '（含 🌅 今日首单 +') + bonus + coin + (lang === 'en' ? ')' : '）');
      Farm.ui.toast(msg, 2800);

      if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();
      if (Farm.achievements) Farm.achievements.checkAll();
      this.refreshBadge();
      this.open();
    },

    // ============ 交订单 ============
    fulfill(orderId) {
      const lang = Farm.state.data.language;
      const d = Farm.state.data;
      const sd = this._demand();
      const order = sd && sd.board.filter((o) => o.id === orderId)[0];
      if (!order) return;

      // 🔒 没接的单不能交 —— 否则接单上限形同虚设
      if (!order.accepted) {
        Farm.ui.toast(lang === 'en' ? 'Take this order first.' : '先接下这一单，再交货。', 2200);
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      if (!this._canFill(order)) {
        Farm.ui.toast(lang === 'en' ? 'Not enough crops yet' : '谷仓里的菜还不够', 2000);
        if (Farm.audio) Farm.audio.play('error');
        return;
      }

      order.items.forEach((it) => Farm.state.removeFromWarehouse(it.cropId, it.qty));
      Farm.state.addCoins(order.coins);
      const levelInfo = Farm.state.addXp(order.xp);

      let epAwarded = 0;
      if (order.points > 0) {
        epAwarded = Math.min(order.points, this._epRemainingToday());
        if (epAwarded > 0) {
          Farm.state.addEastPoints(epAwarded, {
            /* 🔒 'order_fill' 不在 StockWise 的 ALLOWED_GAME_SOURCES 里（2026-08-15 审阅第 1 条）：
               服务端 422 拒收 → addEastPoints 回滚，可玩家已经看到「+N 超市积分」的飘字。
               交订单本质就是完成一件东超派的活，走已白名单的 task_completion。 */
            source: 'task_completion',
            description: '完成东超订单 / Filled Eastern Market order ' + order.id,
          });
          this._epState().earned += epAwarded;
        }
      }

      d.totalOrdersFilled = (d.totalOrdersFilled || 0) + 1;
      this._countDelivery();
      const firstBonus = this._dailyFirstBonus(order.coins);

      // 交完这张就从板上拿掉；下一张按 nextPostAt 自然到来（不立刻补位 —— 立刻
      // 补位就等于无限供应，那正是这次要取消的东西）
      sd.board = sd.board.filter((o) => o.id !== orderId);
      Farm.state.save();

      if (Farm.ui.flyCoins) {
        Farm.ui.flyCoins(window.innerWidth / 2, window.innerHeight * 0.45, 8);
        setTimeout(() => Farm.ui.refreshHUD(), 280);
      } else { Farm.ui.refreshHUD(); }
      if (Farm.audio) Farm.audio.play('coin');
      if (Farm.ui.showConfetti) Farm.ui.showConfetti(16, 1300);

      const coin = '<span class="coin-icon"></span>';
      const pts = '<span class="points-icon"></span>';
      let msg = (lang === 'en' ? '🚚 Order delivered! +' : '🚚 订单完成！+') + order.coins + coin + ' +' + order.xp + ' XP';
      if (firstBonus > 0) {
        msg += (lang === 'en' ? ' (incl. 🌅 first order today +' : '（含 🌅 今日首单 +') + firstBonus + coin + (lang === 'en' ? ')' : '）');
      }
      if (epAwarded > 0) msg += ' +' + epAwarded + pts;
      Farm.ui.toast(msg, 3200);

      if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();
      this.refreshBadge();
      if (Farm.achievements) Farm.achievements.checkAll();
      if (Farm.tasks && Farm.tasks.onEvent) Farm.tasks.onEvent('order', { coins: order.coins });

      if (levelInfo && levelInfo.leveledUp) {
        const li = levelInfo;
        const epAward = 5 * (li.newLevel - li.oldLevel);
        const coinAward = 50 * (li.newLevel - li.oldLevel);
        setTimeout(() => {
          Farm.state.addCoins(coinAward);
          Farm.state.addEastPoints(epAward, { source: 'level_up', description: '升级奖励 / Level up ' + li.oldLevel + ' → ' + li.newLevel });
          Farm.ui.refreshHUD();
          if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
          if (Farm.ui.showLevelUpModal) Farm.ui.showLevelUpModal(li.oldLevel, li.newLevel, { epAwarded: epAward });
        }, 600);
      }

      this.open();
    },

    // ============ 渲染 ============
    open() {
      const SD = this._sd();
      const sd = this.ensure();
      const lang = Farm.state.data.language;
      const coin = '<span class="coin-icon"></span>';
      const pts = '<span class="points-icon"></span>';
      if (!sd || !SD) { Farm.ui.toast(lang === 'en' ? 'Loading…' : '正在加载…', 1500); return; }

      // —— ① 每日基础补货 ——
      const stapleRows = sd.staples.map((s) => {
        const have = Farm.state.warehouseCount(s.cropId);
        const room = Math.max(0, s.need - s.filled);
        const can = room > 0 && have > 0;
        const done = room <= 0;
        const pct = Math.min(100, Math.round((s.filled / Math.max(1, s.need)) * 100));
        const btn = done
          ? '<span class="staple-done">✓ ' + (lang === 'en' ? 'Done' : '今日已满') + '</span>'
          : (can
            ? '<button class="slip-btn go staple-fill" data-staple="' + s.cropId + '">' +
              (lang === 'en' ? 'Hand ' : '交 ') + Math.min(room, have) + '</button>'
            : '<span class="staple-wait">' + (lang === 'en' ? 'Grow some' : '还没有') + '</span>');
        return '<div class="staple-row">' +
          '<span class="staple-icon">' + this._cropIcon(s.cropId, 20) + '</span>' +
          '<span class="staple-name">' + this._cropName(s.cropId) + '</span>' +
          '<span class="staple-bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="staple-qty">' + s.filled + '/' + s.need + '</span>' +
          btn + '</div>';
      }).join('');

      // —— ② / ③ 订单卡 ——
      const accepted = this.acceptedCount();
      const cards = sd.board.map((o) => {
        const canFill = this._canFill(o);
        const rows = o.items.map((it) => {
          const have = Farm.state.warehouseCount(it.cropId);
          const ok = have >= it.qty;
          return '<div class="slip-line ' + (ok ? 'ok' : 'short') + '">' +
            '<span class="slip-ico">' + this._cropIcon(it.cropId, 18) + '</span>' +
            '<span class="slip-name">' + this._cropName(it.cropId) + '</span>' +
            '<span class="slip-dots"></span>' +
            '<span class="slip-qty">' + Math.min(have, it.qty) + ' / ' + it.qty + '</span>' +
            '<span class="slip-mark">' + (ok ? '✓' : '') + '</span></div>';
        }).join('');

        const bonus = Math.max(0, o.coins - this._bulkValue(o));
        const hoursLeft = Math.max(0, Math.round((o.expiresAt - Date.now()) / 3600000));
        const reward = '<div class="slip-total">' +
          '<span class="slip-total-label">' + (lang === 'en' ? 'Pays' : '结算') + '</span>' +
          '<span class="slip-total-coins">' + o.coins + coin + '</span>' +
          '<span class="slip-total-xp">+' + o.xp + ' XP</span>' +
          (o.points ? '<span class="slip-total-pts">+' + o.points + pts + '</span>' : '') +
          (bonus > 0 ? '<span class="slip-total-bonus">' + (lang === 'en' ? 'over plain price +' : '比原价多 +') + bonus + coin + '</span>' : '') +
          '</div>';

        /* 🔒 单据上的动作别用全局 .btn —— 那是 48px 全宽的渐变大药丸，压在货单上
           就变回「设置面板」（Chris 2026-08-22：「交付/接单按键太丑了太肥大了」）。
           这里用窄的、靠右的印章式按钮。
           🔒「还差一点」「接单位已满」**是状态不是动作**，画成大号禁用按钮正是
           「肥大」的主要来源 —— 改成一行小字。 */
        let actions;
        if (!o.accepted) {
          const full = accepted >= SD.ACCEPT_CAP;
          actions = full
            ? '<span class="slip-note">' + (lang === 'en'
                ? 'Slots full ' + accepted + '/' + SD.ACCEPT_CAP
                : '接单位已满 ' + accepted + '/' + SD.ACCEPT_CAP) + '</span>'
            : '<button class="slip-btn order-accept" data-accept="' + o.id + '">' +
              (lang === 'en' ? 'Take' : '接单') + '</button>';
        } else {
          const deliver = canFill
            ? '<button class="slip-btn go order-deliver" data-order="' + o.id + '">' +
              (lang === 'en' ? 'Deliver' : '交付') + '</button>'
            : '<span class="slip-note">' + (lang === 'en' ? 'Not enough yet' : '还差一点') + '</span>';
          actions = deliver + '<button class="slip-drop" data-drop="' + o.id + '" title="' +
            (lang === 'en' ? 'Drop this order (no penalty)' : '放弃这一单（无惩罚）') + '">' +
            (lang === 'en' ? 'Drop' : '放弃') + '</button>';
        }

        /* 版式是**货单**，不是设置项（Chris 2026-08-22：「做得更像订单」）：
           抬头有单号和收货方、明细逐行带引导点、下面一条分隔线再写合计。 */
        // 单号只取字母数字：id 形如 od_xxx_yyy，直接切尾会带出下划线（#_C1Z9 很难看）
        const no = o.id.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase();
        const tag = o.kind === 'clearance'
          ? (lang === 'en' ? 'CLEARANCE' : '清仓')
          : (o.kind === 'big' ? (lang === 'en' ? 'BULK' : '大单') : '');
        return '<div class="order-slip ' + (o.accepted ? 'taken ' : '') + (canFill && o.accepted ? 'ready' : '') +
          (o.kind === 'big' ? ' big' : '') + (o.kind === 'clearance' ? ' clearance' : '') + '">' +
          '<div class="slip-head">' +
            '<span class="slip-no">' + (lang === 'en' ? 'ORDER ' : '订单 ') + '#' + no + '</span>' +
            (tag ? '<span class="slip-tag">' + tag + '</span>' : '') +
            '<span class="slip-due">' + (lang === 'en' ? hoursLeft + 'h' : hoursLeft + ' 小时内') + '</span>' +
          '</div>' +
          '<div class="slip-to">' + (lang === 'en' ? 'To: Eastern Market' : '收货：东方超市') + '</div>' +
          '<div class="slip-lines">' + rows + '</div>' +
          '<div class="slip-rule"></div>' + reward +
          '<div class="order-actions">' + actions + '</div></div>';
      }).join('');

      // —— 备货预告 ——
      const fc = (sd.forecast || []).map((f) => {
        const names = f.cropIds.map((id) => this._cropIcon(id, 16) + ' ' + this._cropName(id)).join(' ');
        const day = f.date.slice(5);
        return '<div class="fc-day"><span class="fc-date">' + day + '</span><span class="fc-crops">' + names + '</span></div>';
      }).join('');

      const html =
        '<h2 class="modal-title">' + (lang === 'en' ? 'Eastern Market Orders' : '东超订单') + '</h2>' +
        '<p class="modal-subtitle">' + (lang === 'en'
          ? 'Eastern Market only buys what it ordered. Plan ahead with the forecast below.'
          : '东方超市只收它订的货。看下面的预告提前备货。') + '</p>' +
        '<div class="order-section-title">' + (lang === 'en' ? 'Daily restock' : '每日基础补货') + '</div>' +
        '<div class="staple-list">' + (stapleRows || '<div class="ef-empty-hint">' +
          (lang === 'en' ? 'Nothing today.' : '今天没有。') + '</div>') + '</div>' +
        '<div class="order-section-title">' + (lang === 'en'
          ? 'Orders (' + accepted + '/' + SD.ACCEPT_CAP + ' taken)'
          : '订单（已接 ' + accepted + '/' + SD.ACCEPT_CAP + '）') + '</div>' +
        '<div class="order-list">' + (cards || '<div class="ef-empty-hint">' +
          (lang === 'en' ? 'No orders right now — one will come along.' : '现在没有订单，过一会儿会来。') + '</div>') + '</div>' +
        '<div class="order-section-title">' + (lang === 'en' ? 'Coming up' : '东超接下来想要') + '</div>' +
        '<div class="fc-list">' + fc + '</div>' +
        '<div class="btn-row" style="margin-top:14px;">' +
        '<button class="btn secondary" onclick="Farm.ui.hideModal()">' + Farm.i18n.t('btn_close') + '</button></div>';

      Farm.ui.showModal(html);

      document.querySelectorAll('#modalContent .staple-fill').forEach((btn) => {
        btn.onclick = () => this.fillStaple(btn.getAttribute('data-staple'));
      });
      document.querySelectorAll('#modalContent .order-accept').forEach((btn) => {
        btn.onclick = () => this.accept(btn.getAttribute('data-accept'));
      });
      document.querySelectorAll('#modalContent .order-deliver').forEach((btn) => {
        btn.onclick = () => this.fulfill(btn.getAttribute('data-order'));
      });
      document.querySelectorAll('#modalContent .slip-drop').forEach((btn) => {
        btn.onclick = () => this.abandon(btn.getAttribute('data-drop'));
      });
    },

    // ============ 东超徽章 ============
    refreshBadge() {
      const el = document.getElementById('storekeeperBadge');
      if (!el) return;
      this.ensure();
      const n = this.fillableCount() + this.stapleReadyCount();
      if (n > 0) { el.textContent = n; el.classList.add('show'); }
      else { el.textContent = ''; el.classList.remove('show'); }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.orders = orders;
})();
