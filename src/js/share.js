/**
 * share.js — "晒农场" share card. Renders a personalized poster of the player's
 * farm (nickname, level/title, harvests, likes) onto a canvas, then shows it so
 * the player can share to WeChat.
 *
 * WeChat reality: an in-app web page CANNOT trigger WeChat's native share sheet
 * without an Official-Account JS-SDK signature (which we don't have). What DOES
 * work everywhere is WeChat's built-in "long-press an image → 发送给朋友 / 保存 /
 * 识别二维码". So we render the card to a real <img> and tell the player to
 * long-press it. Outside WeChat (Safari/Chrome) we also offer the native share
 * sheet (navigator.share with the PNG file) + a download button.
 *
 * Pure client-side, no backend. Uses the player's local state + member doc.
 */
(function () {
  const GAME_URL = 'https://farm.easternmarket.ca';
  const W = 600, H = 800;

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);   // non-fatal: skip the logo if it fails
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const share = {
    _lastBlob: null,

    // Render the poster; returns a dataURL (PNG).
    async _renderCard() {
      const s = Farm.state.data;
      const lang = s.language || 'zh';
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Background: sky → grass gradient (matches the farm scene).
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#bfe5f4');
      g.addColorStop(0.30, '#d9eee2');
      g.addColorStop(0.55, '#cfe8a8');
      g.addColorStop(1, '#a4cf76');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // a soft sun
      ctx.fillStyle = 'rgba(255,233,168,0.9)';
      ctx.beginPath(); ctx.arc(510, 90, 36, 0, Math.PI * 2); ctx.fill();

      // White content card
      ctx.save();
      ctx.shadowColor = 'rgba(90,60,30,0.18)';
      ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
      ctx.fillStyle = 'rgba(255,253,246,0.96)';
      roundRect(ctx, 40, 48, W - 80, H - 116, 28);
      ctx.fill();
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // Logo (centered) — optional
      const logo = await loadImage('assets/images/logo-horizontal.png');
      if (logo) {
        const lw = 180, lh = lw * (logo.height / logo.width || 0.28);
        ctx.drawImage(logo, (W - lw) / 2, 78, lw, lh);
      }

      // Title
      ctx.fillStyle = '#2a5c34';
      ctx.font = '700 30px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('快乐农场', W / 2, 168);
      ctx.fillStyle = '#E8522A';
      ctx.font = '600 14px Arial,sans-serif';
      ctx.fillText('HAPPY FARM', W / 2, 190);

      // Avatar
      ctx.font = '72px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
      ctx.fillText('🧑‍🌾', W / 2, 290);

      // Nickname
      const name = (Farm.fbGameSync && Farm.fbGameSync._selfDisplayName)
        ? Farm.fbGameSync._selfDisplayName()
        : (s.nickname || '我的农场');
      ctx.fillStyle = '#3a2c18';
      ctx.font = '700 34px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(String(name).slice(0, 12), W / 2, 350);

      // Level + title
      const lv = s.level || 1;
      const t = Farm.state.levelTitle ? Farm.state.levelTitle(lv) : null;
      const titleStr = t ? (lang === 'en' ? t.en : t.zh) : '';
      ctx.fillStyle = '#3a8c50';
      ctx.font = '600 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('Lv ' + lv + (titleStr ? ' · ' + titleStr : ''), W / 2, 388);

      // Stats line
      const md = (Farm.fbAuth && Farm.fbAuth.memberDoc) || {};
      const gs = md.gameStats || {};
      const harvests = s.totalHarvests || 0;
      const likes = gs.likesReceived || 0;
      ctx.fillStyle = '#6b5a3c';
      ctx.font = '500 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('🌾 收获 ' + harvests + '    ❤️ ' + likes, W / 2, 446);

      // Crop deco row
      ctx.font = '40px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
      ctx.fillText('🥬  🍅  🥒  🌶️  🍆  🌽', W / 2, 520);

      // CTA
      ctx.fillStyle = '#2a5c34';
      ctx.font = '600 21px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('我在东方超市·快乐农场种菜啦！', W / 2, 590);
      ctx.fillStyle = '#6b5a3c';
      ctx.font = '500 17px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('扫码或打开链接，一起来玩 🌱', W / 2, 622);

      // URL pill
      ctx.fillStyle = '#3a8c50';
      roundRect(ctx, W / 2 - 165, 644, 330, 40, 20);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 18px Arial,sans-serif';
      ctx.fillText('farm.easternmarket.ca', W / 2, 670);

      // Footer
      ctx.fillStyle = '#8a7a5c';
      ctx.font = '500 14px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('🏪 Eastern Market 东方超市 · Saskatoon', W / 2, 712);

      // Capture a blob for native sharing (best-effort).
      try {
        await new Promise((resolve) => {
          canvas.toBlob((b) => { this._lastBlob = b; resolve(); }, 'image/png');
        });
      } catch (e) { this._lastBlob = null; }

      return canvas.toDataURL('image/png');
    },

    async open() {
      const lang = Farm.state.data.language || 'zh';
      // Loading modal while we render.
      Farm.ui.showModal(`
        <h2 class="modal-title">📸 ${lang === 'en' ? 'Share my farm' : '晒我的农场'}</h2>
        <div style="text-align:center;padding:30px 16px;color:var(--warm-text-soft);">⏳ ${lang === 'en' ? 'Making your card…' : '生成卡片中…'}</div>
      `);

      let dataUrl;
      try {
        dataUrl = await this._renderCard();
      } catch (e) {
        Farm.ui.toast(lang === 'en' ? 'Could not make the card.' : '生成卡片失败,请重试');
        return;
      }

      const canNativeShare = !!(navigator.share && navigator.canShare && this._lastBlob &&
        navigator.canShare({ files: [new File([this._lastBlob], 'farm.png', { type: 'image/png' })] }));

      const html = `
        <h2 class="modal-title">📸 ${lang === 'en' ? 'Share my farm' : '晒我的农场'}</h2>
        <p style="text-align:center;font-size:13px;color:var(--warm-text-soft);margin:2px 0 10px;line-height:1.5;">
          ${lang === 'en'
            ? 'Long-press the image → send to a chat / save.'
            : '长按下图 → 发送给朋友 / 保存到相册'}
        </p>
        <img id="shareCardImg" src="${dataUrl}" alt="farm card"
             style="width:100%;border-radius:14px;box-shadow:0 4px 16px rgba(90,60,30,0.2);display:block;"/>
        <div class="btn-row" style="margin-top:14px;gap:8px;flex-wrap:wrap;">
          ${canNativeShare ? `<button class="btn" id="shareNativeBtn" style="flex:1;">📤 ${lang === 'en' ? 'Share' : '分享'}</button>` : ''}
          <button class="btn secondary" id="shareDownloadBtn" style="flex:1;">⬇️ ${lang === 'en' ? 'Save' : '下载图片'}</button>
          <button class="btn secondary" id="shareCopyBtn" style="flex:1;">🔗 ${lang === 'en' ? 'Copy link' : '复制链接'}</button>
        </div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn secondary" onclick="Farm.ui.hideModal()" style="width:100%;">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      if (Farm.audio) Farm.audio.play('tap');

      const nativeBtn = document.getElementById('shareNativeBtn');
      if (nativeBtn) nativeBtn.onclick = async () => {
        try {
          const file = new File([this._lastBlob], 'eastern-farm.png', { type: 'image/png' });
          await navigator.share({
            files: [file],
            title: '东方超市·快乐农场',
            text: lang === 'en' ? 'Come farm with me at Eastern Market!' : '来东方超市快乐农场一起种菜！',
            url: GAME_URL,
          });
        } catch (e) { /* user cancelled / unsupported — ignore */ }
      };

      const dlBtn = document.getElementById('shareDownloadBtn');
      if (dlBtn) dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'eastern-farm.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        Farm.ui.toast(lang === 'en' ? 'Saved' : '已下载,可发到微信', 2000);
      };

      const copyBtn = document.getElementById('shareCopyBtn');
      if (copyBtn) copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(GAME_URL);
          Farm.ui.toast(lang === 'en' ? 'Link copied' : '链接已复制', 1800);
        } catch (e) {
          Farm.ui.toast(GAME_URL, 3000);
        }
      };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.share = share;
})();
