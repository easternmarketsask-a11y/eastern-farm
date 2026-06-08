/**
 * crops.js — Crop configuration loader and planting/harvest logic.
 */
(function() {
  const crops = {
    catalog: {},          // {cropId: cropDef}
    festivalCrops: {},
    loaded: false,
    onload_callbacks: [],

    async load() {
      try {
        const res = await fetch('../data/crops.json');
        const data = await res.json();
        this.catalog = data.crops || {};
        this.festivalCrops = (data._festival_crops && data._festival_crops) || {};
        // Strip _comment etc from festival crops
        Object.keys(this.festivalCrops).forEach(k => {
          if (k.startsWith('_')) delete this.festivalCrops[k];
        });
        this.loaded = true;
        this.onload_callbacks.forEach(cb => cb());
      } catch (e) {
        console.error('crops load failed', e);
        this.loaded = true;
      }
    },

    onLoad(cb) {
      if (this.loaded) cb();
      else this.onload_callbacks.push(cb);
    },

    get(cropId) {
      return this.catalog[cropId] || this.festivalCrops[cropId];
    },

    all() {
      return Object.values(this.catalog);
    },

    // Available right now: unlocked by player level AND not festival-restricted
    available(playerLevel, activeFestivalId) {
      const list = this.all().filter(c => c.unlock_level <= playerLevel);
      if (activeFestivalId) {
        // Add festival crops for active festival
        Object.values(this.festivalCrops).forEach(fc => {
          if (fc.festival_only === activeFestivalId) list.push(fc);
        });
      }
      return list;
    },

    // ============= Plot helpers =============
    getStage(plot) {
      if (!plot.crop) return -1;
      const def = this.get(plot.crop);
      if (!def) return -1;
      const elapsedMin = (Date.now() - plot.plantedAt) / 60000;
      const growMin = def.grow_minutes;
      if (elapsedMin >= growMin) return 2;     // mature
      if (elapsedMin >= growMin * 0.4) return 1;  // sprout
      return 0;  // seed
    },

    getProgress(plot) {
      if (!plot.crop) return 0;
      const def = this.get(plot.crop);
      if (!def) return 0;
      const elapsedMin = (Date.now() - plot.plantedAt) / 60000;
      return Math.min(1, elapsedMin / def.grow_minutes);
    },

    isMature(plot) {
      return this.getStage(plot) >= 2;
    },

    // ============= Actions =============
    plant(plot, cropId) {
      const def = this.get(cropId);
      if (!def) return { ok: false, reason: 'unknown_crop' };
      if (plot.crop) return { ok: false, reason: 'plot_occupied' };

      if (!Farm.state.useSeed(cropId)) return { ok: false, reason: 'no_seeds' };

      // Capture BEFORE recordPlant adds it — is this a brand-new collection entry?
      const isNewToCollection = !(Farm.state.data.cropsEverGrown || []).includes(cropId);

      plot.crop = cropId;
      plot.plantedAt = Date.now();
      plot.harvestsLeft = def.multi_harvest ? (def.harvest_count || 3) : 1;
      Farm.state.recordPlant(cropId);
      Farm.state.save();

      // Collection-unlock high-light: first time growing this crop is a small
      // milestone — celebrate it instead of letting it pass silently.
      if (isNewToCollection && Farm.ui) {
        const lang = Farm.state.data.language;
        const name = lang === 'en' ? def.name_en : def.name_zh;
        setTimeout(() => {
          Farm.ui.toast('📖 ' + (lang === 'en' ? 'New in collection: ' : '图鉴新增：') + def.icon + ' ' + name, 3000);
          if (Farm.audio) Farm.audio.play('achievement');
          if (Farm.ui.showConfetti) Farm.ui.showConfetti(18, 1500);
        }, 400);
      }
      return { ok: true, crop: def, isNewToCollection };
    },

    harvest(plot) {
      if (!this.isMature(plot)) return { ok: false, reason: 'not_mature' };

      const def = this.get(plot.crop);
      if (!def) return { ok: false, reason: 'unknown' };

      // V2: harvested crops go into warehouse instead of converting
      // directly to coins. Player must deliver to Eastern Market.
      // Block harvest if warehouse is full — otherwise the mature crop
      // would just vanish with nowhere to put it.
      if (Farm.state.isWarehouseFull()) {
        return { ok: false, reason: 'warehouse_full' };
      }

      const cropId = plot.crop;
      const sellPrice = def.sell_price;  // kept in return for display purposes
      const xp = def.xp_reward;

      // Multi-harvest: deduct one harvest, reset growth timer
      plot.harvestsLeft -= 1;
      Farm.state.addToWarehouse(cropId);
      const levelInfo = Farm.state.addXp(xp);
      const activeFest = Farm.events && Farm.events.getActiveFestivalId();
      // Only credit festival-harvest counter when the crop itself is a festival-only crop
      const festForCounter = (def.festival_only && def.festival_only === activeFest) ? activeFest : null;
      Farm.state.recordHarvest(cropId, festForCounter);

      // ============ Variable EP rewards (V1.2 — nerfed for sustainability) ============
      // Each layer fires its OWN /me/earn call so StockWise can enforce
      // per-source caps (e.g., first_harvest_of_day max 1 per 22h).
      const bonusReasons = [];   // for farm.js to render celebratory toasts

      const dayOfWeek = new Date().getDay();  // 0=Sun, 6=Sat
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      // Weekend multiplier applies to small/medium rewards but NOT to jackpot
      // (otherwise a 100 EP jackpot on Sat = 200 EP, too easy a big drop)
      const weekMul = isWeekend ? 2 : 1;

      // Layer 1: random lucky drop (3% chance × +5 base, ×2 weekend → +10 max)
      if (Math.random() < 0.03) {
        const amt = 5 * weekMul;
        Farm.state.addEastPoints(amt, {
          source: isWeekend ? 'harvest_weekend_lucky' : 'harvest_lucky',
          description: 'Lucky drop on harvesting ' + cropId,
        });
        bonusReasons.push({ kind: 'lucky', amount: amt });
      }

      // Layer 2: festival crop fixed bonus (small, ×2 on weekends)
      if (def.east_points_bonus) {
        const amt = def.east_points_bonus * weekMul;
        Farm.state.addEastPoints(amt, {
          source: isWeekend ? 'harvest_weekend_festival' : 'harvest_festival_bonus',
          description: 'Festival crop ' + cropId + ' bonus',
        });
        bonusReasons.push({ kind: 'festival', amount: amt });
      }

      // Layer 3: gold-nugget jackpot — NERFED from 1% × 50-500 → 0.5% × 20-100
      // (weekend multiplier does NOT apply to jackpot, per design)
      if (Math.random() < 0.005) {
        const jackpot = 20 + Math.floor(Math.pow(Math.random(), 2) * 80);  // 20-100, weighted small
        Farm.state.addEastPoints(jackpot, {
          source: 'harvest_jackpot',
          description: 'Golden nugget on ' + cropId,
        });
        bonusReasons.push({ kind: 'jackpot', amount: jackpot });
      }

      // Layer 4: first harvest of the day — NERFED from +10 → +5 (×2 weekend)
      // (separate /me/earn call: server enforces "max once per 22h per user")
      if (Farm.state.markFirstHarvest()) {
        const amt = 5 * weekMul;
        Farm.state.addEastPoints(amt, {
          source: 'first_harvest_of_day',
          description: 'First harvest of the day' + (isWeekend ? ' (weekend ×2)' : ''),
        });
        bonusReasons.push({ kind: 'first_harvest', amount: amt });
      }

      // Sum for the return value + toast rendering
      let bonusPoints = bonusReasons.reduce(function (s, r) { return s + r.amount; }, 0);
      let epCredited = bonusPoints;
      let epQueued = 0;
      const weekendMultiplier = weekMul;  // kept for backwards compat with farm.js toast logic

      if (plot.harvestsLeft > 0) {
        // Multi-harvest crop: restart from regrow time
        const regrowMs = (def.regrow_minutes || def.grow_minutes) * 60000;
        plot.plantedAt = Date.now() - (def.grow_minutes * 60000 - regrowMs);
      } else {
        // Done: clear plot
        plot.crop = null;
        plot.plantedAt = 0;
        plot.harvestsLeft = 0;
      }
      Farm.state.save();

      return {
        ok: true,
        cropId,
        coins: sellPrice,
        xp,
        eastPoints: bonusPoints,
        epCredited,
        epQueued,
        bonusReasons,
        weekendMultiplier,
        levelInfo,
        multiHarvestRemaining: plot.harvestsLeft,
      };
    },

    timeRemaining(plot) {
      if (!plot.crop) return 0;
      const def = this.get(plot.crop);
      if (!def) return 0;
      const elapsedMs = Date.now() - plot.plantedAt;
      const remainMs = def.grow_minutes * 60000 - elapsedMs;
      return Math.max(0, remainMs);
    },

    formatTimeRemaining(ms) {
      if (ms <= 0) return '✓';
      const totalSec = Math.ceil(ms / 1000);
      if (totalSec < 60) return totalSec + 's';
      const min = Math.floor(totalSec / 60);
      if (min < 60) return min + 'm';
      const hr = Math.floor(min / 60);
      const restMin = min - hr * 60;
      return hr + 'h' + (restMin > 0 ? restMin + 'm' : '');
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.crops = crops;
})();
