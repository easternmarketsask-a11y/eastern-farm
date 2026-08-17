/* splash-login-test.js — 开屏「会员登录」按钮的回归测试（由 cdp.mjs 注入）。

   钉住 2026-08-17 修的那个 bug：
   玩家在 boot 跑完之前点「会员登录 · 领礼包」，登录弹窗**永远不出现**，
   人以游客身份掉进农场。实测后果是 7 天 462 人进游戏、登录 0 次。

   根因是执行顺序 —— main.js 的 wireSplash 里
       if (_enterRequested()) { dismiss(); return; }   ← return
       loginBtn.onclick = ...                          ← 到不了
   而 index.html 的捕获处理器又不记「点的是哪个按钮」。

   本测试**必须在 boot 就绪之前点下去**才算数（cdp 的 eval 在 load 后立刻跑，
   而 boot 要几秒，正好落在窗口里）。若点的时候 boot 已经就绪，返回
   inconclusive —— 宁可报「没测到」，也不报一个骗人的绿灯。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.getElementById('splashLogin');
  if (!btn) return { failures: ['开屏上找不到 #splashLogin'] };

  // 关键：点击必须发生在 boot 就绪之前，否则测的是另一条（本来就没坏的）路径
  const readyAtClick = !!window.__splashReady;
  btn.click();

  const loginRequested = window.__splashLoginRequested === true;

  // 抢在 openLoginSoon 的 700ms 定时器之前把探针装上。
  // ⚠️ 轮询预算必须留在 cdp.mjs 的 15 秒 Runtime.evaluate 上限内，
  //    超了拿到的是 harness 超时，不是测试结论。
  let called = false;
  for (let i = 0; i < 600; i++) {
    const A = window.Farm && window.Farm.fbAuth;
    if (A && A.openLoginModal && !A.__spied) {
      const orig = A.openLoginModal.bind(A);
      A.openLoginModal = function () { called = true; try { return orig(); } catch (_) {} };
      A.__spied = true;
      break;
    }
    await sleep(10);
  }

  // 弹窗要等 dismiss（boot 就绪时）再 +700ms，所以窗口要够宽 ——
  // 但仍要留在 harness 的 15 秒上限内，超了拿到的是超时不是结论。
  for (let i = 0; i < 90 && !called; i++) await sleep(100);

  const failures = [];
  if (readyAtClick) {
    return {
      inconclusive: 'boot 在点击前就绪了，没测到目标路径（重跑或调慢加载）',
      openLoginModalCalled: called,
    };
  }
  if (!loginRequested) failures.push('index.html 没记下 __splashLoginRequested');
  if (!called) failures.push('boot 前点登录 → openLoginModal 从未被调用（就是那个 bug）');
  return { failures, readyAtClick, loginRequested, openLoginModalCalled: called };
})()
