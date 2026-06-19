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

    _write(q) {
      try { localStorage.setItem(KEY, JSON.stringify(q)); } catch (e) {}
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
      // Try to flush on browser-online + periodically
      window.addEventListener('online', () => this.flush());
      setInterval(() => this.flush(), 60 * 1000);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbQueue = queue;
})();
