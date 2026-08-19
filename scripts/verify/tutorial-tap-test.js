/* tutorial-tap-test.js — 新手引导指的那块地，必须真的点得到（手机视口）。

   🔴 钉住 2026-08-19 修的那个 bug：
   引导气泡 `.sl-bubble` 压在它自己让你点的目标地块上，且 pointer-events:auto ——
   引导写着「点这块发光的地，种下第一棵菜」，玩家照做，点到的是气泡，**毫无反应**。
   实测代价：7 天 423 次打开，走完引导 **0** 次、跳过 29 次、种下第一棵 2 次。

   根因是 CSS 动画覆盖内联样式：`.sl-bubble` 用 splashSlideUp（末帧带
   `transform: translateY(0)`）+ `animation-fill-mode: both`，而**动画优先级高于
   内联 style**，于是 spotlight.js 里 `translate(-50%, -100%)`（把气泡翻到目标
   上方）整行失效，气泡垂下来盖住目标。

   🔒 为什么必须用**手机视口**测：气泡有上/下两种摆法。桌面屏矮，走「下方」
      分支不需要那个 transform，看起来一切正常 —— 这正是它两年没被发现的原因，
      而 100% 的真实顾客在手机上。用桌面跑这个测试等于没测。

   判据只有一条，但它管住一整类问题：**目标地块中心点，必须能命中画布。** */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !window.__splashReady; i++) await sleep(100);

  const w = innerWidth, h = innerHeight;
  if (w > 500) {
    return { inconclusive: '需要手机视口（EF_MOBILE=1），当前 ' + w + 'x' + h };
  }

  const s = document.getElementById('splashStart');
  if (!s) return { failures: ['开屏上找不到 #splashStart'] };
  s.click();
  await sleep(1500);

  const cta = document.getElementById('tutorialStartBtn');
  if (!cta) return { failures: ['「开始种菜」按钮不见了（#tutorialStartBtn）'] };
  cta.click();
  await sleep(1600);

  const idx = Farm.spotlight ? Farm.spotlight._targetIdx : -1;
  const iso = Farm.isoView && Farm.isoView.plotScreenRect;
  if (!iso || idx < 0) return { failures: ['引导没有指向任何地块（_targetIdx=' + idx + '）'] };
  const r = Farm.isoView.plotScreenRect(idx);
  if (!r) return { failures: ['拿不到目标地块的屏幕矩形'] };

  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  const id = hit ? (hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '')) : '(null)';

  const failures = [];
  if (!hit || hit.tagName.toLowerCase() !== 'canvas') {
    failures.push('引导指的地块中心点被「' + id + '」挡住了 —— 玩家照着点会毫无反应');
  }
  const bubble = document.getElementById('slBubble');
  if (bubble && getComputedStyle(bubble).pointerEvents !== 'none') {
    failures.push('气泡 pointer-events 不是 none —— 少了「点击能穿过去」这道保险');
  }
  return { failures: failures, hitAtTarget: id, plot: { x: cx, y: cy } };
})()
