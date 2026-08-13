/**
 * firebase-queue.js — Offline retry queue for EP sync events.
 *
 * Stored in localStorage under 'eastern_farm_sync_queue_v1' as a JSON array
 * of pending earn events. Flushed automatically:
 *   - when the browser goes online (navigator.onLine event)
 *   - after a successful login (firebase-auth.js)
 *   - every 60 seconds while online + logged in
 *
 * Items dropped from queue only after a confirmed synced=true result.
 * Idempotency on the server side (eventId dedupe) ensures double-flushes
 * are safe.
 */
(function() {
  const KEY = 'eastern_farm_sync_queue_v1';

  /* 🔒 队列必须有上界（2026-08-13 根因修复）——在此之前它**只进不出**：
     - `enqueue` 无条数上限
     - `flush()` 在「离线 / Firebase 没起来 / 没登录」时**直接 return，一条都不排**，
       而手机上 gstatic CDN 一慢就是这个状态（`Farm.fb.available === false`）
     - 同步失败的（非 422/404）永远留着重试，没有次数和年龄上限
     - `_write` 的 catch 静默吞掉配额错误
     WebKit 的 localStorage 是**独立的 5MB 桶**（跟 storage.estimate() 报的
     origin 配额没关系，Chris 手机实测 3.5MB/39GB 显示 0%，而 localStorage
     已经 5.0MB 撑满）。这个队列涨满之后，**别的所有写入一起失败，包括存档** →
     QuotaExceededError → _saveBlocked → 进度不再保存 + 那句删不掉的提示。

     🔒 存档神圣，队列不神圣。这条队列同步的是东方积分事件，服务端有 eventId
     去重、重发安全；而存档丢了就是玩家的进度没了。**任何时候需要取舍，
     先牺牲队列。** 别把上限调大到又能挤掉存档。 */
  const MAX_ITEMS = 200;               // 超出就丢最老的
  const MAX_AGE_MS = 14 * 24 * 3600 * 1000;   // 两周还没同步上去的，基本永远同步不上去了

  const queue = {
    enqueue(event) {
      const q = this.read();
      q.push({ ...event, queuedAt: Date.now() });
      this._write(q);
    },

    read() {
      try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
      catch { return []; }
    },

    // 老化 + 截断：保留**最新的** MAX_ITEMS 条，并丢掉超龄的。
    // 保新不保旧，因为最近的事件才最可能还同步得上去。
    _prune(q) {
      if (!Array.isArray(q)) return [];
      const cutoff = Date.now() - MAX_AGE_MS;
      let out = q.filter((it) => !it || typeof it.queuedAt !== 'number' || it.queuedAt >= cutoff);
      if (out.length > MAX_ITEMS) out = out.slice(out.length - MAX_ITEMS);
      return out;
    },

    _write(q) {
      const pruned = this._prune(q);
      if (pruned.length < q.length) {
        console.warn('[fb-queue] 丢弃 ' + (q.length - pruned.length) + ' 条超龄/超量事件');
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(pruned));
        return true;
      } catch (e) {
        /* 写不进去 = 存储已满。绝不能像以前那样静默吞掉：这条队列正是把桶
           撑满的元凶，此刻**必须自己让路**，否则存档也跟着写不进去。
           先整个清空（队列可牺牲），再退到删掉这个键。 */
        console.warn('[fb-queue] 存储写不进，队列让路', e && e.name);
        try { localStorage.setItem(KEY, '[]'); return false; } catch (e2) {}
        try { localStorage.removeItem(KEY); } catch (e3) {}
        return false;
      }
    },

    // 给存储自愈用（state.js 写存档失败时调）：把队列缩到最小，腾出空间。
    // 返回腾出了多少字节（UTF-16 计量，和 WebKit 算配额的口径一致）。
    reclaim() {
      let freed = 0;
      try {
        const raw = localStorage.getItem(KEY) || '';
        freed = (KEY.length + raw.length) * 2;
        localStorage.removeItem(KEY);
      } catch (e) { /* 读不到就当没有 */ }
      return freed;
    },

    size() { return this.read().length; },

    async flush() {
      if (!navigator.onLine) return;
      if (!Farm.fb || !Farm.fb.available) return;
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return;
      const q = this.read();
      if (q.length === 0) return;
      const remaining = [];
      for (const item of q) {
        try {
          const r = item.kind === 'spend'
            ? await Farm.fbPoints.syncEpSpend(item.amount, item.source, item.description, item.eventId)
            : await Farm.fbPoints.syncEpEarn (item.amount, item.source, item.description, item.eventId);
          // Keep on transient failure (network/5xx) and while sync is paused; but DROP
          // terminal rejections (422 bad data / 404 endpoint gone) — they can never
          // succeed, so retaining them retries every 60s forever (console spam, since 422
          // doesn't trip the circuit breaker).
          const terminal = r && r.rejected && (r.code === 422 || r.code === 404);
          if (!r.synced && !terminal) remaining.push(item);
        } catch (e) {
          remaining.push(item);
        }
      }
      this._write(remaining);
      if (remaining.length < q.length) {
        console.log(`[fb-queue] flushed ${q.length - remaining.length} events; ${remaining.length} remain`);
      }
    },

    install() {
      /* 🔒 开机就先裁一刀，别等下一次 EP 事件。
         已经被撑到几 MB 的设备（Chris 2026-08-13 实测 localStorage 5.0MB 满桶）
         如果要等到玩家赚一次积分才触发 _write，那在此之前存档一直写不进去 ——
         而「存档写不进去」正是他看到的症状。裁剪只在真的超量时才写回，
         正常设备一个字节都不动。 */
      try {
        const q = this.read();
        const pruned = this._prune(q);
        if (pruned.length !== q.length) {
          console.warn('[fb-queue] 开机裁剪：' + q.length + ' → ' + pruned.length + ' 条');
          this._write(pruned);
        }
      } catch (e) { /* 裁剪失败绝不影响游戏 */ }
      // Try to flush on browser-online + periodically
      window.addEventListener('online', () => this.flush());
      setInterval(() => this.flush(), 60 * 1000);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbQueue = queue;
})();
