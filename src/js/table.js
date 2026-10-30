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
  var seatEls = Array.prototype.slice.call(document.querySelectorAll('.seat'));
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { queue: [], current: null, seats: [null, null, null], done: false };
  var drag = null;
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

  function nearestSeat(x, y) {
    var best = null;
    var bestD = Infinity;
    seatEls.forEach(function (el, i) {
      if (state.seats[i] && !(drag && drag.origin === i)) return;
      var r = el.getBoundingClientRect();
      var d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < r.width * 0.72 && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  function showNote(text) {
    note.hidden = false;
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { note.hidden = true; }, 2600);
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
    if (!drag || e.pointerId !== drag.pid) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.far = true;
    drag.plate.style.left = (e.clientX - drag.dx) + 'px';
    drag.plate.style.top = (e.clientY - drag.dy) + 'px';
    highlight(nearestSeat(e.clientX, e.clientY));
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    var plate = drag.plate;
    var origin = drag.origin;
    var far = drag.far;
    var seat = nearestSeat(e.clientX, e.clientY);
    var below = e.clientY > table.getBoundingClientRect().bottom + 6;
    highlight(-1);
    drag = null;

    if (!far) {
      if (origin === 'pass') land(plate, pass, false);
      else land(plate, seatEls[origin], false);
      return;
    }
    if (seat !== null) {
      place(origin, seat, plate);
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
    surface.classList.add('is-set');
    settle.hidden = false;
    settleEn.hidden = false;
    hours.hidden = false;
    send.hidden = false;
    note.hidden = true;
    menu.hidden = false;
    menu.innerHTML = '';
    state.seats.forEach(function (dish, i) {
      var li = document.createElement('li');
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

  send.addEventListener('click', function () {
    var lines = state.seats.map(function (d) { return d.zh + '  ' + d.en; }).join('\n');
    var text = '这桌好了\n' + lines + '\n东方超市 Eastern Market';
    var url = location.href;
    if (navigator.share) {
      navigator.share({ title: '东家一桌', text: text, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + '\n' + url).then(function () {
        send.textContent = '已经抄好了';
      }).catch(function () {});
    }
  });

  fetch('../data/table-set.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var dishes = data.dishes.slice();
      state.current = dishes.shift();
      state.queue = dishes;
      dishes.concat(state.current ? [state.current] : []).forEach(function (d) {
        var img = new Image();
        img.src = d.image;
      });
      renderPass();
    })
    .catch(function () {
      pass.textContent = '这桌还没摆好。请再打开一次。';
    });
})();
