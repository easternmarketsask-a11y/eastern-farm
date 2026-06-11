/**
 * home-report.js — 回家小报（spec 2026-06-09 ①）。
 *
 * 你离开 ≥2h 再回来时：结算"谁顺了你的菜 / 谁帮了你"，更新 lastActiveAt，
 * 然后用一张温馨"邻里公告栏"告诉你，并给每个小贼一个「去讨回来」入口。
 * 无事不弹、不指责、不施压。
 *
 *   Farm.homeReport.settleOnBoot()  开局结算(改 plots + 存 raidLog)，必须在 renderGrid 前调
 *   Farm.homeReport.maybeShow()     有事件就弹(自排队，避开其它开屏弹窗)
 */
(function () {
  let _pending = null;

  function cropName(cropId) {
    const def = Farm.crops && Farm.crops.get(cropId);
    if (!def) return '';
    return Farm.state.data.language === 'en' ? def.name_en : def.name_zh;
  }

  const homeReport = {
    // 开局一次性结算。读旧 lastActiveAt 算离开窗口 → settleRaid → 写新 lastActiveAt。
    settleOnBoot() {
      const data = Farm.state.data;
      const now = Date.now();
      const last = data.lastActiveAt || 0;
      if (!last) {
        // 首次加载（或老存档无此字段）：视为"现在"，绝不误判离开很久而被狂偷。
        data.lastActiveAt = now;
        Farm.state.save();
        return;
      }
      const awayMs = now - last;
      const events = (Farm.steal && Farm.steal.settleRaid)
        ? Farm.steal.settleRaid(awayMs)
        : { stolen: [], helped: [] };
      data.lastActiveAt = now;
      Farm.state.save();
      if ((events.stolen && events.stolen.length) || (events.helped && events.helped.length)) {
        _pending = events;
      }
    },

    hasPending() { return !!_pending; },

    // 真会员互偷结算（spec 2026-06-11）：登录后调用一次。拉取云端 stealEvents
    // → Farm.steal.settleRealEvents 验证清地 → 并入小报待弹队列 → 重渲染农场。
    async settleRealOnLogin() {
      if (!Farm.steal || !Farm.steal.settleRealEvents) return;
      try {
        // 一次读取拿全收件箱（偷菜+足迹），再分别结算——省一半登录读写。
        // fetchAndClearInbox 缺失时回落到各自拉取（老测试/降级路径）。
        let inbox = null;
        if (Farm.fbGameSync && Farm.fbGameSync.fetchAndClearInbox) {
          inbox = await Farm.fbGameSync.fetchAndClearInbox();
        }
        const events = await Farm.steal.settleRealEvents(inbox ? inbox.steals : undefined);
        // 来访足迹并入"邻里温情"：逐人最多列 4 条，更多归并为一行"还有 N 位"。
        // 同一访客多条足迹（跨几天没上线）按人去重。
        const visits = inbox
          ? inbox.visits
          : ((Farm.fbGameSync && Farm.fbGameSync.fetchAndClearVisitEvents)
              ? await Farm.fbGameSync.fetchAndClearVisitEvents() : []);
        {
          const seen = new Set();
          const uniq = [];
          visits.forEach(v => {
            if (!v || !v.visitorUid || seen.has(v.visitorUid)) return;
            seen.add(v.visitorUid);
            uniq.push(v);
          });
          uniq.slice(0, 4).forEach(v => {
            events.helped.push({ kind: 'visit', name: v.visitorName || '邻居', realUid: v.visitorUid });
          });
          if (uniq.length > 4) {
            events.helped.push({ kind: 'visit_more', n: uniq.length - 4 });
          }
        }
        const any = (events.stolen && events.stolen.length) || (events.helped && events.helped.length);
        if (!any) return;
        if (_pending) {
          _pending.stolen = (_pending.stolen || []).concat(events.stolen || []);
          _pending.helped = (_pending.helped || []).concat(events.helped || []);
        } else {
          _pending = events;
        }
        if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();  // 被清的地块即时反映
        Farm.ui.refreshHUD();
        this.maybeShow();
      } catch (e) {
        console.warn('[homeReport] settleRealOnLogin failed', e);
      }
    },

    // 自排队：若当前有别的弹窗开着（签到/教程），稍后再试，避免撞窗。
    maybeShow() {
      if (!_pending) return;
      const modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('hidden')) {
        setTimeout(() => this.maybeShow(), 1500);
        return;
      }
      this.show(_pending);
      _pending = null;
    },

    show(events) {
      const lang = Farm.state.data.language;
      const AN = Farm.aiNeighbors;
      // 事件可能来自 AI（带 aiId，查名册）或真会员（自带 name/realUid）。
      const nameOf = (e) => e.name || (AN && e.aiId ? AN.name(e.aiId) : (e.aiId || '邻居'));
      const avaOf = (e) => {
        if (e.realUid && Farm.neighbors && Farm.neighbors.avatarFor) return Farm.neighbors.avatarFor(e.realUid);
        return (AN && e.aiId) ? AN.avatar(e.aiId) : '🧑';
      };
      const revengeId = (e) => e.realUid ? ('real:' + e.realUid) : (e.aiId || '');

      // 坏消息（被顺）——每条带"去讨回来"
      const stolenHtml = (events.stolen || []).map((s) => `
        <div class="report-row report-bad">
          <span class="report-ava">${avaOf(s)}</span>
          <span class="report-text">${Farm.i18n.t('report_stolen', { name: nameOf(s), n: s.count, crop: cropName(s.cropId) })}</span>
          <button class="report-revenge-btn" data-revenge-btn="${revengeId(s)}" data-revenge-name="${(s.name || '').replace(/"/g, '')}">${Farm.i18n.t('report_revenge')}</button>
        </div>
      `).join('');

      // 好消息（互助 / 抓贼）
      const helpedHtml = (events.helped || []).map((h) => {
        let txt;
        if (h.kind === 'water') txt = Farm.i18n.t('report_help_water', { name: nameOf(h), crop: cropName(h.cropId) });
        else if (h.kind === 'caught') txt = Farm.i18n.t('report_caught', { name: nameOf(h), crop: cropName(h.cropId) });
        else if (h.kind === 'visit') txt = Farm.i18n.t('report_visit', { name: nameOf(h) });
        else if (h.kind === 'visit_more') {
          return `<div class="report-row report-good"><span class="report-ava">🐾</span><span class="report-text">${Farm.i18n.t('report_visit_more', { n: h.n })}</span></div>`;
        }
        else txt = Farm.i18n.t('report_help_coins', { name: nameOf(h), amount: h.amount });
        return `<div class="report-row report-good"><span class="report-ava">${avaOf(h)}</span><span class="report-text">${txt}</span></div>`;
      }).join('');

      const badSection = stolenHtml
        ? `<div class="report-section-title">${Farm.i18n.t('report_bad_header')}</div>${stolenHtml}` : '';
      const goodSection = helpedHtml
        ? `<div class="report-section-title">${Farm.i18n.t('report_good_header')}</div>${helpedHtml}` : '';

      const html = `
        <h2 class="modal-title">🏡 ${Farm.i18n.t('report_title')}</h2>
        <div class="report-list">
          ${goodSection}
          ${badSection}
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn" onclick="Farm.ui.hideModal()">${lang === 'en' ? 'Got it' : '知道啦'}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      if (Farm.audio) Farm.audio.play('tap');

      // 去讨回来：直达该小贼农场，并给一次额外宽限（多顺一棵心安理得）。
      // AI 贼 → 名册卡片；真人贼 → 'real:'+uid，viewFarm 自己会拉真快照。
      document.querySelectorAll('[data-revenge-btn]').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.revengeBtn;
          Farm.ui.hideModal();
          if (!id || !Farm.neighbors) return;
          if (id.indexOf('real:') === 0) {
            const uid = id.slice(5);
            if (Farm.steal && Farm.steal.grantGrace) Farm.steal.grantGrace(uid, 1);
            const emoji = (Farm.neighbors.avatarFor) ? Farm.neighbors.avatarFor(uid) : '🧑';
            Farm.neighbors.viewFarm({
              isReal: true, uid: uid, id: 'real_' + uid,
              name: btn.dataset.revengeName || (Farm.state.data.language === 'en' ? 'Neighbor' : '邻居'),
              emoji: emoji,
            });
          } else if (Farm.aiNeighbors) {
            if (Farm.steal && Farm.steal.grantGrace) Farm.steal.grantGrace(id, 1);
            Farm.neighbors.viewFarm(Farm.aiNeighbors.displayCard(id, Date.now()));
          }
        };
      });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.homeReport = homeReport;
})();
