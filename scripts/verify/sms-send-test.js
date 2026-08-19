/* sms-send-test.js — 「发送短信验证码」这个按钮必须真的把号码发出去。

   🔴 钉住 2026-08-19 客人 Alicia 报的 bug：
   验证码那一屏标题写着「将发送到 (639) 476-8553」，点「发送短信验证码」
   却弹红字「请输入店里登记的 10 位手机号」—— 号码明明已经在手上了。
   她只能关掉窗口，以游客身份进游戏。

   根因：`_sendCode()` 去读 `#authPhone` 输入框，而**那个输入框只存在于上一屏**
   （输手机号），验证码这一屏（`_renderOtpView`）根本没有它。于是
   `digits.length` 恒为 0，永远走进那句错误提示并 return。
   2026-08-12 把手机号流程拆成两屏时留下的（拆之前输入框和按钮在同一屏）。

   后果：**短信验证码从来发不出去** —— 而这是 909 个从没登录过的会员唯一的入口。

   🔒 测试里把 signInWithPhoneNumber 打桩，绝不真发短信（要花钱，而且会骚扰
      号码的真实主人）。判据是「它有没有被调用、收到的号码对不对」。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !window.__splashReady; i++) await sleep(100);
  const A = window.Farm && Farm.fbAuth;
  if (!A) return { failures: ['Farm.fbAuth 没加载'] };
  // Firebase SDK 是动态晚加载的（2026-08-12 起），要等它落地才有 auth 对象
  for (let i = 0; i < 60 && !(Farm.fb && Farm.fb.auth); i++) await sleep(100);
  if (!Farm.fb || !Farm.fb.auth) return { inconclusive: 'Firebase 未就绪（离线/CDN 挡了）' };

  // 打桩：记下被要求发给谁，绝不真发
  let sentTo = null;
  Farm.fb.auth.signInWithPhoneNumber = function (e164) {
    sentTo = e164;
    return new Promise(function () {});   // 永挂，模拟「回执还没回来」
  };
  A._recaptcha = A._recaptcha || { fake: true };   // 跳过「验证未就绪」那道闸

  // 直接摆到 Alicia 当时那一屏：号码已确认，等着发码
  A._currentPhoneE164 = '+16394768553';
  A._confirmation = null;
  A._smsPending = null;
  A._go('otp');
  await sleep(400);

  const btn = document.getElementById('authSendBtn');
  if (!btn) return { failures: ['验证码屏上没有「发送短信验证码」按钮'] };
  btn.click();
  await sleep(600);

  const errEl = document.getElementById('authError');
  const err = errEl ? (errEl.textContent || '').trim() : '';

  const failures = [];
  if (!sentTo) {
    failures.push('点了发送，signInWithPhoneNumber 从未被调用' + (err ? '；页面报：' + err : ''));
  } else if (sentTo !== '+16394768553') {
    failures.push('号码传错了：期望 +16394768553，实际 ' + sentTo);
  }
  if (err) failures.push('不该有错误提示，却显示：' + err);
  return { failures: failures, sentTo: sentTo, errorShown: err };
})()
