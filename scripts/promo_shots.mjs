#!/usr/bin/env node
/**
 * promo_shots.mjs — 宣传用「精修画面」渲染器（2026-08-15）
 *
 * Chris：「很多游戏的宣传图比真正游戏中的画面要靓丽得多，我们也需要几张。」
 * 商业游戏那些商店页大图，做法就是**把游戏摆到最好看再截**——满级的家、
 * 种满成熟作物的地、水塘小路、小动物、路人，然后隐藏全部 UI、超采样渲染。
 * 好处是：顾客点进来看到的就是这个，不会货不对板（AI 插画 key art 另走
 * Gemini 流程，见 docs/PROMO-KEY-ART-PROMPTS.md）。
 *
 * 用法:
 *   本地起服务器后  node scripts/promo_shots.mjs [outDir] [baseUrl]
 * 产出（全部 2× 超采样）:
 *   hero-portrait.png   1080×1920  朋友圈 / 海报底图 / 手机全屏
 *   hero-square.png     1200×1200  微信分享缩略 / og:image
 *   hero-landscape.png  1920×1080  网站横幅 / 电视屏
 *   hero-wide.png       2400×1000  超宽横幅
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] || 'promo_shots';
const BASE = process.argv[3] || 'http://127.0.0.1:8123/src/index.html';
const PORT = 9500 + (process.pid % 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const SIZES = [
  // zoom = 在 _autoFrame 基础上的放大倍率；dy = 相机纵向微调（正数把画面内容往上推）
  // dy 正数 = 画面内容上移；dx 正数 = 画面内容左移（把右侧的谷仓收进画面）
  { name: 'hero-portrait',  w: 540,  h: 960,  dsf: 2, zoom: 1.12, dy: 30, dx: 30 },
  { name: 'hero-square',    w: 600,  h: 600,  dsf: 2, zoom: 1.16, dy: 30, dx: 20 },
  { name: 'hero-landscape', w: 960,  h: 540,  dsf: 2, zoom: 1.34, dy: 22, dx: 10 },
  { name: 'hero-wide',      w: 1200, h: 500,  dsf: 2, zoom: 1.28, dy: 18, dx: 5 },
];

/* 展示用农场：地扩满、地块摆成整齐一片、种满**成熟**且颜色各异的菜、
   建筑环绕、水塘小路、灯笼花丛、小动物、摊前有客人。 */
