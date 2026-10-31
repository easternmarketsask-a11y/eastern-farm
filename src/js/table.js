(function () {
  var pass = document.getElementById('pass');
  var surface = document.getElementById('surface');
  var table = document.getElementById('table');
  var world = document.getElementById('world');
  var settle = document.getElementById('settle');
  var settleEn = document.getElementById('settleEn');
  var hours = document.getElementById('hours');
  var send = document.getElementById('send');
  var note = document.getElementById('note');
  var menu = document.getElementById('menu');
  var turnHint = document.getElementById('turnHint');
  var readyCopy = document.getElementById('readyCopy');
  var readyCopyEn = document.getElementById('readyCopyEn');
  var seatEls = Array.prototype.slice.call(document.querySelectorAll('.seat'));
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { queue: [], current: null, seats: [], done: false };
  var drag = null;
  var rotation = {
    angle: 0,
    raf: 0,
    lastTime: 0,
    drag: null,
    velocity: 0,
    keyTimer: 0,
    suppressClickPlate: null,
    suppressClickTimer: 0
  };
  var ROTATION_DEGREES_PER_PIXEL = 1.05;
  var SPIN_FRICTION_MS = 420;
  var MAX_SPIN_SPEED = 1.4;
  var MIN_SPIN_SPEED = 0.025;
  var audioCtx = null;
  var noteTimer = 0;

  function ceramic() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(740, t);
      o.frequency.exponentialRampToValueAtTime(280, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.13);
    } catch (e) {}
  }

  function emptyCount() {
    var n = 0;
    for (var i = 0; i < state.seats.length; i++) if (!state.seats[i]) n++;
    return n;
  }

  function canPass() {
    return state.queue.length >= emptyCount();
  }

  function makePlate(dish) {
    var el = document.createElement('div');
    el.className = 'plate';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', dish.zh);
    var disc = document.createElement('div');
    disc.className = 'disc';
    var img = document.createElement('img');
    img.alt = dish.zh;
    img.draggable = false;
    img.src = dish.image;
    if (dish.focus) img.style.objectPosition = dish.focus;
    disc.appendChild(img);
    el.appendChild(disc);
    var cap = document.createElement('div');
    cap.className = 'cap';
    var zh = document.createElement('p');
    zh.className = 'zh';
    zh.textContent = dish.zh;
    var en = document.createElement('p');
    en.className = 'en';
    en.textContent = dish.en;
    cap.appendChild(zh);
    cap.appendChild(en);
    el.appendChild(cap);
    el.addEventListener('pointerdown', onDown);
    return el;
  }

  function renderPass() {
    pass.innerHTML = '';
    if (state.current && !state.done) pass.appendChild(makePlate(state.current));
  }

  function clearInline(plate) {
    plate.style.position = '';
    plate.style.left = '';
    plate.style.top = '';
    plate.style.width = '';
    plate.style.zIndex = '';
    plate.style.margin = '';
    plate.style.transform = '';
    plate.style.transition = '';
    plate.style.transformOrigin = '';
    plate.classList.remove('is-lifted');
  }

  function highlight(index) {
    seatEls.forEach(function (el, i) {
      el.classList.toggle('is-near', i === index);
    });
  }

  state.seats = seatEls.map(function () { return null; });

  function dishAt(origin) {
    return origin === 'pass' ? state.current : state.seats[origin];
  }

  function accepts(index, dish) {
    if (!dish) return false;
    return seatEls[index].classList.contains('soup') === (dish.role === 'soup');
  }

  function nearestSeat(x, y, dish) {
    var best = null;
    var bestD = Infinity;
    var wrong = null;
    var wrongD = Infinity;
    seatEls.forEach(function (el, i) {
      if (state.seats[i] && !(drag && drag.origin === i)) return;
      var r = el.getBoundingClientRect();
      var d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d >= r.width * 0.85) return;
      if (!accepts(i, dish)) {
        if (d < wrongD) { wrong = i; wrongD = d; }
        return;
      }
      if (d < bestD) { best = i; bestD = d; }
    });
    return { seat: best, wrong: best === null ? wrong : null };
  }

  function showNote(text) {
    note.hidden = false;
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { note.hidden = true; }, 2600);
  }

  function setTableAngle(angle) {
    rotation.angle = ((angle % 360) + 360) % 360;
    surface.style.setProperty('--table-angle', rotation.angle + 'deg');
  }

  function stopSpin() {
    if (rotation.raf) cancelAnimationFrame(rotation.raf);
    rotation.raf = 0;
    rotation.lastTime = 0;
    rotation.velocity = 0;
    surface.classList.remove('is-spinning', 'is-key-turn');
    clearTimeout(rotation.keyTimer);
    rotation.keyTimer = 0;
  }

  function spinFrame(now) {
    if (rotation.lastTime) {
      var elapsed = Math.min(now - rotation.lastTime, 50);
      if (elapsed > 0) {
        setTableAngle(rotation.angle + rotation.velocity * elapsed);
        rotation.velocity *= Math.exp(-elapsed / SPIN_FRICTION_MS);
      }
    }
    rotation.lastTime = now;
    if (Math.abs(rotation.velocity) < MIN_SPIN_SPEED) {
      stopSpin();
      return;
    }
    rotation.raf = requestAnimationFrame(spinFrame);
  }

  function startSpin(velocity) {
    if (reduce || Math.abs(velocity) < MIN_SPIN_SPEED) return;
    rotation.velocity = Math.max(-MAX_SPIN_SPEED, Math.min(MAX_SPIN_SPEED, velocity));
    rotation.lastTime = 0;
    surface.classList.add('is-spinning');
    rotation.raf = requestAnimationFrame(spinFrame);
  }

  function beginManualTurn(e) {
    if (!state.done || !surface.classList.contains('is-ready') || rotation.drag || (e.button != null && e.button !== 0)) return;
    var wasSpinning = surface.classList.contains('is-spinning');
    var plate = e.target.closest ? e.target.closest('.plate') : null;
    stopSpin();
    rotation.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastTime: performance.now(),
      velocity: 0,
      moved: false,
      plate: plate,
      wasSpinning: wasSpinning
    };
    surface.classList.add('is-manual-turn');
    try { surface.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }

  function moveManualTurn(e) {
    if (!rotation.drag || e.pointerId !== rotation.drag.pointerId) return false;
    if (Math.hypot(e.clientX - rotation.drag.startX, e.clientY - rotation.drag.startY) > 8) {
      rotation.drag.moved = true;
    }
    var deltaX = e.clientX - rotation.drag.lastX;
    var now = performance.now();
    var elapsed = Math.max(1, now - rotation.drag.lastTime);
    var deltaAngle = deltaX * ROTATION_DEGREES_PER_PIXEL;
    if (deltaX) {
      setTableAngle(rotation.angle + deltaAngle);
      var instantVelocity = deltaAngle / elapsed;
      var smoothing = Math.min(1, elapsed / 55);
      rotation.drag.velocity += (instantVelocity - rotation.drag.velocity) * smoothing;
    }
    rotation.drag.lastX = e.clientX;
    rotation.drag.lastTime = now;
    return true;
  }

  function endManualTurn(e) {
    if (!rotation.drag || (e.pointerId != null && e.pointerId !== rotation.drag.pointerId)) return false;
    var endedDrag = rotation.drag;
    var idleTime = performance.now() - endedDrag.lastTime;
    var velocity = e.type === 'pointercancel' || idleTime > 120
      ? 0
      : endedDrag.velocity * Math.exp(-idleTime / 140);
    if (endedDrag.plate && (endedDrag.moved || endedDrag.wasSpinning)) {
      rotation.suppressClickPlate = endedDrag.plate;
      clearTimeout(rotation.suppressClickTimer);
      rotation.suppressClickTimer = setTimeout(function () {
        rotation.suppressClickPlate = null;
        rotation.suppressClickTimer = 0;
      }, 400);
    }
    rotation.drag = null;
    surface.classList.remove('is-manual-turn');
    startSpin(velocity);
    return true;
  }

  function turnWithKeyboard(e) {
    if (!state.done || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    stopSpin();
    if (!reduce) surface.classList.add('is-key-turn');
    setTableAngle(rotation.angle + (e.key === 'ArrowRight' ? 20 : -20));
    if (reduce) return;
    rotation.keyTimer = setTimeout(function () {
      surface.classList.remove('is-key-turn');
      rotation.keyTimer = 0;
    }, 320);
  }

  function land(plate, parent, sound, done) {
    var disc = plate.querySelector('.disc');
    var first = disc.getBoundingClientRect();
    var toSeat = parent.classList.contains('seat');
    plate.classList.toggle('is-set', toSeat);
    clearInline(plate);
    parent.appendChild(plate);
    if (toSeat) parent.classList.add('has-plate');
    var last = disc.getBoundingClientRect();
    var dx = first.left - last.left;
    var dy = first.top - last.top;
    var sx = last.width > 1 ? first.width / last.width : 1;
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      plate.style.transition = '';
      plate.style.transform = '';
      plate.style.transformOrigin = '';
      if (sound) ceramic();
      if (done) done();
    }
    if (reduce || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.02)) {
      finish();
      return;
    }
    plate.style.transformOrigin = 'top left';
    plate.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ')';
    requestAnimationFrame(function () {
      plate.style.transition = 'transform .42s cubic-bezier(.22,.61,.2,1)';
      plate.style.transform = 'translate(0px, 0px) scale(1)';
      plate.addEventListener('transitionend', finish);
      setTimeout(finish, 520);
    });
  }

  function onDown(e) {
    if (state.done) return;
    if (e.button != null && e.button !== 0) return;
    var plate = e.currentTarget;
    var seat = plate.closest('.seat');
    var origin = seat ? Number(seat.dataset.seat) : 'pass';
    var disc = plate.querySelector('.disc');
    var rect = disc.getBoundingClientRect();
    drag = {
      plate: plate,
      origin: origin,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      pid: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      far: false
    };
    plate.classList.add('is-lifted');
    plate.style.position = 'fixed';
    plate.style.width = rect.width + 'px';
    plate.style.left = rect.left + 'px';
    plate.style.top = rect.top + 'px';
    plate.style.zIndex = '8';
    plate.style.margin = '0';
    if (seat) seat.classList.remove('has-plate');
    try { plate.setPointerCapture(e.pointerId); } catch (err) {}
    if (!audioCtx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      } catch (err2) {}
    }
    e.preventDefault();
  }

  function onMove(e) {
    if (moveManualTurn(e)) return;
    if (!drag || e.pointerId !== drag.pid) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.far = true;
    drag.plate.style.left = (e.clientX - drag.dx) + 'px';
    drag.plate.style.top = (e.clientY - drag.dy) + 'px';
    highlight(nearestSeat(e.clientX, e.clientY, dishAt(drag.origin)).seat);
  }

  function onUp(e) {
    if (endManualTurn(e)) return;
    if (!drag || e.pointerId !== drag.pid) return;
    var plate = drag.plate;
    var origin = drag.origin;
    var far = drag.far;
    var hit = nearestSeat(e.clientX, e.clientY, dishAt(origin));
    var below = e.clientY > table.getBoundingClientRect().bottom + 6;
    highlight(-1);
    drag = null;

    if (!far) {
      if (origin === 'pass') land(plate, pass, false);
      else land(plate, seatEls[origin], false);
      return;
    }
    if (hit.seat !== null) {
      place(origin, hit.seat, plate);
      return;
    }
    if (hit.wrong !== null) {
      if (origin === 'pass') land(plate, pass, false);
      else land(plate, seatEls[origin], false);
      showNote(dishAt(origin) && dishAt(origin).role === 'soup' ? '汤放在中间的碗里。' : '这只碗是用来放汤的。');
      return;
    }
    if (origin === 'pass' && below) {
      if (!canPass()) {
        land(plate, pass, false);
        showNote('这盘留下吧，不然这桌坐不满。');
        return;
      }
      passAside(plate);
      return;
    }
    if (origin === 'pass') {
      land(plate, pass, false);
      return;
    }
    returnToHand(origin, plate);
  }

  function place(origin, seat, plate) {
    var dish = origin === 'pass' ? state.current : state.seats[origin];
    if (origin !== 'pass') state.seats[origin] = null;
    if (origin === 'pass') state.current = state.queue.shift() || null;
    state.seats[seat] = dish;
    land(plate, seatEls[seat], true, function () {
      if (state.seats.every(function (s) { return s; })) finish();
    });
    if (origin === 'pass') renderPass();
    seatEls.forEach(function (el, i) {
      if (i !== seat) el.classList.toggle('has-plate', !!state.seats[i]);
    });
  }

  function returnToHand(origin, plate) {
    var dish = state.seats[origin];
    state.seats[origin] = null;
    if (state.current) state.queue.unshift(state.current);
    state.current = dish;
    pass.innerHTML = '';
    land(plate, pass, false);
    seatEls[origin].classList.remove('has-plate');
  }

  function passAside(plate) {
    var dish = state.current;
    state.queue.push(dish);
    state.current = state.queue.shift() || null;
    plate.classList.add('is-leaving');
    var gone = false;
    function next() {
      if (gone) return;
      gone = true;
      if (plate.parentNode) plate.remove();
      renderPass();
    }
    if (reduce) next();
    else {
      plate.addEventListener('animationend', next);
      setTimeout(next, 460);
    }
  }

  function finish() {
    if (state.done) return;
    state.done = true;
    world.classList.add('is-ready');
    surface.classList.add('is-complete');
    var hintRevealed = false;
    function revealTurnHint() {
      if (hintRevealed) return;
      hintRevealed = true;
      surface.classList.add('is-ready');
      surface.tabIndex = 0;
      if (reduce) turnHint.textContent = '左右拖动桌面可转动。 · Drag left or right to turn.';
      turnHint.hidden = false;
    }
    if (reduce) {
      setTableAngle(0);
      revealTurnHint();
    } else {
      var onInitialTurnEnd = function (e) {
        if (e.target !== surface || e.propertyName !== 'transform') return;
        surface.removeEventListener('transitionend', onInitialTurnEnd);
        revealTurnHint();
      };
      surface.addEventListener('transitionend', onInitialTurnEnd);
      setTimeout(function () {
        surface.removeEventListener('transitionend', onInitialTurnEnd);
        revealTurnHint();
      }, 1950);
      setTableAngle(12);
    }
    settle.hidden = false;
    settleEn.hidden = false;
    readyCopy.hidden = false;
    readyCopyEn.hidden = false;
    hours.hidden = false;
    send.hidden = false;
    note.hidden = true;
    menu.hidden = false;
    menu.innerHTML = '';
    state.seats.forEach(function (dish, i) {
      var li = document.createElement('li');
      li.style.animationDelay = Math.min(i * 90, 360) + 'ms';
      var a = document.createElement('a');
      a.href = dish.recipe;
      a.target = '_blank';
      a.rel = 'noopener';
      var zh = document.createElement('span');
      zh.className = 'zh';
      zh.textContent = dish.zh;
      var en = document.createElement('span');
      en.className = 'en';
      en.textContent = dish.en;
      a.appendChild(zh);
      a.appendChild(en);
      li.appendChild(a);
      menu.appendChild(li);
      var plate = seatEls[i].querySelector('.plate');
      if (plate) {
        plate.addEventListener('click', function () {
          window.open(dish.recipe, '_blank', 'noopener');
        });
      }
    });
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  surface.addEventListener('pointerdown', beginManualTurn);
  surface.addEventListener('keydown', turnWithKeyboard);
  surface.addEventListener('click', function (e) {
    var plate = e.target.closest ? e.target.closest('.plate') : null;
    if (!plate || plate !== rotation.suppressClickPlate) return;
    rotation.suppressClickPlate = null;
    clearTimeout(rotation.suppressClickTimer);
    rotation.suppressClickTimer = 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  send.addEventListener('click', function () {
    var lines = state.seats.map(function (d) { return d.zh + '  ' + d.en; }).join('\n');
    var text = '今晚餐桌\n' + lines + '\n东方超市 Eastern Market';
    var url = location.href;
    if (navigator.share) {
      navigator.share({ title: '今晚餐桌', text: text, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + '\n' + url).then(function () {
        send.textContent = '已经抄好了';
      }).catch(function () {});
    }
  });

  function acceptSet(data) {
    var dishes = (data && data.dishes) ? data.dishes.slice() : [];
    var soups = 0;
    var mains = 0;
    dishes.forEach(function (d) {
      if (d && d.role === 'soup') soups += 1;
      else mains += 1;
    });
    if (soups < 1 || mains < 4) throw new Error('short');
    state.current = dishes.shift();
    state.queue = dishes;
    dishes.concat(state.current ? [state.current] : []).forEach(function (d) {
      var img = new Image();
      img.src = d.image;
    });
    renderPass();
  }

  var liveOpts = { credentials: 'omit', cache: 'no-store' };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    liveOpts.signal = AbortSignal.timeout(4000);
  }
  fetch('https://stockwise-app-873982544406.us-central1.run.app/api/public/tonight-table', liveOpts)
    .then(function (r) {
      if (!r.ok) throw new Error('live');
      return r.json();
    })
    .then(function (data) { return acceptSet(data); })
    .catch(function () {
      return fetch('../data/table-set.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { return acceptSet(data); });
    })
    .catch(function () {
      pass.textContent = '这桌还没摆好。请再打开一次。';
    });
})();
