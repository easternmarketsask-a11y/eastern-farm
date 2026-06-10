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
      const nameOf = (id) => (AN ? AN.name(id) : id);
      const avaOf = (id) => (AN ? AN.avatar(id) : '🧑');

      // 坏消息（被顺）——每条带"去讨回来"
      const stolenHtml = (events.stolen || []).map((s, i) => `
        <div class="report-row report-bad" data-revenge="${s.aiId}">
          <span class="report-ava">${avaOf(s.aiId)}</span>
          <span class="report-text">${Farm.i18n.t('report_stolen', { name: nameOf(s.aiId), n: s.count, crop: cropName(s.cropId) })}</span>
          <button class="report-revenge-btn" data-revenge-btn="${s.aiId}">${Farm.i18n.t('report_revenge')}</button>
        </div>
      `).join('');

      // 好消息（互助 / 抓贼）
      const helpedHtml = (events.helped || []).map((h) => {
        let txt;
        if (h.kind === 'water') txt = Farm.i18n.t('report_help_water', { name: nameOf(h.aiId), crop: cropName(h.cropId) });
        else if (h.kind === 'caught') txt = Farm.i18n.t('report_caught', { name: nameOf(h.aiId), crop: cropName(h.cropId) });
        else txt = Farm.i18n.t('report_help_coins', { name: nameOf(h.aiId), amount: h.amount });
        return `<div class="report-row report-good"><span class="report-ava">${avaOf(h.aiId)}</span><span class="report-text">${txt}</span></div>`;
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

      // 去讨回来：直达该小贼农场，并给一次额外宽限（多顺一棵心安理得）
      document.querySelectorAll('[data-revenge-btn]').forEach(btn => {
        btn.onclick = () => {
          const aiId = btn.dataset.revengeBtn;
          Farm.ui.hideModal();
          if (Farm.steal && Farm.steal.grantGrace) Farm.steal.grantGrace(aiId, 1);
          if (Farm.neighbors && Farm.aiNeighbors) {
            Farm.neighbors.viewFarm(Farm.aiNeighbors.displayCard(aiId, Date.now()));
          }
        };
      });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.homeReport = homeReport;
})();
