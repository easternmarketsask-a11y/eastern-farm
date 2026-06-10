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

  // Rasterize an SVG string (e.g. a crop sprite from cropArt.svg) into an
  // <img> so it can be drawn on the canvas. cropArt.svg() already includes the
  // xmlns, so the blob loads as an image. Emoji-on-canvas was unreliable
  // across devices — real crop SVGs render identically everywhere.
  function svgToImage(svgString) {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
        img.onerror = () => resolve(null);
        img.src = url;
      } catch (e) { resolve(null); }
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
      const ZH = lang !== 'en';
      const CN = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Preload art in parallel: logo + a curated, colorful crop showcase for
      // the mini-field. (The active crop catalog starts with many look-alike
      // leafy greens; a hand-picked spread of shapes/colors reads far better:
      // green bok choy · orange carrot · purple eggplant · white radish ·
      // broccoli.)
      const SHOWCASE = ['shanghai_miao', 'hu_luo_bo', 'eggplant', 'bai_luo_bo', 'xi_lan_hua'];
      const [logo, cropImgs] = await Promise.all([
        loadImage('assets/images/logo-horizontal.png'),
        Promise.all(SHOWCASE.map(id => svgToImage(Farm.cropArt.icon(id, 80)))),
      ]);

      // ---- Background: sky → grass, with sun + soft clouds ----
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#bfe6f5');
      g.addColorStop(0.34, '#d9eee2');
      g.addColorStop(0.62, '#cfe8a8');
      g.addColorStop(1, '#9ccb6e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,228,150,0.95)';
      ctx.beginPath(); ctx.arc(520, 84, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const cloud = (cx, cy, sc) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 18 * sc, 0, Math.PI * 2);
        ctx.arc(cx + 22 * sc, cy + 4 * sc, 14 * sc, 0, Math.PI * 2);
        ctx.arc(cx - 20 * sc, cy + 5 * sc, 13 * sc, 0, Math.PI * 2);
        ctx.fill();
      };
      cloud(120, 92, 1); cloud(300, 64, 0.7);

      // ---- White content card ----
      ctx.save();
      ctx.shadowColor = 'rgba(90,60,30,0.22)';
      ctx.shadowBlur = 28; ctx.shadowOffsetY = 10;
      ctx.fillStyle = '#fffdf6';
      roundRect(ctx, 36, 44, W - 72, H - 108, 30);
      ctx.fill();
      ctx.restore();
      // inner hairline border
      ctx.strokeStyle = 'rgba(106,176,76,0.35)';
      ctx.lineWidth = 2;
      roundRect(ctx, 42, 50, W - 84, H - 120, 26);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // ---- Logo + title ----
      if (logo) {
        const lw = 168, lh = lw * (logo.height / logo.width || 0.28);
        ctx.drawImage(logo, (W - lw) / 2, 76, lw, lh);
      }
      ctx.fillStyle = '#2a5c34';
      ctx.font = '700 30px ' + CN;
      ctx.fillText('快乐农场', W / 2, 168);
      ctx.fillStyle = '#E8522A';
      ctx.font = '700 13px Arial,sans-serif';
      ctx.save(); ctx.translate(W / 2, 188);
      ctx.fillText('H A P P Y   F A R M', 0, 0); ctx.restore();

      // ---- Avatar in a soft ring ----
      ctx.fillStyle = '#eaf6dc';
      ctx.beginPath(); ctx.arc(W / 2, 250, 48, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a6d178'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W / 2, 250, 48, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText('🧑‍🌾', W / 2, 272);

      // ---- Nickname ----
      const name = (Farm.fbGameSync && Farm.fbGameSync._selfDisplayName)
        ? Farm.fbGameSync._selfDisplayName()
        : (s.nickname || (ZH ? '我的农场' : 'My Farm'));
      ctx.fillStyle = '#3a2c18';
      ctx.font = '800 34px ' + CN;
      ctx.fillText(String(name).slice(0, 12), W / 2, 342);

      // ---- Level + title chip ----
      const lv = s.level || 1;
      const t = Farm.state.levelTitle ? Farm.state.levelTitle(lv) : null;
      const titleStr = t ? (ZH ? t.zh : t.en) : '';
      const lvText = 'Lv ' + lv + (titleStr ? ' · ' + titleStr : '');
      ctx.font = '700 20px ' + CN;
      const lvW = ctx.measureText(lvText).width + 36;
      ctx.fillStyle = '#3a8c50';
      roundRect(ctx, W / 2 - lvW / 2, 360, lvW, 36, 18); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(lvText, W / 2, 384);

      // ---- Stat chips (harvests + likes) ----
      const md = (Farm.fbAuth && Farm.fbAuth.memberDoc) || {};
      const gsd = md.gameStats || {};
      const harvests = s.totalHarvests || 0;
      const likes = gsd.likesReceived || 0;
      const coins = s.coins || 0;
      // Second chip: show likes only when there are some (a "0 赞" looks sad on a
      // brag card) — otherwise show farm coins, which is always a positive number.
      const chip2 = likes > 0
        ? { t: '❤️ ' + likes + (ZH ? ' 赞' : ' likes'), bg: '#fdeef0', fg: '#c0556a' }
        : { t: '🪙 ' + coins.toLocaleString(), bg: '#fff6df', fg: '#a9791e' };
      const chips = [
        { t: '🌾 ' + (ZH ? '收获 ' : 'Harvest ') + harvests, bg: '#f1f8e6', fg: '#5a7a2e' },
        chip2,
      ];
      ctx.font = '600 19px ' + CN;
      const chipW = chips.map(c => ctx.measureText(c.t).width + 30);
      const gap = 14;
      let startX = (W - (chipW[0] + chipW[1] + gap)) / 2;
      chips.forEach((c, i) => {
        const w = chipW[i];
        ctx.fillStyle = c.bg;
        roundRect(ctx, startX, 418, w, 40, 20); ctx.fill();
        ctx.fillStyle = c.fg;
        ctx.fillText(c.t, startX + w / 2, 444);
        startX += w + gap;
      });

      // ---- Mini farm field: a grass strip with soil plots + real crop art ----
      const fieldX = 70, fieldY = 482, fieldW = W - 140, fieldH = 118;
      const fg2 = ctx.createLinearGradient(0, fieldY, 0, fieldY + fieldH);
      fg2.addColorStop(0, '#d6efb0'); fg2.addColorStop(1, '#b6dd84');
      ctx.fillStyle = fg2;
      roundRect(ctx, fieldX, fieldY, fieldW, fieldH, 18); ctx.fill();
      const n = Math.max(1, cropImgs.length);
      const tile = 72, tgap = (fieldW - 24 - n * tile) / Math.max(1, n - 1 || 1);
      let tx = fieldX + 12 + (n === 1 ? (fieldW - 24 - tile) / 2 : 0);
      const ty = fieldY + (fieldH - tile) / 2 - 2;
      for (let i = 0; i < n; i++) {
        // soil tile
        const sg = ctx.createLinearGradient(0, ty, 0, ty + tile);
        sg.addColorStop(0, '#b78657'); sg.addColorStop(1, '#7a5230');
        ctx.fillStyle = sg;
        roundRect(ctx, tx, ty + 18, tile, tile - 18, 12); ctx.fill();
        ctx.strokeStyle = '#5e3b22'; ctx.lineWidth = 1.5;
        roundRect(ctx, tx, ty + 18, tile, tile - 18, 12); ctx.stroke();
        // crop art sitting on the tile (slightly larger, poking up from soil)
        const img = cropImgs[i];
        if (img) ctx.drawImage(img, tx - 2, ty - 12, tile + 4, tile + 4);
        tx += tile + (isFinite(tgap) ? tgap : 0);
      }

      // ---- CTA ----
      ctx.fillStyle = '#2a5c34';
      ctx.font = '700 21px ' + CN;
      ctx.fillText(ZH ? '我在东方超市·快乐农场种菜啦！' : 'Farming at Eastern Market!', W / 2, 648);
      ctx.fillStyle = '#7a6a4a';
      ctx.font = '500 16px ' + CN;
      ctx.fillText(ZH ? '打开链接，一起来种菜 🌱' : 'Open the link and join me 🌱', W / 2, 676);

      // ---- URL pill ----
      const ug = ctx.createLinearGradient(0, 696, 0, 738);
      ug.addColorStop(0, '#46a05f'); ug.addColorStop(1, '#2f7a45');
      ctx.fillStyle = ug;
      roundRect(ctx, W / 2 - 168, 696, 336, 42, 21); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 19px Arial,sans-serif';
      ctx.fillText('farm.easternmarket.ca', W / 2, 723);

      // ---- Footer: real store address (helps the card drive foot traffic) ----
      ctx.fillStyle = '#8a7a5c';
      ctx.font = '500 14px ' + CN;
      ctx.fillText('📍 133-412 Willowgrove Square, Saskatoon', W / 2, 762);

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
