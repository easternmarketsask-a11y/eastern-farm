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

      plot.crop = cropId;
      plot.plantedAt = Date.now();
      plot.harvestsLeft = def.multi_harvest ? (def.harvest_count || 3) : 1;
      Farm.state.recordPlant(cropId);
      Farm.state.save();
      return { ok: true, crop: def };
    },

    harvest(plot) {
      if (!this.isMature(plot)) return { ok: false, reason: 'not_mature' };

      const def = this.get(plot.crop);
      if (!def) return { ok: false, reason: 'unknown' };

      const cropId = plot.crop;
      const sellPrice = def.sell_price;
      const xp = def.xp_reward;

      // Multi-harvest: deduct one harvest, reset growth timer
      plot.harvestsLeft -= 1;
      Farm.state.addCoins(sellPrice);
      const levelInfo = Farm.state.addXp(xp);
      const activeFest = Farm.events && Farm.events.getActiveFestivalId();
      // Only credit festival-harvest counter when the crop itself is a festival-only crop
      const festForCounter = (def.festival_only && def.festival_only === activeFest) ? activeFest : null;
      Farm.state.recordHarvest(cropId, festForCounter);

      // Random East Point chance
      let bonusPoints = 0;
      if (Math.random() < 0.05) bonusPoints += 1;
      // Festival crops give bonus
      if (def.east_points_bonus) bonusPoints += def.east_points_bonus;
      if (bonusPoints > 0) Farm.state.addEastPoints(bonusPoints);

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
