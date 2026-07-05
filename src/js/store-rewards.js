/**
 * store-rewards.js — 反向闭环：到店消费 → 农场奖励（游戏侧 B，2026-07-05）
 *
 * 登录会员在 dock 菜单点「🧾 领取到店奖励」→ 调 StockWise
 *   POST /api/members/me/farm-purchase-rewards（会员 Firebase token 鉴权）。
 * 幂等在服务端；游戏只如实反映返回值。农场币客户端权威——coins>0 时走
 * Farm.state.addCoins + 存档 + HUD 跳字 + flyCoins 庆祝揭示。东方点不在此发
 * （服务端 _run_award 已按订单自动发放，重复发会重复计负债）。
 *
 * 返回分支处理：
 *   coins>0             → 入账 + 揭示弹窗（列出 newRewards 订单/金额/+币）
 *   coins==0 & 非以下   → 轻 toast「暂无新的到店奖励，去东方超市买点菜再来领」
 *   unlinked            → 引导弹窗「下次到店出示会员码关联」
 *   disabled            → 轻 toast「到店奖励暂未开放」
 *
 * 手感铁律：≥2s 操作有加载态 + 禁按钮防连点；15s timeout + catch 重置 + 重试入口
 * （feedback_long_task_progress / feedback_loading_state_must_be_recoverable，
 *  否则手机端卡死要重启）。
 */
