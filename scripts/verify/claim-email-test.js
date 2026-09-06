/* claim-email-test.js — 登记邮箱这一屏必须真的把东西提交出去（由 cdp.mjs 注入）。

   2026-09-05：短信验证取消，「设置密码」改成「登记邮箱 → 收信在邮件里设」。
   这一屏是那条路唯一的入口，所以三件事都得钉住：

     ① 三个输入框都在，主按钮绑上了 onclick（「点了没反应」是本项目反复出现的失败态）
     ② 🔒 会员码是必填、且**真的传给了后端** —— 它是这条路唯一的闸：手机号印在
        小票上，只凭它就能绑邮箱的话，谁捡到一张小票就能把那个会员的积分、储值、
        消费记录一起拿走
     ③ 后端拒绝（403 会员码不对 / 503 信没发出去）时如实报出来，**绝不假装成功**
        跳到「请查收邮件」—— 那会让人去等一封永远不到的信

   🔒 fetch 在测试里打桩，绝不真打生产（会给真实号码发信）。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !window.__splashReady; i++) await sleep(100);
  for (let i = 0; i < 120 && !(window.Farm && Farm.fbAuth && Farm.ui
        && Farm.state && Farm.state.data && Farm.state.data.language); i++) {
    await sleep(100);
  }
  const A = window.Farm && Farm.fbAuth;
  if (!A) return { failures: ['Farm.fbAuth 没加载'] };

  const failures = [], ran = [];
  const errText = () => (document.getElementById('authError') || {}).textContent || '';

  // fetch 打桩：记下请求体，按需要返回不同结果
  let reply = { ok: true, status: 200, body: { status: 'email_sent', domain: 'gmail.com' } };
  const calls = [];
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).indexOf('/claim-email') >= 0) {
      let body = {};
      try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
      calls.push(body);
      return {
        ok: reply.ok, status: reply.status,
        text: async () => '', json: async () => reply.body,
      };
    }
    return realFetch(url, opts);
  };

  const open = async () => {
    A._confirmDigits = '3062612802';
    A._go('claimemail');
    await sleep(80);
  };
  const fill = (phone, email, code) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('claimPhone', phone); set('claimEmail', email); set('claimCode', code);
  };
  const submit = async () => {
    const btn = document.getElementById('authClaimBtn');
    if (!btn) { failures.push('缺主按钮 #authClaimBtn'); return; }
    btn.click();
    await sleep(220);
  };

  try {
    // ① 三个框都在，号码已预填，按钮接上了
    await open();
    ran.push('渲染');
    ['claimPhone', 'claimEmail', 'claimCode', 'authClaimBtn'].forEach(id => {
      if (!document.getElementById(id)) failures.push('缺元素 #' + id);
    });
    const btn = document.getElementById('authClaimBtn');
    if (btn && typeof btn.onclick !== 'function') failures.push('主按钮没绑 onclick（点了会没反应）');
    const pre = (document.getElementById('claimPhone') || {}).value || '';
    if (pre.replace(/\D/g, '') !== '3062612802') {
      failures.push('已知号码没预填：' + pre);
    }

    // ② 会员码必填 —— 这是整道闸
    ran.push('会员码必填');
    calls.length = 0;
    fill('(306) 261-2802', 'someone@example.com', '');
    await submit();
    if (calls.length) failures.push('会员码空着也提交了 —— 那道闸等于没有');
    if (!/会员码|member code/i.test(errText())) failures.push('会员码空着没给提示：' + errText());

    // 邮箱格式也要本地拦住
    ran.push('邮箱格式');
    calls.length = 0;
    fill('(306) 261-2802', 'not-an-email', 'ABCD1234');
    await submit();
    if (calls.length) failures.push('邮箱格式不对也提交了');

    // ③ 正常提交：三样都要发出去
    ran.push('正常提交');
    calls.length = 0;
    reply = { ok: true, status: 200, body: { status: 'email_sent', domain: 'gmail.com' } };
    fill('(306) 261-2802', 'someone@example.com', 'abcd1234');
    await submit();
    if (calls.length !== 1) {
      failures.push('该提交却没提交（' + calls.length + ' 次）');
    } else {
      const b = calls[0];
      if (b.phone !== '3062612802') failures.push('手机号没传对：' + b.phone);
      if (b.email !== 'someone@example.com') failures.push('邮箱没传对：' + b.email);
      if (b.member_code !== 'ABCD1234') failures.push('会员码没传对（要大写）：' + b.member_code);
    }
    if (A._view !== 'sent') failures.push('成功后没进「请查收邮件」屏：' + A._view);

    // ④ 会员码不对 → 403，如实报出来，不许跳到 sent
    ran.push('会员码不对');
    await open();
    reply = { ok: false, status: 403, body: { detail: '手机号和会员码对不上，请核对会员卡，或到店找店员登记' } };
    fill('(306) 261-2802', 'someone@example.com', 'ZZZZZZZZ');
    await submit();
    if (A._view === 'sent') failures.push('🔴 被拒绝了却跳到「请查收邮件」—— 这是在骗人');
    if (!/对不上/.test(errText())) failures.push('会员码不对没如实报：' + errText());

    // ⑤ 信没发出去 → 503，同样不许假装成功
    ran.push('发信失败');
    await open();
    reply = { ok: false, status: 503, body: { detail: '邮箱已登记，但信没发出去，请稍后再试一次' } };
    fill('(306) 261-2802', 'someone@example.com', 'ABCD1234');
    await submit();
    if (A._view === 'sent') failures.push('🔴 发信失败却跳到「请查收邮件」—— 人会去等一封永远不到的信');
    if (!/没发出去/.test(errText())) failures.push('发信失败没如实报：' + errText());

    // ⑥ 按钮被拒后要能再点（disabled 没复位 = 卡死）
    ran.push('按钮复位');
    const b2 = document.getElementById('authClaimBtn');
    if (b2 && b2.disabled) failures.push('🔴 被拒之后按钮还是 disabled，人卡在这一屏');

  } catch (e) {
    failures.push('抛异常：' + (e && e.message));
  } finally {
    window.fetch = realFetch;
    try { Farm.ui.hideModal(); } catch (e) {}
  }

  return { ran, failures };
})();
