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
      const EN = '"Plus Jakarta Sans","Quicksand",Arial,sans-serif';
      const FD = '"ZCOOL KuaiLe",' + CN;   // display font (rounded, playful)
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Wait for webfonts (ZCOOL KuaiLe / Noto Sans SC) before drawing —
      // otherwise canvas falls back to a system font with different metrics,
      // which makes centered text look subtly off-center. Best-effort.
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}

      // Preload art in parallel: logo + a curated, colorful crop showcase for
      // the hero field. (The active crop catalog starts with many look-alike
      // leafy greens; a hand-picked spread of shapes/colors reads far better:
      // green bok choy · orange carrot · purple eggplant · white radish ·
      // broccoli.) The whole decorative scene (sky/hills/farmhouse/fence/
      // grass/sign/soil tiles/bottom panel) is one static SVG rasterized in
      // a single pass — same visual language as the in-game farm scene band.
      const SHOWCASE = ['shanghai_miao', 'hu_luo_bo', 'eggplant', 'bai_luo_bo', 'xi_lan_hua'];
      // Soil tile geometry shared between the SVG backdrop and the canvas
      // pass that plants the crops on top.
      const TILE = 96, TGAP = 8;
      const tilesX = (W - (SHOWCASE.length * TILE + (SHOWCASE.length - 1) * TGAP)) / 2;
      const tilesY = 400;
      const soilTiles = SHOWCASE.map((_, i) =>
        `<g transform="translate(${tilesX + i * (TILE + TGAP)},${tilesY})">
           <rect x="0" y="6" width="${TILE}" height="78" rx="14" fill="#6f4a2c"/>
           <rect x="0" y="0" width="${TILE}" height="78" rx="14" fill="url(#soil)"/>
           <path d="M8 22 H88 M8 40 H88 M8 58 H88" stroke="rgba(78,48,26,0.35)" stroke-width="3" stroke-linecap="round"/>
           <path d="M8 25 H88 M8 43 H88 M8 61 H88" stroke="rgba(222,180,135,0.22)" stroke-width="1.5" stroke-linecap="round"/>
         </g>`).join('');
      const sceneSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#aee1f5"/><stop offset="0.6" stop-color="#cdeade"/><stop offset="1" stop-color="#d8efc8"/>
          </linearGradient>
          <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#a8d48a"/><stop offset="1" stop-color="#7fb45e"/>
          </linearGradient>
          <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#b08252"/><stop offset="1" stop-color="#8a6240"/>
          </linearGradient>
          <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#b98a5e"/><stop offset="1" stop-color="#84583a"/>
          </linearGradient>
        </defs>
        <rect width="${W}" height="330" fill="url(#sky)"/>
        <rect y="300" width="${W}" height="${H - 300}" fill="url(#grass)"/>
        <!-- sun -->
        <circle cx="510" cy="74" r="44" fill="#ffd95e" opacity="0.25"/>
        <circle cx="510" cy="74" r="29" fill="#ffd95e" opacity="0.95"/>
        <!-- clouds -->
        <g fill="#ffffff" opacity="0.9">
          <ellipse cx="92" cy="70" rx="30" ry="13"/><ellipse cx="122" cy="62" rx="24" ry="15"/><ellipse cx="146" cy="71" rx="18" ry="10"/>
          <ellipse cx="330" cy="46" rx="24" ry="10" opacity="0.75"/><ellipse cx="354" cy="40" rx="18" ry="11" opacity="0.75"/>
        </g>
        <!-- hills -->
        <path d="M0 268 Q 110 218 230 252 Q 360 286 470 240 Q 540 214 600 234 L 600 330 L 0 330 Z" fill="#9ccb7e" opacity="0.8"/>
        <path d="M0 292 Q 140 246 300 276 Q 450 304 600 270 L 600 340 L 0 340 Z" fill="#8bc06c"/>
        <!-- farmhouse (left) -->
        <g transform="translate(48,212)">
          <circle cx="58" cy="-4" r="5" fill="#fff" opacity="0.6"/>
          <circle cx="64" cy="-13" r="6.5" fill="#fff" opacity="0.4"/>
          <rect x="10" y="28" width="56" height="40" rx="4" fill="#f3e3c2" stroke="#caa873" stroke-width="2"/>
          <path d="M2 30 L38 4 L74 30 Z" fill="#d8694a" stroke="#b04f33" stroke-width="2"/>
          <rect x="31" y="44" width="14" height="24" rx="2" fill="#9a6b3f"/>
          <rect x="15" y="38" width="12" height="12" rx="2" fill="#cfe9f5" stroke="#caa873"/>
          <rect x="49" y="38" width="12" height="12" rx="2" fill="#cfe9f5" stroke="#caa873"/>
        </g>
        <!-- trees -->
        <g transform="translate(488,212)">
          <rect x="12" y="30" width="8" height="18" rx="3" fill="#8a6240"/>
          <circle cx="16" cy="19" r="19" fill="#5da253"/>
          <circle cx="5" cy="27" r="12" fill="#6cb15f"/>
          <circle cx="28" cy="27" r="12" fill="#6cb15f"/>
        </g>
        <g transform="translate(160,232) scale(0.7)">
          <rect x="12" y="30" width="8" height="18" rx="3" fill="#8a6240"/>
          <circle cx="16" cy="19" r="19" fill="#5da253"/>
          <circle cx="5" cy="27" r="12" fill="#6cb15f"/>
          <circle cx="28" cy="27" r="12" fill="#6cb15f"/>
        </g>
        <!-- fence -->
        <g stroke="#c8a06a" stroke-width="6" stroke-linecap="round">
          ${[12, 70, 128, 186, 244, 302, 360, 418, 476, 534, 588].map(x =>
            `<line x1="${x}" y1="300" x2="${x}" y2="338"/>`).join('')}
          <line x1="0" y1="310" x2="${W}" y2="310"/>
          <line x1="0" y1="327" x2="${W}" y2="327"/>
        </g>
        <!-- hanging wooden sign — carries the GAME NAME (快乐农场) as the hero -->
        <g transform="translate(0,8)">
          <line x1="208" y1="96" x2="224" y2="128" stroke="#8a6240" stroke-width="5" stroke-linecap="round"/>
          <line x1="392" y1="96" x2="376" y2="128" stroke="#8a6240" stroke-width="5" stroke-linecap="round"/>
          <rect x="106" y="124" width="388" height="118" rx="20" fill="#6f4a2c"/>
          <rect x="112" y="118" width="376" height="118" rx="18" fill="url(#wood)"/>
          <rect x="124" y="130" width="352" height="94" rx="12" fill="none" stroke="rgba(255,240,210,0.35)" stroke-width="2.5" stroke-dasharray="1 0"/>
          <circle cx="130" cy="136" r="4" fill="#5a3c22"/><circle cx="470" cy="136" r="4" fill="#5a3c22"/>
          <circle cx="130" cy="218" r="4" fill="#5a3c22"/><circle cx="470" cy="218" r="4" fill="#5a3c22"/>
        </g>
        <!-- soil tiles for the crop showcase -->
        ${soilTiles}
        <!-- little flowers scattered on the grass -->
        <g>
          <g transform="translate(36,368)"><circle r="6" fill="#ffd1dc"/><circle r="2.6" fill="#e8a23a"/></g>
          <g transform="translate(566,378)"><circle r="6" fill="#fff1b8"/><circle r="2.6" fill="#e8a23a"/></g>
          <g transform="translate(580,520)"><circle r="5" fill="#ffd1dc"/><circle r="2.2" fill="#e8a23a"/></g>
          <g transform="translate(22,512)"><circle r="5" fill="#fff1b8"/><circle r="2.2" fill="#e8a23a"/></g>
        </g>
        <!-- bottom cream panel -->
        <rect x="28" y="560" width="${W - 56}" height="206" rx="24" fill="rgba(90,60,30,0.18)" transform="translate(0,6)"/>
        <rect x="28" y="560" width="${W - 56}" height="206" rx="24" fill="#fffdf6"/>
        <rect x="34" y="566" width="${W - 68}" height="194" rx="20" fill="none" stroke="rgba(106,176,76,0.35)" stroke-width="2"/>
      </svg>`;

      const [logo, sceneImg, cropImgs] = await Promise.all([
        loadImage('assets/images/logo-horizontal.png'),
        svgToImage(sceneSvg),
        Promise.all(SHOWCASE.map(id => svgToImage(Farm.cropArt.icon(id, 110)))),
      ]);

      // ---- Scene backdrop (with plain-gradient fallback if SVG raster fails) ----
      if (sceneImg) {
        ctx.drawImage(sceneImg, 0, 0, W, H);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#aee1f5'); g.addColorStop(0.4, '#cdeade'); g.addColorStop(1, '#7fb45e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // ---- Eastern Market logo on a small white chip, top center ----
      // Logo stands alone; the game name 快乐农场 lives on the sign below.
      const logoW = 116;
      const logoH = logo ? logoW * (logo.height / logo.width) : 60;
      const lcW = logoW + 28;
      const lcH = logoH + 16;
      const lcX = (W - lcW) / 2, lcY = 14;
      ctx.save();
      ctx.shadowColor = 'rgba(90,60,30,0.25)';
      ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, lcX, lcY, lcW, lcH, 14);
      ctx.fill();
      ctx.restore();
      if (logo) ctx.drawImage(logo, (W - logoW) / 2, lcY + 8, logoW, logoH);

      // ---- GAME NAME as the hero, carved on the wooden sign ----
      // This poster promotes the GAME, so 快乐农场 / HAPPY FARM is the focal
      // point on the sign — not the individual player.
      const signCX = W / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(60,38,18,0.55)';
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#fff3dd';
      ctx.font = '700 42px ' + FD;
      ctx.fillText('快乐农场', signCX, 188);
      ctx.restore();
      // "HAPPY FARM" — letter-spaced under the Chinese name
      (function () {
        const txt = 'HAPPY FARM', ls = 3;
        ctx.font = '700 14px ' + EN;
        ctx.fillStyle = '#ffd9a0';
        let total = -ls;
        for (const ch of txt) total += ctx.measureText(ch).width + ls;
        let x = signCX - total / 2;
        ctx.textAlign = 'left';
        for (const ch of txt) { ctx.fillText(ch, x, 214); x += ctx.measureText(ch).width + ls; }
        ctx.textAlign = 'center';
      })();

      // ---- Player info, DOWN-PLAYED: small muted line below the sign ----
      // (Personal name/level is secondary; the card sells the game, not the
      // individual.) 🌱 is a single glyph (no ZWJ width quirk).
      const name = String(
        (Farm.fbGameSync && Farm.fbGameSync._selfDisplayName)
          ? Farm.fbGameSync._selfDisplayName()
          : (s.nickname || (ZH ? '我的农场' : 'My Farm'))
      ).slice(0, 12);
      const lv = s.level || 1;
      ctx.fillStyle = '#5f5240';
      ctx.font = '500 15px ' + CN;
      ctx.fillText('🌱 ' + name + ' · Lv ' + lv, signCX, 288);

      // ---- Crops planted on the soil tiles (drawn over the SVG tiles) ----
      cropImgs.forEach((img, i) => {
        if (!img) return;
        const cx = tilesX + i * (TILE + TGAP) + TILE / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(60,35,15,0.35)';
        ctx.shadowBlur = 6; ctx.shadowOffsetY = 4;
        ctx.drawImage(img, cx - 52, tilesY - 44, 104, 104);
        ctx.restore();
      });

      // ---- Stat chips (harvests + likes/coins) on the grass ----
      const md = (Farm.fbAuth && Farm.fbAuth.memberDoc) || {};
      const gsd = md.gameStats || {};
      const harvests = s.totalHarvests || 0;
      const likes = gsd.likesReceived || 0;
      const coins = s.coins || 0;
      // Bilingual stat chips. Second chip: likes only when there are some (a
      // "0 赞" looks sad on a brag card) — otherwise farm coins, always positive.
      const chip2 = likes > 0
        ? { t: '❤️ 赞 Likes ' + likes, fg: '#c0556a' }
        : { t: '🪙 金币 Coins ' + coins.toLocaleString(), fg: '#a9791e' };
      const chips = [
        { t: '🌾 收获 Harvest ' + harvests, fg: '#5a7a2e' },
        chip2,
      ];
      ctx.font = '700 18px ' + CN;
      const chipWs = chips.map(c => ctx.measureText(c.t).width + 32);
      const cgap = 14;
      let startX = (W - (chipWs[0] + chipWs[1] + cgap)) / 2;
      chips.forEach((c, i) => {
        const w = chipWs[i];
        ctx.save();
        ctx.shadowColor = 'rgba(70,50,20,0.22)';
        ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
        ctx.fillStyle = '#fffdf6';
        roundRect(ctx, startX, 500, w, 42, 21); ctx.fill();
        ctx.restore();
        ctx.fillStyle = c.fg;
        ctx.fillText(c.t, startX + w / 2, 528);
        startX += w + cgap;
      });

      // ---- Bottom panel: bilingual CTA + URL + address ----
      ctx.fillStyle = '#2a5c34';
      ctx.font = '700 22px ' + FD;
      ctx.fillText('我在东方超市·快乐农场种菜啦！', W / 2, 600);
      ctx.fillStyle = '#3a8c50';
      ctx.font = '700 15px ' + EN;
      ctx.fillText('Farming at Eastern Market · Happy Farm!', W / 2, 622);
      ctx.fillStyle = '#7a6a4a';
      ctx.font = '500 14px ' + CN;
      ctx.fillText('打开链接一起种菜 · Open the link & join me 🌱', W / 2, 648);

      const ug = ctx.createLinearGradient(0, 664, 0, 706);
      ug.addColorStop(0, '#46a05f'); ug.addColorStop(1, '#2f7a45');
      ctx.save();
      ctx.shadowColor = 'rgba(47,122,69,0.4)';
      ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      ctx.fillStyle = ug;
      roundRect(ctx, W / 2 - 172, 664, 344, 42, 21); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 19px ' + EN;
      ctx.fillText('farm.easternmarket.ca', W / 2, 692);

      ctx.fillStyle = '#8a7a5c';
      ctx.font = '500 13px ' + CN;
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
