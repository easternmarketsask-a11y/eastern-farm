/* login-audit.js — 顾客登录的全面体检（手机视口）。

   2026-08-19 一天之内在登录这条路上查出 5 个「按钮在、点了没用、还不报错」
   的 bug（开屏登录按钮 / 引导气泡 / 发送验证码 / Auth 写权限 / 发邮件）。
   共同点：**都不报错**，客人只觉得「怪怪的」然后走掉。

   所以这个体检的判据不是「有没有抛异常」，而是逐条问：
     · 每一屏画得出来吗？
     · 每一屏的主按钮绑上了吗？（没绑 = 点了没反应）
     · 输入框能打字吗？字号够不够大（<16px iOS 一点就整页放大）？
     · 触摸目标够不够 44px？
     · 有没有哪一屏是死路（既没有主按钮也没有返回）？ */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* ⚠️ 必须等到 **Farm.state.data 也就绪**，不只是 fbAuth/ui。
     每一屏的渲染都读 Farm.state.data.language，state 还没 init 时直接
     TypeError。本地 boot 快，只等 fbAuth 也碰巧能过；生产站慢一点就整片报错，
     看着像「登录全坏了」——那是测试跑太早，不是产品坏了。
     判据要等的是「渲染真正依赖的东西」，不是「大概差不多了」。 */
  for (let i = 0; i < 100 && !(window.Farm && Farm.fbAuth && Farm.ui
        && Farm.state && Farm.state.data && Farm.state.data.language); i++) {
    await sleep(100);
  }
  const A = window.Farm && Farm.fbAuth;
  if (!A) return { failures: ['Farm.fbAuth 没加载'] };
  if (!(Farm.state && Farm.state.data)) {
    return { inconclusive: '等了 10 秒 Farm.state 仍未初始化（网络太慢？）' };
  }

  // 每屏：视图名 → [主按钮 id, 其它必须存在的 id...]
  const SCREENS = [
    ['login',     ['authIdentBtn', 'authIdent', 'authPassword']],
    ['phone',     ['authNextBtn', 'authPhone']],
    ['confirm',   ['authConfirmYes']],
    ['sent',      []],
    ['forgot',    ['authForgotBtn', 'forgotIdent']],
    // 2026-09-05：短信取消，otp / setpw / email / emailcode 四屏合并成这一屏
    ['claimemail', ['authClaimBtn', 'claimPhone', 'claimEmail', 'claimCode']],
  ];

  const failures = [], ran = [], warn = [];
  // confirm 屏要有名字才画得出来
  A._confirmName = 'Nicole';
  A._confirmDigits = '3062419608';

  for (const [view, ids] of SCREENS) {
    try {
      A._view = view;
      A._renderLoginModal();
      await sleep(60);

      ids.forEach((id, idx) => {
        const el = document.getElementById(id);
        if (!el) { failures.push(`${view}: 缺元素 #${id}`); return; }
        if (idx === 0 && typeof el.onclick !== 'function') {
          failures.push(`${view}: 主按钮 #${id} 没绑 onclick —— 点了不会有反应`);
        }
        if (el.tagName === 'INPUT') {
          const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
          if (fs < 16) failures.push(`${view}: 输入框 #${id} 字号 ${fs}px < 16px，iOS 一点就整页放大`);
          if (el.disabled) failures.push(`${view}: 输入框 #${id} 是禁用的`);
        }
      });

      // 每屏都必须有出路：主按钮 或 任何返回/取消
      const modal = document.getElementById('modal');
      const btns = modal ? [].slice.call(modal.querySelectorAll('button')) : [];
      const usable = btns.filter((b) => b.offsetParent !== null || b.getClientRects().length);
      if (!usable.length) failures.push(`${view}: 这一屏一个可见按钮都没有 —— 死路`);

      /* ⚠️ 这里**故意不查触摸目标大小**，两次尝试都在误报：
           第一版量 getBoundingClientRect().height → 把 ✕ 报成不合格，
             而它早就用 `::after { inset:-5px }` 把热区扩到 44×44（视觉
             34px 是刻意的，不压弹窗标题）。
           第二版改用 elementFromPoint 试点 → 把 51px、52px 的主按钮也报成
             不足 44px，因为弹窗内容可滚动，靠下的按钮探测点落在裁剪区外。
         会喊狼来了的检查比没有检查更糟 —— 人会学会忽略它，然后真问题也被忽略。
         触摸目标是**静态 CSS 属性**，用下面的 assertCss 一次性钉住即可，
         不该在这个动态走查里量几何。 */
      ran.push(view);
    } catch (e) {
      failures.push(`${view}: 渲染抛异常 ${(e && e.message) || e}`);
    }
  }

  // 错误提示区要能显示多行（后端 detail 可能带换行）
  try {
    A._view = 'phone'; A._renderLoginModal(); await sleep(40);
    A._showError('第一行\n第二行');
    const err = document.getElementById('authError');
    const ws = err ? getComputedStyle(err).whiteSpace : '';
    if (!/pre-line|pre-wrap|pre$/.test(ws)) {
      failures.push(`错误提示区 white-space=${ws} —— 多行提示会挤成一行`);
    }
    if (err && !err.textContent.includes('第二行')) failures.push('错误提示没显示出来');
    ran.push('error-area');
  } catch (e) { failures.push('error-area: ' + ((e && e.message) || e)); }

  /* 触摸目标 / 字号：查 **CSS 规则本身**，确定性、不受滚动和布局影响。
     ✕ 与 ⓘ 走「视觉小、热区扩到 44」的伪元素方案（见 style.css 里的说明），
     所以查它们有没有那个 ::after，而不是查方框多高。 */
  try {
    const probe = (html, sel) => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;';
      box.innerHTML = html;
      document.body.appendChild(box);
      const el = box.querySelector(sel);
      const cs = el ? getComputedStyle(el) : null;
      const after = el ? getComputedStyle(el, '::after') : null;
      const out = { h: cs ? parseFloat(cs.minHeight) || parseFloat(cs.height) || 0 : -1,
                    fs: cs ? parseFloat(cs.fontSize) || 0 : -1,
                    afterH: after ? parseFloat(after.height) || 0 : 0,
                    afterInset: after ? after.inset : '' };
      box.remove();
      return out;
    };
    const ghost = probe('<button class="auth-ghost">x</button>', '.auth-ghost');
    if (ghost.h < 44) failures.push(`.auth-ghost 触摸目标 ${ghost.h}px < 44px`);

    const input = probe('<input class="auth-input">', '.auth-input');
    if (input.fs < 16) failures.push(`.auth-input 字号 ${input.fs}px < 16px（iOS 会整页放大）`);

    const info = probe('<button class="auth-info-btn">i</button>', '.auth-info-btn');
    const infoOk = info.afterH >= 44 || /(-|^)\s*-?\d/.test(info.afterInset || '');
    if (!infoOk) failures.push('ⓘ 没有扩热区的 ::after —— 27px 的目标点不中');
    ran.push('css-touch-targets');
  } catch (e) { failures.push('css-touch-targets: ' + ((e && e.message) || e)); }

  try { Farm.ui.hideModal(); } catch (_) {}
  return { failures, warnings: warn, ran };
})()
