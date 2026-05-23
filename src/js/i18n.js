/**
 * i18n.js — Bilingual string lookup.
 * Loads data/i18n.json at startup. Falls back to key if missing.
 */
(function() {
  const i18n = {
    strings: {},
    storekeeper_pool_zh: [],
    storekeeper_pool_en: [],
    language: 'zh',
    loaded: false,
    onload_callbacks: [],

    async load() {
      try {
        const res = await fetch('../data/i18n.json');
        const data = await res.json();
        this.strings = data.strings || {};
        this.storekeeper_pool_zh = data._storekeeper_pool_default_zh || [];
        this.storekeeper_pool_en = data._storekeeper_pool_default_en || [];
        this.loaded = true;
        this.onload_callbacks.forEach(cb => cb());
      } catch (e) {
        console.error('i18n load failed', e);
        this.loaded = true;  // fall back to keys
      }
    },

    onLoad(cb) {
      if (this.loaded) cb();
      else this.onload_callbacks.push(cb);
    },

    setLanguage(lang) {
      this.language = lang === 'en' ? 'en' : 'zh';
      this.applyAll();
    },

    t(key, vars) {
      const entry = this.strings[key];
      if (!entry) return key;
      let text = entry[this.language] || entry.zh || key;
      if (vars) {
        Object.keys(vars).forEach(k => {
          text = text.replaceAll('{' + k + '}', vars[k]);
        });
      }
      return text;
    },

    applyAll() {
      // Update all elements with data-i18n attribute
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = this.t(key);
      });
    },

    randomStorekeeperLine() {
      const pool = this.language === 'en' ? this.storekeeper_pool_en : this.storekeeper_pool_zh;
      if (pool.length === 0) return this.language === 'en' ? 'Hello!' : '你好!';
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.i18n = i18n;
})();
