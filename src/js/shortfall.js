/**
 * shortfall.js — 钱不够时给出路，而不是一句「余额不足」。
 *
 * 想买买不起，是玩家意图最强的一刻。原来这里只弹一句 toast，是个死胡同：
 * 玩家知道自己穷，但不知道下一步该干什么。
 *
 * 🔒 两种货币的引导方向**相反**（Chris 2026-08-21 定）：
 *   农场币不够 → 引回游戏里赚（卖菜/收地/领任务）。对店里零成本，还提留存。
 *   超市积分不够 → 引到店里消费。这才是这个游戏真正想要的转化。
 *
 * 🔒 **积分不够时绝不推「农场币兑换」**。农场币种菜无限产，而 10 币能换 1 个
 * 真实超市积分（= Chris 的负债）。兑换路仍在奖励页里，但不能在「想买买不起」
 * 这个最强动机时刻主动推到玩家脸上 —— 那等于教玩家印店里的钱。
 *
 * 面板本身不发任何东西，只导流，对店里零成本。
 */
(function () {
  const REPEAT_MS = 8000;   // 同一件东西连点，8 秒内只弹一次

  const shortfall = {
    _lastKey: '',
    _lastAt: 0,

    _lang() { return (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh'; },

    // 今天还能从任务拿到多少：已完成待领的、和还没做完的，分开算
    _taskGains(field) {
      const d = (Farm.state && Farm.state.data) || {};
      const list = (d.dailyTasks || []).concat(d.weeklyTask ? [d.weeklyTask] : []);
      let ready = 0, todo = 0, readyN = 0, todoN = 0;
      list.forEach((t) => {
        if (!t || t.claimed) return;
        const v = t[field] || 0;
        if (v <= 0) return;
        if (t.progress >= t.target) { ready += v; readyN++; }
        else { todo += v; todoN++; }
      });
      return { ready, todo, readyN, todoN };
    },

    _ripeCount() {
      const plots = (Farm.state && Farm.state.data && Farm.state.data.plots) || [];
      let n = 0;
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        if (p && p.unlocked && p.crop && Farm.crops && Farm.crops.isMature && Farm.crops.isMature(p)) n++;
      }
      return n;
    },

    _go(fn) {
      if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
      setTimeout(() => { try { fn(); } catch (e) {} }, 180);
    },

    /* 攒出「怎么最快拿到」这几条。每条都算真实数字 —— 说「多种点菜」等于没说。
       只保留真有东西可拿的条目，最多 3 条。 */
    _routes(kind) {
      const en = this._lang() === 'en';
      const out = [];
      if (kind === 'coins') {
        const t = this._taskGains('reward_coins');
        if (t.ready > 0) {
          out.push({ icon: '✅', gain: t.ready, weight: 100,
            text: en ? `${t.readyN} task${t.readyN > 1 ? 's' : ''} done — collect` : `${t.readyN} 个任务做完了没领`,
            btn: en ? 'Collect' : '去领', go: () => Farm.tasks && Farm.tasks.open() });
        }
        const wv = (Farm.state && Farm.state.getWarehouseValue) ? Farm.state.getWarehouseValue() : 0;
        if (wv > 0) {
          out.push({ icon: '🌾', gain: wv, weight: 90,
            text: en ? 'Sell what is in the barn' : '把谷仓里的菜卖掉',
            btn: en ? 'Sell' : '去卖', go: () => Farm.warehouse && Farm.warehouse.open() });
        }
        const ripe = this._ripeCount();
        if (ripe > 0) {
          out.push({ icon: '🧺', gain: null, weight: 80,
            text: en ? `${ripe} plot${ripe > 1 ? 's' : ''} ready to harvest` : `${ripe} 块地熟了，可以收`,
            btn: en ? 'Harvest' : '去收', go: () => Farm.ui && Farm.ui.hideModal() });
        }
        if (t.todo > 0) {
          out.push({ icon: '📋', gain: t.todo, weight: 60,
            text: en ? "Finish today's tasks" : '做完今天的任务',
            btn: en ? 'Tasks' : '看任务', go: () => Farm.tasks && Farm.tasks.open() });
        }
      } else {
        /* 🔒 到店那条永远排第一，且**不提兑换**。
           农场里没有会员码页面 —— 积分是结账时报手机号记到会员卡上，
           所以这里说的是真实流程，不要凭空指向一个不存在的二维码。 */
        const loggedIn = !!(Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn());
        out.push({ icon: '🏪', gain: null, weight: 100,
          text: en ? 'Shop at the store — points go on your member card'
                   : '到店买菜就有积分，结账时报手机号',
          btn: loggedIn ? '' : (en ? 'Sign in' : '登录'),
          go: loggedIn ? null : () => { if (Farm.fbAuth && Farm.fbAuth.openLogin) Farm.fbAuth.openLogin(); } });
        const t = this._taskGains('reward_points');
        if (t.ready > 0) {
          out.push({ icon: '✅', gain: t.ready, weight: 90,
            text: en ? `${t.readyN} task${t.readyN > 1 ? 's' : ''} done — collect` : `${t.readyN} 个任务做完了没领`,
            btn: en ? 'Collect' : '去领', go: () => Farm.tasks && Farm.tasks.open() });
        }
        if (t.todo > 0) {
          out.push({ icon: '📋', gain: t.todo, weight: 70,
            text: en ? "Finish today's tasks" : '做完今天的任务',
            btn: en ? 'Tasks' : '看任务', go: () => Farm.tasks && Farm.tasks.open() });
        }
        out.push({ icon: '🎁', gain: null, weight: 40,
          text: en ? 'Daily sign-in gives points too' : '每天签到也有积分',
          btn: en ? 'Sign in' : '去签到', go: () => Farm.daily && Farm.daily.open() });
      }
      return out.sort((a, b) => b.weight - a.weight).slice(0, 3);
    },

    /* kind: 'coins' | 'points'；need = 这次要花多少；key 用来防连点重复弹 */
    show(kind, need, key) {
      if (!Farm.ui || !Farm.ui.showModal) return false;
      const now = Date.now();
      const k = kind + ':' + (key || '');
      if (this._lastKey === k && now - this._lastAt < REPEAT_MS) return false;
      this._lastKey = k; this._lastAt = now;

      const en = this._lang() === 'en';
      const d = (Farm.state && Farm.state.data) || {};
      const have = kind === 'coins' ? (d.coins || 0) : (d.eastPoints || 0);
      const gap = Math.max(0, Math.ceil((need || 0) - have));
      const unit = kind === 'coins'
        ? (en ? 'farm coins' : '农场币')
        : (en ? 'store points' : '超市积分');
      const icon = kind === 'coins' ? '<span class="coin-icon"></span>' : '<span class="points-icon"></span>';

      const routes = this._routes(kind);
      const rows = routes.map((r, i) => {
        const gainTxt = r.gain ? ('<b style="color:var(--leaf-dark);white-space:nowrap;">+' + r.gain.toLocaleString() + '</b>') : '';
        const btn = r.go
          ? ('<button class="btn secondary" data-sf="' + i + '" style="padding:6px 12px;font-size:13px;white-space:nowrap;">'
             + (r.btn || (en ? 'Go' : '去')) + '</button>')
          : '';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f0e8da;">'
          + '<span style="font-size:20px;width:26px;text-align:center;">' + r.icon + '</span>'
          + '<span style="flex:1;min-width:0;font-size:14px;line-height:1.45;">' + r.text + '</span>'
          + gainTxt + btn + '</div>';
      }).join('');

      const html = '<h2 class="modal-title">'
        + (en ? ('Need ' + gap.toLocaleString() + ' more') : ('还差 ' + gap.toLocaleString() + ' ' + unit))
        + '</h2>'
        + '<p class="modal-subtitle" style="margin:0 0 10px;">'
        + (en ? ('You have ' + have.toLocaleString() + ' · this costs ' + (need || 0).toLocaleString())
              : ('你有 ' + have.toLocaleString() + ' · 这个要 ' + (need || 0).toLocaleString()))
        + ' ' + icon + '</p>'
        + '<div style="margin:4px 0 2px;font-size:13px;color:var(--warm-text-soft);">'
        + (en ? 'Quickest ways to get it:' : '最快的几条路：') + '</div>'
        + rows
        + '<div class="btn-row" style="margin-top:14px;"><button class="btn secondary" id="sfClose" style="width:100%;">'
        + (en ? 'Not now' : '再说') + '</button></div>';

      Farm.ui.showModal(html);
      document.querySelectorAll('[data-sf]').forEach((b) => {
        const r = routes[parseInt(b.getAttribute('data-sf'), 10)];
        if (r && r.go) b.onclick = () => { if (Farm.audio) Farm.audio.play('tap'); this._go(r.go); };
      });
      const c = document.getElementById('sfClose');
      if (c) c.onclick = () => Farm.ui.hideModal();
      return true;
    },
  };

  window.Farm = window.Farm || {};
  Farm.shortfall = shortfall;
})();
