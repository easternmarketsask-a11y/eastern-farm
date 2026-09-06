/* auth-views-test.js — 登录弹窗每一屏都画得出来、没有死引用（由 cdp.mjs 注入）。

   2026-08-17 登录改造把「邮箱+密码」换成「手机号/用户名+密码」，顺带删了
   _renderEmailTab / _renderBindView / _emailLogin。这类改动最容易留下的伤是
   **某一屏点进去就抛 TypeError**，而它只在那一屏被打开时才发作 ——
   冒烟测试(smoke-flows)走的是商店/任务那些入口，一个都碰不到登录弹窗。

   所以这里逐屏打开，检查三件事：
     ① 渲染不抛异常
     ② 关键控件真的在 DOM 里（不是渲染了个空壳）
     ③ 每屏的主按钮都绑上了 onclick（「点了没反应」是本项目反复出现的失败态） */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* ⚠️ 要等 Farm.state.data 也就绪 —— 每屏渲染都读 state.data.language，
     state 没 init 就是 TypeError。本地 boot 快碰巧能过，生产站慢一点就整片
     报错，看着像「登录全坏了」，实则是测试跑太早（2026-08-19 踩过）。 */
  for (let i = 0; i < 120 && !(window.Farm && Farm.fbAuth && Farm.ui
        && Farm.state && Farm.state.data && Farm.state.data.language); i++) {
    await sleep(100);
  }
  const A = window.Farm && window.Farm.fbAuth;
  if (!A) return { failures: ['Farm.fbAuth 没加载'] };

  const failures = [], ran = [];
  // 每屏：视图名 → 必须存在的元素 id，其中第一个必须绑上 onclick
  const SCREENS = [
    ['login',     ['authIdentBtn', 'authIdent', 'authPassword']],
    ['phone',     ['authNextBtn', 'authPhone']],
    ['sent',      []],
    ['forgot',    ['authForgotBtn', 'forgotIdent']],
    // 2026-09-05：短信那两屏（otp / setpw）和验码补邮箱那两屏（email /
    // emailcode）合并成 claimemail —— 手机验证有成本，取消了。
    // 🔒 会员码那一格是这条路唯一的闸（手机号印在小票上），必须一直在。
    ['claimemail', ['authClaimBtn', 'claimPhone', 'claimEmail', 'claimCode']],
    // 非会员注册三屏（2026-08-20）。notmember 那屏没有主按钮 id，
    // 它的两个按钮都是 data-auth-go 跳转（由下面的通用绑定接管），
    // 所以只检查文案容器在不在。
    ['notmember',  []],
    ['regemail',   ['authRegStartBtn', 'regEmail', 'regName']],
    ['regcode',    ['authRegConfirmBtn', 'regCode', 'regPw']],
  ];

  for (const [view, ids] of SCREENS) {
    try {
      A._view = view;
      A._renderLoginModal();
      await sleep(60);
      ids.forEach((id, idx) => {
        const el = document.getElementById(id);
        if (!el) { failures.push(`${view}: 缺元素 #${id}`); return; }
        // 第一个 id 约定是这屏的主按钮 —— 没绑 onclick 就是「点了没反应」
        if (idx === 0 && typeof el.onclick !== 'function') {
          failures.push(`${view}: 主按钮 #${id} 没绑 onclick`);
        }
      });
      ran.push(view);
    } catch (e) {
      failures.push(`${view}: 渲染抛异常 ${(e && e.message) || e}`);
    }
  }

  // ⓘ 折叠说明：默认必须是收起的，点一下要能展开（Chris 8/17 的硬要求）
  try {
    A._view = 'login';
    A._renderLoginModal();
    await sleep(60);
    const btn = document.querySelector('[data-auth-info]');
    const body = btn && document.getElementById(btn.dataset.authInfo);
    if (!btn || !body) {
      failures.push('login: 没有 ⓘ 折叠说明');
    } else {
      if (!body.hidden) failures.push('ⓘ 说明默认就是展开的（应默认隐藏）');
      btn.click();
      await sleep(30);
      if (body.hidden) failures.push('ⓘ 点了不展开');
      if (btn.getAttribute('aria-expanded') !== 'true') failures.push('ⓘ 没更新 aria-expanded');
    }
    ran.push('info-toggle');
  } catch (e) {
    failures.push('info-toggle: ' + ((e && e.message) || e));
  }

  // 新客人从登录首屏直接能进注册（2026-09-06）：以前要先输号、被告知查不到才看得见。
  try {
    A._view = 'login'; A._authFrom = '';
    A._renderLoginModal();
    await sleep(60);
    const entry = document.querySelector('[data-auth-go="regemail"][data-auth-from="login"]');
    if (!entry) failures.push('login: 没有「还不是会员？用邮箱注册」入口');
    else {
      entry.click();
      await sleep(80);
      if (A._view !== 'regemail') failures.push('点注册入口没进 regemail：' + A._view);
      const modalTxt = (document.getElementById('modal') || document.body).textContent || '';
      if (!/先替你存着|held for you/.test(modalTxt)) failures.push('从登录首屏进注册没看到「积分先替你存着」那段说明');
      const back = document.querySelector('[data-auth-go="login"]');
      if (!back) failures.push('从登录首屏进的注册屏，返回键应回登录');
    }
    // 从 notmember 进来的仍然回 notmember，且不重复那段话
    A._view = 'notmember'; A._authFrom = '';
    A._renderLoginModal(); await sleep(60);
    const go = document.querySelector('[data-auth-go="regemail"]');
    if (go) { go.click(); await sleep(80); }
    if (A._view !== 'regemail') failures.push('notmember → regemail 没跳过去：' + A._view);
    if (!document.querySelector('[data-auth-go="notmember"]')) failures.push('从 notmember 进的注册屏，返回键应回 notmember');
    ran.push('signup-entry');
  } catch (e) {
    failures.push('signup-entry: ' + ((e && e.message) || e));
  }

  try { Farm.ui.hideModal(); } catch (_) {}
  return { failures, ran };
})()