(function () {
  const L = () => (Farm.state && Farm.state.data && Farm.state.data.language === 'en' ? 'en' : 'zh');
  const esc = (s) => (Farm.ui && Farm.ui.escapeHtml) ? Farm.ui.escapeHtml(s) : String(s == null ? '' : s);
  let _busy = false;   // 请求进行中 → 防连点双发（幂等虽在服务端，仍避免重复请求）

  const storeRewards = {
    // dock 菜单入口点击处理
    open() {
      // 未登录 → 走现有登录引导，不硬弹奖励
      if (!(Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn())) {
        this._promptLogin();
        return;
      }
      this._showClaimModal();
    },

    _promptLogin() {
      const en = L() === 'en';
      const html = `
        <div style="text-align:center;padding:6px 4px;">
          <div style="font-size:52px;line-height:1;margin-bottom:6px;">🧾</div>
          <h2 class="modal-title" style="margin-bottom:4px;">${en ? 'Claim in-store rewards' : '领取到店奖励'}</h2>
          <p class="modal-subtitle" style="margin-top:0;line-height:1.5;">${en
            ? 'Sign in with your Eastern Market membership to turn store purchases into farm coins.'
            : '用东方超市会员登录，把到店消费变成农场币。'}</p>
          <div class="btn-row" style="margin-top:16px;">
            <button class="btn secondary" id="srLater">${en ? 'Maybe later' : '以后再说'}</button>
            <button class="btn" id="srSignIn">📱 ${en ? 'Sign in' : '会员登录'}</button>
          </div>
        </div>`;
      Farm.ui.showModal(html);
      const si = document.getElementById('srSignIn');
      if (si) si.onclick = () => {
        Farm.ui.hideModal();
        if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal();
      };
      const later = document.getElementById('srLater');
      if (later) later.onclick = () => Farm.ui.hideModal();
    },

    _showClaimModal() {
      const en = L() === 'en';
      const html = `
        <div style="text-align:center;padding:6px 4px;">
          <div style="font-size:52px;line-height:1;margin-bottom:6px;">🧾</div>
          <h2 class="modal-title" style="margin-bottom:4px;">${en ? 'In-store Rewards' : '领取到店奖励'}</h2>
          <p class="modal-subtitle" style="margin-top:0;line-height:1.5;">${en
            ? 'Shopped at Eastern Market lately? Claim farm coins for your recent orders.'
            : '最近到东方超市买菜了吗？为近期订单领取农场币吧 🛒'}</p>
          <div id="srStatus" style="min-height:18px;font-size:13px;color:#6b5840;margin:14px 0 4px;"></div>
          <button class="btn" id="srClaimBtn" style="width:100%;padding:14px;font-size:15px;">
            🧾 ${en ? 'Claim now' : '一键领取'}
          </button>
          <button class="btn secondary" id="srCloseBtn" style="width:100%;margin-top:8px;">
            ${(Farm.i18n && Farm.i18n.t) ? Farm.i18n.t('btn_close') : (en ? 'Close' : '关闭')}
          </button>
        </div>`;
      Farm.ui.showModal(html);
      const btn = document.getElementById('srClaimBtn');
      if (btn) btn.onclick = () => this._doClaim();
      const close = document.getElementById('srCloseBtn');
      if (close) close.onclick = () => Farm.ui.hideModal();
    },

    async _doClaim() {
      if (_busy) return;   // 防连点双发
      const en = L() === 'en';
      const btn = document.getElementById('srClaimBtn');
      const status = document.getElementById('srStatus');
      _busy = true;
      // 加载态：禁按钮 + 进度文字（≥2s 操作必须可见反馈）
      if (btn) { btn.disabled = true; btn.textContent = en ? '⏳ Checking your orders…' : '⏳ 正在查询到店订单…'; }
      if (status) status.textContent = en ? 'Talking to Eastern Market…' : '正在连接东方超市…';
      try {
        const resp = await Farm.fbPoints.claimStorePurchaseRewards({ timeoutMs: 15000 });
        _busy = false;
        this._handleResponse(resp);
      } catch (e) {
        _busy = false;
        console.warn('[store-rewards] claim failed:', e && (e.code || e.message));
        this._showError(e);
      }
    },

    // timeout / 网络 / 5xx / auth → 不留死加载态，重置为「重试」入口
    _showError(e) {
      const en = L() === 'en';
      const btn = document.getElementById('srClaimBtn');
      const status = document.getElementById('srStatus');
      const msg = (e && e.code === 'timeout')
        ? (en ? 'Timed out. Check your connection and retry.' : '连接超时，请检查网络后重试。')
        : (en ? 'Something went wrong. Please try again.' : '出了点问题，请再试一次。');
      if (status) status.textContent = '⚠️ ' + msg;
      if (btn) {
        btn.disabled = false;
        btn.textContent = en ? '↻ Retry' : '↻ 重试';
      }
    },

    _handleResponse(resp) {
      resp = resp || {};
      const en = L() === 'en';
      // 功能关闭
      if (resp.disabled) {
        Farm.ui.hideModal();
        Farm.ui.toast(en ? '🧾 In-store rewards are not open yet' : '🧾 到店奖励暂未开放', 3000);
        return;
      }
      // 未关联店内消费
      if (resp.unlinked) {
        this._showUnlinked(resp);
        return;
      }
      const coins = Number(resp.coins) || 0;
      const rewards = Array.isArray(resp.newRewards) ? resp.newRewards : [];
      if (coins > 0) {
        this._celebrate(coins, rewards);
        return;
      }
      // coins==0 且非 unlinked/disabled → 暂无新单，轻 toast（不弹重窗）
      Farm.ui.hideModal();
      Farm.ui.toast(en
        ? '🛒 No new in-store rewards yet — shop at Eastern Market and come back!'
        : '🛒 暂无新的到店奖励，去东方超市买点菜再来领 🛒', 3600);
    },

    _showUnlinked(resp) {
      const en = L() === 'en';
      const serverMsg = resp && resp.message;
      const body = serverMsg || (en
        ? 'Show your membership code at checkout next time to link your purchases, then you can claim in-store rewards.'
        : '下次到店结账时出示会员码关联消费，之后即可领取到店奖励。');
      const html = `
        <div style="text-align:center;padding:6px 4px;">
          <div style="font-size:52px;line-height:1;margin-bottom:6px;">🪪</div>
          <h2 class="modal-title" style="margin-bottom:4px;">${en ? 'Link your purchases first' : '先关联店内消费'}</h2>
          <p class="modal-subtitle" style="margin-top:8px;line-height:1.55;">${esc(body)}</p>
          <button class="btn" id="srUnlinkedOk" style="width:100%;padding:14px;font-size:15px;margin-top:14px;">
            ${en ? 'Got it' : '知道了'}
          </button>
        </div>`;
      Farm.ui.showModal(html);
      const ok = document.getElementById('srUnlinkedOk');
      if (ok) ok.onclick = () => Farm.ui.hideModal();
    },

    _celebrate(coins, rewards) {
      const en = L() === 'en';
      // 农场币客户端入账 + 存档（客户端权威）+ HUD 跳字（refreshHUD 内 _tickCounter）
      Farm.state.addCoins(coins);
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();

      const rows = rewards.map(r => {
        const date = esc(String(r.date || ''));
        const total = (r.total != null && !isNaN(Number(r.total))) ? ('$' + Number(r.total).toFixed(2)) : '';
        const rc = Number(r.coins) || 0;
        const left = date + (total ? ' · ' + total : '');
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(58,140,80,0.10);font-size:13px;">
          <span style="color:#6b5840;">${left || (en ? 'Order' : '订单')}</span>
          <span style="color:#3a8c50;font-weight:700;">+${rc.toLocaleString()}</span>
        </div>`;
      }).join('');

      const html = `
        <div style="text-align:center;padding:6px 4px;">
          <div style="font-size:54px;line-height:1;margin-bottom:6px;">🎉</div>
          <h2 class="modal-title" style="margin-bottom:4px;">${en ? 'In-store rewards claimed!' : '到店奖励已领取！'}</h2>
          <p class="modal-subtitle" style="margin-top:0;">${en ? 'Thanks for shopping at Eastern Market 🛒' : '感谢到东方超市购物 🛒'}</p>
          <div style="margin:16px 0;padding:18px 16px;background:linear-gradient(135deg,#fff8e7,#fef3d6);border-radius:16px;border:1px solid rgba(58,140,80,0.15);">
            <div style="font-size:40px;font-weight:800;color:#3a8c50;line-height:1;letter-spacing:-1px;">+${coins.toLocaleString()}</div>
            <div style="font-size:13px;color:#6b5840;margin-top:6px;font-weight:600;">${en ? 'farm coins' : '农场币'}</div>
          </div>
          ${rows ? `<div style="text-align:left;background:#fff;border-radius:12px;overflow:hidden;border:1px solid rgba(58,140,80,0.10);margin-bottom:8px;">
            <div style="padding:8px 12px;font-size:12px;color:#9b8870;background:rgba(58,140,80,0.05);">${en ? 'Orders rewarded' : '本次奖励订单'}</div>
            ${rows}
          </div>` : ''}
          <button class="btn" id="srDoneBtn" style="width:100%;padding:14px;font-size:15px;margin-top:6px;">
            ${en ? 'Nice! →' : '收下 →'}
          </button>
        </div>`;

      Farm.ui.showModal(html, {
        onShow: () => {
          const btn = document.getElementById('srDoneBtn');
          if (btn) btn.onclick = () => { Farm.ui.hideModal(); if (Farm.audio) Farm.audio.play('coin'); };
          // 金币飞入 HUD 计数器（从弹窗中上部起飞）+ 彩带 + 音效 + 触感
          try {
            const modalC = document.getElementById('modalContent');
            const box = (modalC || document.body).getBoundingClientRect();
            const nCoins = Math.min(10, Math.max(4, Math.round(coins / 60)));
            if (Farm.ui && Farm.ui.flyCoins) {
              Farm.ui.flyCoins(box.left + box.width / 2, box.top + Math.min(150, box.height / 3), nCoins);
            }
          } catch (_) {}
          if (Farm.ui && Farm.ui.showConfetti) Farm.ui.showConfetti(40, 2600);
          if (Farm.audio) Farm.audio.play('achievement');
          if (navigator.vibrate) { try { navigator.vibrate([20, 50, 20]); } catch (_) {} }
        },
      });

      if (Farm.track) Farm.track('store_reward_claimed');
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.storeRewards = storeRewards;
})();