const SHOWCASE = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.Farm && Farm.isoView && Farm.crops && Farm.crops.loaded); i++) await sleep(150);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(600);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight._active) Farm.spotlight.skip();
  Farm.ui.hideModal();
  const d = Farm.state.data;
  d.tutorialV1Done = true; d.spotlightDone = true; d.petsEnabled = true;
  d.language = 'zh'; d.level = 25; d.coins = 99999; d.eastPoints = 880;
  d.nickname = '东方农场';
  d.lifeStory = { seen: { ch1:1,ch2:1,ch3:1,ch4:1,ch5:1,ch6:1 }, claimed: {} };  // 别让来信弹窗挡镜头
  d.landLevel = 4;

  // ---- 地块：5 列 × 4 行整齐一片，全部种上成熟的菜（颜色错开）----
  const CROPS = ['shanghai_miao','hu_luo_bo','eggplant','bo_cai','niu_jiao_jiao','xiao_cong',
                 'da_bai_cai','cai_xin','xi_lan_hua','bai_luo_bo','jiucai','tong_hao',
                 'wa_wa_cai','you_mai_cai','cilantro','dong_gua','wo_sun','ji_mao_cai',
                 'suan_tai','tomato','you_mai_cai','cai_xin','bo_cai','hu_luo_bo'];
  const OX = 4, OY = 4, W = 6;
  d.plots = CROPS.map((cid, i) => {
    const def = Farm.crops.get(cid);
    const grow = (def && def.grow_minutes) || 30;
    return { id: i, unlocked: true, gx: OX + (i % W), gy: OY + Math.floor(i / W),
             crop: cid, plantedAt: Date.now() - grow * 60000 - 60000,   // 已成熟
             harvestsLeft: 0, watered: true };
  });

  // ---- 建筑：围着菜地摆一圈，留出前景 ----
  d.map = [
    { type: 'home', gx: 1, gy: 2, lv: 5 },      // 满级的家：彩旗 + 金色灯串
    { type: 'coop', gx: 1, gy: 5 },
    { type: 'barn', gx: 11, gy: 2 },
    { type: 'greenhouse', gx: 11, gy: 5 },
    { type: 'house', gx: 7, gy: 9 },            // 菜摊 —— 乡路自动从摊前过（此时路带 y≈10.3–11.7）
    { type: 'well', gx: 10, gy: 8 },
    { type: 'wheel', gx: 3, gy: 9 },            // 水车紧挨水塘东岸
    { type: 'lantern', gx: 6, gy: 10 },         // 路灯：立在乡路北侧，不压路面
    // 后景树排做纵深 + 两侧收口（收窄到 x≤13，别被画面切掉）
    { type: 'tree', gx: 0, gy: 0 }, { type: 'tree', gx: 4, gy: 0 },
    { type: 'tree', gx: 8, gy: 0 }, { type: 'tree', gx: 12, gy: 0 },
    { type: 'tree', gx: 13, gy: 4 }, { type: 'tree', gx: 13, gy: 8 },
    { type: 'tree', gx: 0, gy: 8 },
    { type: 'bush', gx: 10, gy: 1 }, { type: 'bush', gx: 3, gy: 8 },
    { type: 'bush', gx: 12, gy: 7 }, { type: 'bush', gx: 0, gy: 4 },
    { type: 'fence', gx: 13, gy: 1 }, { type: 'fence', gx: 13, gy: 2 },
  ];

  // ---- 地形：水塘 + 一条小路 ----
  /* 🔒 水塘必须避开乡路（2026-08-15 Chris:「不要把水塘放在马路上」）。
     路 = A(24,9.8) → 菜摊前 B(gx+0.7, gy+2.5) → C(B.x-15, B.y+3.4)，
     摊在 (8,9) 时路带落在 y≈11.3–12.7；到 x=1..4 已南移到 y≈13.3。
     所以塘放 (1..3, 9..11)：在路的**北侧**前景，构成 菜地→水塘→乡路 的层次。 */
  d.mapTerrain = {};
  for (let x = 0; x <= 2; x++) for (let y = 9; y <= 11; y++) d.mapTerrain[x + ',' + y] = 'water';
  d.mapTerrain['3,10'] = 'water';

  // ---- 小动物：分散在院子里 ----
  d.decorations = [];
  Farm.state.addDecoration('pet_chick');
  Farm.state.addDecoration('pet_cat');
  Farm.state.addDecoration('decoration_dog');
  Farm.state.addDecoration('pet_duck');
  const spots = [[9,8],[3,3],[8,11],[1,10]];   // 鸡在地头、猫在井边、狗在摊前、鸭在塘里
  (d.decorations || []).forEach((dec, i) => { if (spots[i]) { dec.gx = spots[i][0]; dec.gy = spots[i][1]; } });

  // ---- 菜摊前站个客人（有人烟才像活的农场）----
  d.stall = d.stall || {};
  d.stall.customer = { crop: 'shanghai_miao', qty: 2, price: 36, pct: 45,
    face: '🧑', zh: '路人', en: 'Passerby', expireAt: Date.now() + 60 * 60000, real: false };
  d.stall.sold = 128;

  Farm.state.save();

  // ---- 隐藏全部 UI，只留画面；#app 解除 480px 上限好让画布吃满宽屏 ----
  const css = document.createElement('style');
  css.textContent = \`
    #topbar, #bottombar, #statusbar, .harvest-status-bar, #storekeeper, #isoBuildBtn,
    #modal, #toastStack, .zoom-btn, #isoZoomIn, #isoZoomOut, [class*="pwa"],
    .nav-badge, #navBadge, .today-button, .hamburger-button, [id*="Zoom"], [class*="zoom"] { display: none !important; }
    #app { max-width: none !important; width: 100% !important; }
    #farm, canvas { width: 100% !important; }
  \`;
  document.head.appendChild(css);
  window.dispatchEvent(new Event('resize'));
  await sleep(300);
  if (Farm.isoView._resize) Farm.isoView._resize();
  Farm.isoView._buildLayout && Farm.isoView._buildLayout();
  Farm.isoView._autoFrame();
  Farm.isoView.render();
  // 贴图是懒加载的（作物精灵/动物/建筑），多刷几帧等它们到齐
  for (let i = 0; i < 14; i++) { await sleep(420); Farm.isoView.render(); }
  return 'ok';
})()`;

const FRAME = (zoomMul, dy, dx) => `(async () => {
  const V = Farm.isoView;
  V._autoFrame();
  V._zoomAt(V._cssW() / 2, V._cssH() * 0.55, V._zoom * ${zoomMul});
  V._camY += ${dy}; V._camX += ${dx};
  V._clampCam(); V.render();
  await new Promise(r => setTimeout(r, 700));
  V.render();
  return { zoom: +V._zoom.toFixed(2), camY: Math.round(V._camY) };
})()`;

const profile = mkdtempSync(join(tmpdir(), 'ef-promo-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
   '--no-first-run', '--disable-gpu', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
  { stdio: 'ignore' });

let ws, id = 0; const pending = new Map();
const call = (method, params) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = (expr) => call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  .then((r) => r && r.result ? r.result.value : undefined).catch(() => undefined);

for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await call('Page.enable'); await call('Runtime.enable');

for (const s of SIZES) {
  await call('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: s.dsf, mobile: false });
  await call('Page.navigate', { url: BASE });
  await sleep(2200);
  // 绕开 SW 缓存，永远拍当前磁盘上的代码
  await ev(`(async()=>{try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()));}catch(e){}})()`);
  await call('Page.reload', { ignoreCache: true });
  await sleep(3000);
  const ok = await ev(SHOWCASE);
  if (ok !== 'ok') { console.error(`✗ ${s.name}: 场景没搭起来`); continue; }
  // 竖版收紧一点、横版放开一点，各自取景
  const info = await ev(FRAME(s.zoom, s.dy, s.dx || 0));
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const px = `${s.w * s.dsf}×${s.h * s.dsf}`;
  writeFileSync(join(OUT, s.name + '.png'), Buffer.from(data, 'base64'));
  console.log(`  ✓ ${s.name}.png  ${px}  (zoom ${info && info.zoom})`);
}

try { ws.close(); } catch {}
try { chrome.kill(); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log('产出目录:', OUT);
process.exit(0);
