(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  var pass = el('pass'), surface = el('surface'), table = el('table'), world = el('world');
  var note = el('note'), menu = el('menu'), send = el('send'), retry = el('retry');
  var placeCurrent = el('placeCurrent'), nextDish = el('nextDish');
  var seatEls = Array.prototype.slice.call(document.querySelectorAll('.seat'));
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var state = { queue: [], current: null, seats: seatEls.map(function () { return null; }), done: false, loading: true, busy: false, round: 0, accepted: null };
  var drag = null, suppressClickUntil = 0, loadAttempt = 0, activeController = null;
  var noteTimer = 0, audioCtx = null;
  var rotation = { angle: 0, raf: 0, lastTime: 0, drag: null, velocity: 0, keyTimer: 0 };
  var ROTATION_DEGREES_PER_PIXEL = 1.05, SPIN_FRICTION_MS = 420, MAX_SPIN_SPEED = 1.4, MIN_SPIN_SPEED = 0.025;

  function ceramic() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      var t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(740, t); o.frequency.exponentialRampToValueAtTime(280, t + .08);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.035, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + .13);
    } catch (e) {}
  }
  function accepts(index, dish) { return !!dish && seatEls[index].classList.contains('soup') === (dish.role === 'soup'); }
  function available(dish) { return state.seats.some(function (d, i) { return !d && accepts(i, dish); }); }
  function nextAvailable() {
    var index = state.queue.findIndex(available);
    return index < 0 ? null : state.queue.splice(index, 1)[0];
  }
  function announce(text) { el('announcement').textContent = text; }
  function showNote(text) {
    clearTimeout(noteTimer); note.hidden = false; note.textContent = text;
    noteTimer = setTimeout(function () { note.hidden = true; }, 5000);
  }
  function refresh() {
    var mains = 0, soups = 0;
    state.seats.forEach(function (dish, i) {
      if (dish) { if (dish.role === 'soup') soups++; else mains++; }
      var seat = seatEls[i], valid = !dish && accepts(i, state.current) && !state.loading && !state.busy && !state.done && !drag;
      seat.classList.toggle('has-plate', !!dish);
      seat.classList.toggle('is-available', valid);
      seat.setAttribute('role', dish ? 'group' : 'button');
      seat.tabIndex = dish || !valid ? -1 : 0;
      seat.setAttribute('aria-disabled', valid ? 'false' : 'true');
      seat.setAttribute('aria-label', dish ? dish.zh + ' · ' + dish.en : (i === 4 ? '空汤碗 · Empty soup bowl' : '空菜盘 ' + (i + 1) + ' · Empty dish plate ' + (i + 1)));
    });
    el('mainCount').textContent = mains + ' / 4'; el('soupCount').textContent = soups + ' / 1';
    document.querySelectorAll('.progress-main i').forEach(function (dot, i) { dot.classList.toggle('is-filled', i < mains); });
    document.querySelector('.progress-soup i').classList.toggle('is-filled', soups === 1);
    var blocked = state.loading || state.busy || state.done || !!drag || !state.current;
    placeCurrent.disabled = blocked || !available(state.current);
    nextDish.disabled = blocked || !state.queue.some(available);
    pass.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    if (pass.firstElementChild) pass.firstElementChild.disabled = blocked;
  }
  function safeURL(value) {
    try { var url = new URL(value, location.href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (e) { return ''; }
  }
  function makePlate(dish) {
    var plate = document.createElement('button'); plate.type = 'button'; plate.className = 'plate'; plate.dataset.role = dish.role;
    plate.setAttribute('aria-label', dish.zh + ' · ' + dish.en + '。点击上桌，或拖动摆放。 Tap to serve, or drag to place.');
    var disc = document.createElement('div'); disc.className = 'disc';
    var fallback = document.createElement('span'); fallback.className = 'image-fallback'; fallback.textContent = dish.zh; fallback.hidden = true; fallback.setAttribute('aria-hidden', 'true');
    var img = document.createElement('img'); img.alt = ''; img.draggable = false;
    img.addEventListener('error', function () { img.hidden = true; fallback.hidden = false; });
    if (dish.image) img.src = dish.image; else { img.hidden = true; fallback.hidden = false; }
    if (dish.focus) img.style.objectPosition = dish.focus;
    disc.appendChild(img); disc.appendChild(fallback); plate.appendChild(disc);
    var cap = document.createElement('div'); cap.className = 'cap';
    var zh = document.createElement('span'); zh.className = 'zh'; zh.textContent = dish.zh;
    var en = document.createElement('span'); en.className = 'en'; en.lang = 'en'; en.textContent = dish.en;
    cap.appendChild(zh); cap.appendChild(en); plate.appendChild(cap);
    plate.addEventListener('pointerdown', onDown);
    plate.addEventListener('click', function () {
      if (state.busy || state.loading || drag) return;
      var seat = plate.closest('.seat');
      if (state.done) { if (dish.recipe) window.open(dish.recipe, '_blank', 'noopener'); return; }
      if (seat) returnToHand(Number(seat.dataset.seat), plate);
      else serve();
    });
    return plate;
  }
  function renderPass() {
    pass.replaceChildren();
    if (state.current && !state.done) pass.appendChild(makePlate(state.current));
    refresh();
  }
  function clearInline(plate) {
    ['position', 'left', 'top', 'width', 'zIndex', 'margin', 'transform', 'transition', 'transformOrigin'].forEach(function (key) { plate.style[key] = ''; });
    plate.classList.remove('is-lifted');
  }
  function highlight(index) { seatEls.forEach(function (seat, i) { seat.classList.toggle('is-near', i === index); }); }
  function releaseCapture(target, pid) { try { if (target.hasPointerCapture(pid)) target.releasePointerCapture(pid); } catch (e) {} }

  function setTableAngle(angle) {
    rotation.angle = ((angle % 360) + 360) % 360;
    surface.style.setProperty('--table-angle', rotation.angle + 'deg');
  }
  function stopSpin() {
    if (rotation.raf) cancelAnimationFrame(rotation.raf);
    rotation.raf = 0; rotation.lastTime = 0; rotation.velocity = 0;
    surface.classList.remove('is-spinning', 'is-key-turn');
    clearTimeout(rotation.keyTimer); rotation.keyTimer = 0;
  }
  function spinFrame(now) {
    if (rotation.lastTime) {
      var elapsed = Math.min(now - rotation.lastTime, 50);
      if (elapsed > 0) { setTableAngle(rotation.angle + rotation.velocity * elapsed); rotation.velocity *= Math.exp(-elapsed / SPIN_FRICTION_MS); }
    }
    rotation.lastTime = now;
    if (Math.abs(rotation.velocity) < MIN_SPIN_SPEED) { stopSpin(); return; }
    rotation.raf = requestAnimationFrame(spinFrame);
  }
  function startSpin(velocity) {
    if (motion.matches || Math.abs(velocity) < MIN_SPIN_SPEED) return;
    rotation.velocity = Math.max(-MAX_SPIN_SPEED, Math.min(MAX_SPIN_SPEED, velocity));
    rotation.lastTime = 0; surface.classList.add('is-spinning'); rotation.raf = requestAnimationFrame(spinFrame);
  }
  function beginManualTurn(e) {
    if (!state.done || rotation.drag || (e.button != null && e.button !== 0)) return;
    var wasSpinning = !!rotation.raf;
    stopSpin();
    rotation.drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastTime: performance.now(), velocity: 0, moved: false, wasSpinning: wasSpinning };
    surface.classList.add('is-manual-turn');
    try { surface.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function moveManualTurn(e) {
    var turn = rotation.drag;
    if (!turn || e.pointerId !== turn.pointerId) return false;
    if (Math.hypot(e.clientX - turn.startX, e.clientY - turn.startY) > 8) turn.moved = true;
    var deltaX = e.clientX - turn.lastX, now = performance.now(), elapsed = Math.max(1, now - turn.lastTime);
    if (deltaX) {
      var deltaAngle = deltaX * ROTATION_DEGREES_PER_PIXEL;
      setTableAngle(rotation.angle + deltaAngle);
      turn.velocity += (deltaAngle / elapsed - turn.velocity) * Math.min(1, elapsed / 55);
    }
    turn.lastX = e.clientX; turn.lastTime = now;
    return true;
  }
  function endManualTurn(e, cancelled) {
    var turn = rotation.drag;
    if (!turn || (e.pointerId != null && e.pointerId !== turn.pointerId)) return false;
    rotation.drag = null; surface.classList.remove('is-manual-turn'); releaseCapture(surface, turn.pointerId);
    if (turn.moved || turn.wasSpinning || cancelled) suppressClickUntil = performance.now() + 400;
    var idle = performance.now() - turn.lastTime;
    if (!cancelled && turn.moved && idle <= 120) startSpin(turn.velocity * Math.exp(-idle / 140));
    return true;
  }
  function turnWithKeyboard(e) {
    if (!state.done || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault(); stopSpin();
    if (!motion.matches) surface.classList.add('is-key-turn');
    setTableAngle(rotation.angle + (e.key === 'ArrowRight' ? 20 : -20));
    rotation.keyTimer = setTimeout(function () { surface.classList.remove('is-key-turn'); }, 320);
  }

  // State commits before animation. A round token prevents stale callbacks touching a restarted table.
  function land(plate, parent, sound, complete) {
    var first = plate.querySelector('.disc').getBoundingClientRect(), round = state.round;
    state.busy = true; clearInline(plate); plate.classList.toggle('is-set', parent.classList.contains('seat')); parent.appendChild(plate);
    var last = plate.querySelector('.disc').getBoundingClientRect();
    refresh();
    if (!motion.matches && plate.animate && last.width) {
      plate.animate([
        { transform: 'translate(' + (first.left - last.left) + 'px,' + (first.top - last.top) + 'px) scale(' + first.width / last.width + ')' },
        { transform: 'translate(0,0) scale(1)' }
      ], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    setTimeout(function () {
      if (state.round !== round || !plate.isConnected) return;
      state.busy = false;
      if (sound) ceramic();
      if (complete) complete();
      refresh();
    }, 300);
  }
  function serve(index) {
    if (state.loading || state.busy || state.done || drag || !state.current) return;
    if (index == null) index = state.seats.findIndex(function (d, i) { return !d && accepts(i, state.current); });
    if (index < 0 || state.seats[index]) return;
    if (!accepts(index, state.current)) { showNote(state.current.role === 'soup' ? '请将汤放在中间的碗里。 Please place soup in the centre bowl.' : '这只碗是用来放汤的，请选择空菜盘。 Choose an empty dish plate; this bowl is for soup.'); return; }
    place('pass', index, pass.querySelector('.plate'));
  }
  function place(origin, index, plate) {
    if (state.busy || state.done || !plate) return;
    var dish = origin === 'pass' ? state.current : state.seats[origin];
    if (!dish || !accepts(index, dish) || (state.seats[index] && index !== origin)) return;
    if (origin !== 'pass') state.seats[origin] = null;
    state.seats[index] = dish;
    if (origin === 'pass') state.current = nextAvailable();
    land(plate, seatEls[index], true, function () {
      announce(dish.zh + '已上桌。' + el('mainCount').textContent + ' 道菜，' + el('soupCount').textContent + ' 碗汤。 ' + dish.en + ' served.');
      if (state.seats.every(Boolean)) finish();
    });
    plate.setAttribute('aria-label', dish.zh + ' · ' + dish.en + '。点击取回，或拖动换位置。 Tap to take back, or drag to move.');
    if (origin === 'pass') renderPass();
  }
  function returnToHand(origin, plate) {
    if (state.busy || state.done || !state.seats[origin]) return;
    var dish = state.seats[origin]; state.seats[origin] = null;
    if (state.current) state.queue.unshift(state.current);
    state.current = dish; pass.replaceChildren();
    land(plate, pass, false);
    plate.setAttribute('aria-label', dish.zh + ' · ' + dish.en + '。点击上桌，或拖动摆放。 Tap to serve, or drag to place.');
    announce(dish.zh + '已取回。 ' + dish.en + ' is ready to serve again.');
  }
  function skipDish() {
    if (state.loading || state.busy || state.done || drag || !state.current || !state.queue.some(available)) return;
    state.queue.push(state.current); state.current = nextAvailable(); renderPass();
    // The small guard also applies with reduced motion; double taps never skip two dishes.
    state.busy = true; refresh(); var round = state.round;
    setTimeout(function () { if (round === state.round) { state.busy = false; refresh(); } }, 300);
  }
  function nearestSeat(x, y, dish, origin) {
    var best = null, bestD = Infinity, wrong = false;
    seatEls.forEach(function (seat, i) {
      if (state.seats[i] && origin !== i) return;
      var rect = seat.getBoundingClientRect(), d = Math.hypot(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2);
      if (d >= rect.width * .85) return;
      if (!accepts(i, dish)) { wrong = true; return; }
      if (d < bestD) { best = i; bestD = d; }
    });
    return { seat: best, wrong: best === null && wrong };
  }
  function onDown(e) {
    if (state.done || state.busy || state.loading || drag || (e.button != null && e.button !== 0)) return;
    var plate = e.currentTarget, seat = plate.closest('.seat'), rect = plate.querySelector('.disc').getBoundingClientRect();
    drag = { plate: plate, origin: seat ? Number(seat.dataset.seat) : 'pass', parent: plate.parentNode, rect: rect, dx: e.clientX - rect.left, dy: e.clientY - rect.top, pid: e.pointerId, x0: e.clientX, y0: e.clientY, far: false };
    try { plate.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onMove(e) {
    if (moveManualTurn(e)) return;
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.far && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) <= 8) return;
    if (!drag.far) {
      drag.far = true; drag.plate.classList.add('is-lifted');
      // Reparent to the world: fixed positioning must not inherit the rotating table's containing block.
      world.appendChild(drag.plate); drag.plate.style.position = 'fixed'; drag.plate.style.width = drag.rect.width + 'px'; drag.plate.style.margin = '0'; drag.plate.style.zIndex = '20';
      // Moving the element releases implicit capture in Chromium. Reacquire after the DOM move.
      try { drag.plate.setPointerCapture(e.pointerId); } catch (err) {}
    }
    e.preventDefault();
    drag.plate.style.left = e.clientX - drag.dx + 'px'; drag.plate.style.top = e.clientY - drag.dy + 'px';
    var dish = drag.origin === 'pass' ? state.current : state.seats[drag.origin];
    highlight(nearestSeat(e.clientX, e.clientY, dish, drag.origin).seat);
  }
  function cancelDrag() {
    if (!drag) return;
    var cancelled = drag; drag = null; suppressClickUntil = performance.now() + 400;
    clearInline(cancelled.plate); cancelled.parent.appendChild(cancelled.plate); highlight(-1);
    releaseCapture(cancelled.plate, cancelled.pid); refresh();
  }
  function onUp(e) {
    if (endManualTurn(e, e.type === 'pointercancel')) return;
    if (!drag || e.pointerId !== drag.pid) return;
    if (e.type === 'pointercancel') { cancelDrag(); return; }
    var ended = drag; drag = null; releaseCapture(ended.plate, ended.pid); highlight(-1);
    if (!ended.far) { refresh(); return; }
    suppressClickUntil = performance.now() + 400;
    var dish = ended.origin === 'pass' ? state.current : state.seats[ended.origin];
    var hit = nearestSeat(e.clientX, e.clientY, dish, ended.origin);
    if (hit.seat !== null) { place(ended.origin, hit.seat, ended.plate); return; }
    clearInline(ended.plate); ended.parent.appendChild(ended.plate);
    if (hit.wrong) { showNote(dish.role === 'soup' ? '请将汤放在中间的碗里。 Please place soup in the centre bowl.' : '请将这道菜放在空菜盘里。 Please choose an empty dish plate.'); }
    else if (ended.origin !== 'pass') { returnToHand(ended.origin, ended.plate); return; }
    else if (e.clientY > table.getBoundingClientRect().bottom + 6) { skipDish(); return; }
    refresh();
  }
  function cancelGestures() { cancelDrag(); endManualTurn({ type: 'pointercancel' }, true); stopSpin(); }

  function finish() {
    if (state.done) return;
    state.done = true; state.current = null; renderPass(); world.classList.add('is-ready');
    surface.classList.add('is-complete', 'is-ready'); surface.tabIndex = 0;
    el('completion').hidden = false; el('turnHint').hidden = false; note.hidden = true; el('loadState').hidden = true;
    if (motion.matches) {
      el('turnHint').replaceChildren(document.createTextNode('左右拖动桌面或按方向键旋转。'));
      var en = document.createElement('span'); en.lang = 'en'; en.textContent = 'Drag or use the arrow keys to turn the table.'; el('turnHint').appendChild(en);
    } else setTableAngle(12);
    menu.replaceChildren();
    state.seats.forEach(function (dish, i) {
      var li = document.createElement('li'), link = document.createElement(dish.recipe ? 'a' : 'span');
      if (dish.recipe) { link.href = dish.recipe; link.target = '_blank'; link.rel = 'noopener'; }
      else link.className = 'recipe-name';
      var zh = document.createElement('span'); zh.className = 'zh'; zh.textContent = dish.zh;
      var en = document.createElement('span'); en.className = 'en'; en.lang = 'en'; en.textContent = dish.en;
      link.appendChild(zh); link.appendChild(en);
      if (dish.recipe) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '17'); svg.setAttribute('height', '17'); svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M7 17 17 7M7 7h10v10'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.appendChild(path); link.appendChild(svg);
      }
      li.appendChild(link); menu.appendChild(li);
      var plate = seatEls[i].querySelector('.plate');
      plate.setAttribute('aria-label', dish.zh + ' · ' + dish.en + (dish.recipe ? '。查看做法。 Open recipe.' : ''));
    });
    announce('四道菜和一碗汤已上桌，可以分享或重新摆桌。 Four dishes and soup are served. Share your table or set it again.');
    // Keep the table in view. Keyboard users meet the completion heading without a forced scroll.
    el('settle').focus({ preventScroll: true }); refresh();
  }
  function resetRound(focus) {
    cancelGestures(); state.round++; state.busy = false; state.done = false;
    state.seats = seatEls.map(function () { return null; });
    seatEls.forEach(function (seat) { seat.querySelectorAll('.plate').forEach(function (plate) { plate.remove(); }); });
    world.querySelectorAll('.plate.is-lifted').forEach(function (plate) { plate.remove(); });
    world.classList.remove('is-ready'); surface.classList.remove('is-complete', 'is-ready'); surface.removeAttribute('tabindex'); setTableAngle(0);
    el('completion').hidden = true; el('turnHint').hidden = true; el('shareFallback').hidden = true; note.hidden = true; menu.replaceChildren();
    send.disabled = false;
    state.queue = state.accepted ? state.accepted.slice() : []; state.current = nextAvailable(); renderPass();
    if (focus && pass.firstElementChild) pass.firstElementChild.focus({ preventScroll: true });
  }
  function loadMessage(zh, en, canRetry) {
    var p = el('loadMessage'); p.replaceChildren(document.createTextNode(zh));
    var span = document.createElement('span'); span.lang = 'en'; span.textContent = en; p.appendChild(span);
    el('loadState').hidden = false; retry.hidden = !canRetry; retry.disabled = state.loading;
  }
  function normalise(data) {
    var dishes = data && Array.isArray(data.dishes) ? data.dishes.filter(function (dish) {
      return dish && typeof dish.zh === 'string' && dish.zh.trim() && typeof dish.en === 'string' && dish.en.trim() && (dish.role === 'dish' || dish.role === 'soup');
    }).map(function (dish) {
      return { zh: dish.zh.trim(), en: dish.en.trim(), role: dish.role, image: dish.image ? safeURL(dish.image) : '', recipe: dish.recipe ? safeURL(dish.recipe) : '', focus: typeof dish.focus === 'string' ? dish.focus : '' };
    }) : [];
    if (dishes.filter(function (dish) { return dish.role === 'dish'; }).length < 4 || !dishes.some(function (dish) { return dish.role === 'soup'; })) throw new Error('Incomplete menu');
    return dishes;
  }
  function fetchMenu(url, ms, live) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeController = controller;
    var timer;
    var options = { credentials: 'omit', cache: live ? 'no-store' : 'default' };
    if (controller) options.signal = controller.signal;
    // Race the entire body read as well as the connection. A stalled body must also time out.
    var request = fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error('Menu request failed');
      return response.json();
    }).then(normalise);
    return Promise.race([request, new Promise(function (resolve, reject) {
      timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('Menu timeout')); }, ms);
    })]).finally(function () { clearTimeout(timer); if (activeController === controller) activeController = null; });
  }
  async function loadMenu() {
    var attempt = ++loadAttempt;
    if (activeController) activeController.abort();
    state.loading = true; state.accepted = null; resetRound(false);
    loadMessage('正在准备菜单。', 'Preparing the menu.', false); refresh();
    var dishes, fallback = false;
    try {
      dishes = await fetchMenu('https://stockwise-app-873982544406.us-central1.run.app/api/public/tonight-table', 4000, true);
    } catch (error) {
      if (attempt !== loadAttempt) return;
      fallback = true;
      try { dishes = await fetchMenu('../data/table-set.json', 2500, false); }
      catch (fallbackError) {
        if (attempt !== loadAttempt) return;
        state.loading = false; renderPass();
        loadMessage('菜单暂时无法载入，请重试。', 'The menu could not load. Please try again.', true); return;
      }
    }
    if (attempt !== loadAttempt) return;
    state.loading = false; state.accepted = dishes; resetRound(false);
    if (fallback) loadMessage('今日菜单暂时无法连接，已载入备用菜单。', 'Today’s menu is unavailable. You can use this saved menu or reload.', true);
    else el('loadState').hidden = true;
  }
  async function shareTable() {
    if (!state.done || send.disabled) return;
    var round = state.round;
    var text = '今晚餐桌 · Tonight’s Table\n' + state.seats.map(function (dish) { return dish.zh + ' · ' + dish.en; }).join('\n') + '\n东方超市 Eastern Market\n' + location.href;
    send.disabled = true;
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: '今晚餐桌 · Tonight’s Table', text: text, url: location.href });
          if (round === state.round) showNote('菜单已分享。 Your table has been shared.');
          return;
        } catch (error) {
          if (error.name === 'AbortError') { if (round === state.round) showNote('已取消分享，可以再次分享。 Sharing cancelled. You can try again.'); return; }
        }
      }
      if (round !== state.round) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); if (round === state.round) showNote('菜单已复制，可以粘贴分享。 Menu copied. Paste it to share.'); return; } catch (error) {}
      }
      if (round !== state.round) return;
      el('shareText').value = text; el('shareFallback').hidden = false; el('shareText').focus(); el('shareText').select();
      showNote('请选取并复制下面的菜单。 Select and copy the menu below.');
    } finally { if (round === state.round) send.disabled = false; }
  }

  seatEls.forEach(function (seat, i) {
    seat.addEventListener('click', function (e) { if (e.target.closest('.plate')) return; serve(i); });
    seat.addEventListener('keydown', function (e) { if (e.target === seat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); serve(i); } });
  });
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onUp);
  document.addEventListener('lostpointercapture', function (e) { if (drag && e.pointerId === drag.pid && !drag.plate.hasPointerCapture(e.pointerId)) cancelDrag(); if (rotation.drag && e.pointerId === rotation.drag.pointerId && !surface.hasPointerCapture(e.pointerId)) endManualTurn(e, true); });
  document.addEventListener('click', function (e) {
    if (performance.now() < suppressClickUntil && e.target.closest('.plate, .seat')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', cancelGestures);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelGestures(); });
  surface.addEventListener('pointerdown', beginManualTurn); surface.addEventListener('keydown', turnWithKeyboard);
  if (motion.addEventListener) motion.addEventListener('change', function () { if (motion.matches) stopSpin(); });
  placeCurrent.addEventListener('click', function () { serve(); }); nextDish.addEventListener('click', skipDish);
  retry.addEventListener('click', loadMenu); el('restart').addEventListener('click', function () { resetRound(true); announce('餐桌已清空，可以重新摆放。 Your table is cleared and ready to set again.'); });
  send.addEventListener('click', shareTable);
  loadMenu();
})();
