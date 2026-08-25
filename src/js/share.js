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
  const W = 600, H = 760;
  const POSTER_H = 470;   // illustration hero height; cream panel fills the rest

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
      const EN = '"Plus Jakarta Sans","Quicksand",Arial,sans-serif';
      const FD = '"ZCOOL XiaoWei",' + CN;   // display font（小薇：精品农牌气质，2026-08-13 字体重设计）
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Wait for webfonts (ZCOOL XiaoWei / Noto Sans SC) before drawing —
      // otherwise canvas falls back to a system font with different metrics,
      // which makes centered text look subtly off-center. Best-effort.
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}

      // Background is Chris's full farm illustration (farm-poster.jpg). The
      // game name lives on a wooden sign over the illustration's clean sky;
      // the player's own crops show right in the illustration's garden.
      const [logo, poster] = await Promise.all([
        loadImage('assets/images/logo-horizontal-560.webp'),
        loadImage('assets/images/farm-poster.jpg'),
      ]);

      // ---- Poster hero (cover-fit into top region) ----
      // Shift the crop window rightward (frac 0.34) so the farmhouse sits in
      // the far-left corner — clear of the centered logo+sign over clean sky.
      if (poster) {
        const scale = Math.max(W / poster.width, POSTER_H / poster.height);
        const dw = poster.width * scale, dh = poster.height * scale;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, POSTER_H); ctx.clip();
        ctx.drawImage(poster, (W - dw) * 0.34, (POSTER_H - dh) * 0.5, dw, dh);
        ctx.restore();
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, POSTER_H);
        g.addColorStop(0, '#aee1f5'); g.addColorStop(1, '#7fb45e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, POSTER_H);
      }

      // ---- Cream content panel (overlaps the poster bottom a touch) ----
      ctx.save();
      ctx.shadowColor = 'rgba(60,40,20,0.28)';
      ctx.shadowBlur = 16; ctx.shadowOffsetY = -2;
      ctx.fillStyle = '#fffdf6';
      roundRect(ctx, 0, POSTER_H - 22, W, H - (POSTER_H - 22), 26);
      ctx.fill();
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // ---- Eastern Market logo on a small white chip, top center ----
      const logoW = 116;
      const logoH = logo ? logoW * (logo.height / logo.width) : 60;
      const lcW = logoW + 28, lcH = logoH + 16, lcX = (W - lcW) / 2, lcY = 14;
      ctx.save();
      ctx.shadowColor = 'rgba(40,40,40,0.3)';
      ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, lcX, lcY, lcW, lcH, 14);
      ctx.fill();
      ctx.restore();
      if (logo) ctx.drawImage(logo, (W - logoW) / 2, lcY + 8, logoW, logoH);

      // ---- Wooden sign over the illustration sky: GAME NAME hero ----
      const signCX = W / 2;
      const sgW = 328, sgH = 118, sgX = signCX - sgW / 2, sgY = 96;
      // hanging ropes
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sgX + 44, sgY - 14); ctx.lineTo(sgX + 60, sgY + 10);
      ctx.moveTo(sgX + sgW - 44, sgY - 14); ctx.lineTo(sgX + sgW - 60, sgY + 10); ctx.stroke();
      // plank: dark rim + wood gradient + inner border + screws
      ctx.save();
      ctx.shadowColor = 'rgba(40,25,10,0.4)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
      const wg = ctx.createLinearGradient(0, sgY, 0, sgY + sgH);
      wg.addColorStop(0, '#b3854f'); wg.addColorStop(1, '#855c38');
      ctx.fillStyle = '#5f3f24'; roundRect(ctx, sgX - 4, sgY + 4, sgW + 8, sgH, 18); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = wg; roundRect(ctx, sgX, sgY, sgW, sgH, 16); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,240,210,0.35)'; ctx.lineWidth = 2.5;
      roundRect(ctx, sgX + 12, sgY + 10, sgW - 24, sgH - 20, 11); ctx.stroke();
      ctx.fillStyle = '#5a3c22';
      [[sgX + 14, sgY + 14], [sgX + sgW - 14, sgY + 14], [sgX + 14, sgY + sgH - 14], [sgX + sgW - 14, sgY + sgH - 14]]
        .forEach(([cx, cy]) => { ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill(); });
      // 东方农场 (carved cream)
      ctx.save();
      ctx.shadowColor = 'rgba(60,38,18,0.6)'; ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#fff3dd'; ctx.font = '700 40px ' + FD;
      ctx.fillText('东方农场', signCX, sgY + 50);
      ctx.restore();
      ctx.font = '700 18px ' + EN;
      ctx.fillStyle = '#ffe7b8';
      ctx.fillText('Eastern Farm', signCX, sgY + 86);

      // ================= Cream content panel =================
      const md = (Farm.fbAuth && Farm.fbAuth.memberDoc) || {};
      const gsd = md.gameStats || {};
      const harvests = s.totalHarvests || 0;
      const likes = gsd.likesReceived || 0;
      const coins = s.coins || 0;
      const name = String(
        (Farm.fbGameSync && Farm.fbGameSync._selfDisplayName)
          ? Farm.fbGameSync._selfDisplayName()
          : (s.nickname || (ZH ? '我的农场' : 'My Farm'))
      ).slice(0, 12);
      const lv = s.level || 1;
      const initial = (name.match(/[A-Za-z0-9一-龥]/) || ['🌱'])[0];

      // Decorative flower (5 petals + center) to dress the panel's empty sides.
      const flower = (cx, cy, r, petal, mid) => {
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 / 5) * i - Math.PI / 2;
          ctx.fillStyle = petal;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = mid;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
      };
      const leaf = (cx, cy, dir) => {
        ctx.fillStyle = '#7bbf5b';
        ctx.beginPath(); ctx.ellipse(cx, cy, 9, 4.5, dir, 0, Math.PI * 2); ctx.fill();
      };
      // flowers flanking the side margins (text is centered + narrower)
      leaf(40, 540, -0.5); leaf(560, 540, 0.5);
      flower(38, 524, 24, '#ffd1dc', '#f6a93b');
      flower(66, 560, 16, '#fff1b8', '#f3923a');
      flower(562, 524, 24, '#ffc7d8', '#f6a93b');
      flower(534, 560, 16, '#fff1b8', '#f3923a');
      flower(34, 686, 20, '#f3c7ef', '#f6a93b');
      flower(566, 686, 20, '#ffd1dc', '#f6a93b');

      // ---- Player line (moved down into the text area) ----
      const pName = name + '  ·  Lv ' + lv;
      ctx.font = '700 18px ' + CN;
      const pNameW = ctx.measureText(pName).width;
      const pav = 30, pgap = 10, pTotal = pav + pgap + pNameW;
      const px = (W - pTotal) / 2, pcy = 502;
      ctx.fillStyle = '#7bbf5b';
      ctx.beginPath(); ctx.arc(px + pav / 2, pcy, pav / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 17px ' + CN; ctx.textAlign = 'center';
      ctx.fillText(initial, px + pav / 2, pcy + 6);
      ctx.textAlign = 'left'; ctx.fillStyle = '#5a4632'; ctx.font = '700 18px ' + CN;
      ctx.fillText(pName, px + pav + pgap, pcy + 6);
      ctx.textAlign = 'center';

      // ---- Stat chips (bigger) ----
      const chip2 = likes > 0
        ? { t: '❤️ 赞 Likes ' + likes, bg: '#fdeef0', fg: '#c0556a' }
        : { t: '🪙 农场币 Farm coins ' + coins.toLocaleString(), bg: '#fff6df', fg: '#a9791e' };
      const chips = [
        { t: '🌾 收获 Harvest ' + harvests, bg: '#f1f8e6', fg: '#5a7a2e' },
        chip2,
      ];
      const chipsY = 534;
      ctx.font = '700 19px ' + CN;
      const chipWs = chips.map(c => ctx.measureText(c.t).width + 34);
      const cgap = 14;
      let startX = (W - (chipWs[0] + chipWs[1] + cgap)) / 2;
      chips.forEach((c, i) => {
        const w = chipWs[i];
        ctx.fillStyle = c.bg;
        roundRect(ctx, startX, chipsY, w, 46, 23); ctx.fill();
        ctx.fillStyle = c.fg;
        ctx.fillText(c.t, startX + w / 2, chipsY + 30);
        startX += w + cgap;
      });

      // ---- CTA + URL + address (bigger text) ----
      ctx.fillStyle = '#2a5c34';
      ctx.font = '700 26px ' + FD;
      ctx.fillText('我在东方农场种菜', W / 2, 616);
      ctx.fillStyle = '#3a8c50';
      ctx.font = '700 16px ' + EN;
      ctx.fillText('Farming at Eastern Farm!', W / 2, 640);

      const ug = ctx.createLinearGradient(0, 660, 0, 710);
      ug.addColorStop(0, '#46a05f'); ug.addColorStop(1, '#2f7a45');
      ctx.save();
      ctx.shadowColor = 'rgba(47,122,69,0.4)';
      ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
      ctx.fillStyle = ug;
      roundRect(ctx, W / 2 - 178, 660, 356, 48, 24); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 22px ' + EN;
      ctx.fillText('farm.easternmarket.ca', W / 2, 691);

      ctx.fillStyle = '#8a7a5c';
      ctx.font = '500 14px ' + CN;
      ctx.fillText('📍 133-412 Willowgrove Square, Saskatoon', W / 2, 730);

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
        <h2 class="modal-title">${lang === 'en' ? 'Share my farm' : '晒我的农场'}</h2>
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
        <h2 class="modal-title">${lang === 'en' ? 'Share my farm' : '晒我的农场'}</h2>
        <p style="text-align:center;font-size:13px;color:var(--warm-text-soft);margin:2px 0 10px;line-height:1.5;">
          ${lang === 'en'
            ? 'Long-press the image → send to a chat / save.'
            : '长按下图 → 发送给朋友 / 保存到相册'}
        </p>
        <img id="shareCardImg" src="${dataUrl}" alt="farm card"
             style="width:100%;border-radius:14px;box-shadow:0 4px 16px rgba(90,60,30,0.2);display:block;"/>
        <div class="btn-row share-actions" style="margin-top:14px;gap:8px;flex-wrap:wrap;">
          ${canNativeShare ? `<button class="btn" id="shareNativeBtn" style="flex:1;">📤 ${lang === 'en' ? 'Share' : '分享'}</button>` : ''}
          <button class="btn secondary" id="shareDownloadBtn" style="flex:1;">⬇️ ${lang === 'en' ? 'Save' : '存图'}</button>
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
            title: lang === 'en' ? 'Eastern Farm' : '东方农场',
            text: lang === 'en' ? 'Come farm with me at Eastern Farm!' : '来东方农场一起种菜！',
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
