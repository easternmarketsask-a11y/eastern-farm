/**
 * weather.js — Live Saskatoon weather from Open-Meteo (free, no API key).
 *
 * Cached in localStorage for 30 minutes to avoid hammering the API on
 * every page load. If the fetch fails (offline, blocked), the chip
 * silently stays empty — no error UI.
 *
 * WMO weather code reference: https://open-meteo.com/en/docs
 * Saskatoon coords: 52.13°N, 106.67°W (Saskatchewan, time-zone Regina).
 */
(function () {
  const CACHE_KEY = 'eastern_farm_weather_v2';
  const CACHE_MS = 30 * 60 * 1000;  // 30 minutes
  const URL = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=52.13&longitude=-106.67'
    + '&timezone=America%2FRegina'
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
    + '&daily=temperature_2m_max,temperature_2m_min&forecast_days=1';

  // WMO code → { emoji, zh, en }
  const CODES = {
    0:  { emoji: '☀️',  zh: '晴',       en: 'Clear' },
    1:  { emoji: '🌤',   zh: '多云',     en: 'Mostly clear' },
    2:  { emoji: '⛅',  zh: '多云',     en: 'Partly cloudy' },
    3:  { emoji: '☁️',  zh: '阴',       en: 'Cloudy' },
    45: { emoji: '🌫',   zh: '雾',       en: 'Fog' },
    48: { emoji: '🌫',   zh: '冻雾',     en: 'Freezing fog' },
    51: { emoji: '🌦',   zh: '毛毛雨',   en: 'Light drizzle' },
    53: { emoji: '🌦',   zh: '毛毛雨',   en: 'Drizzle' },
    55: { emoji: '🌧',   zh: '毛毛雨',   en: 'Heavy drizzle' },
    56: { emoji: '🌧',   zh: '冻雨',     en: 'Freezing drizzle' },
    57: { emoji: '🌧',   zh: '冻雨',     en: 'Freezing drizzle' },
    61: { emoji: '🌧',   zh: '小雨',     en: 'Light rain' },
    63: { emoji: '🌧',   zh: '中雨',     en: 'Rain' },
    65: { emoji: '🌧',   zh: '大雨',     en: 'Heavy rain' },
    66: { emoji: '🌧',   zh: '冻雨',     en: 'Freezing rain' },
    67: { emoji: '🌧',   zh: '冻雨',     en: 'Freezing rain' },
    71: { emoji: '🌨',   zh: '小雪',     en: 'Light snow' },
    73: { emoji: '❄️',   zh: '中雪',     en: 'Snow' },
    75: { emoji: '❄️',   zh: '大雪',     en: 'Heavy snow' },
    77: { emoji: '❄️',   zh: '雪粒',     en: 'Snow grains' },
    80: { emoji: '🌦',   zh: '阵雨',     en: 'Light showers' },
    81: { emoji: '🌧',   zh: '阵雨',     en: 'Showers' },
    82: { emoji: '⛈',   zh: '大阵雨',   en: 'Heavy showers' },
    85: { emoji: '🌨',   zh: '阵雪',     en: 'Snow showers' },
    86: { emoji: '❄️',   zh: '大阵雪',   en: 'Heavy snow showers' },
    95: { emoji: '⛈',   zh: '雷雨',     en: 'Thunderstorm' },
    96: { emoji: '⛈',   zh: '雷暴',     en: 'Thunderstorm w/ hail' },
    99: { emoji: '⛈',   zh: '雷暴',     en: 'Thunderstorm w/ hail' },
  };

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.fetchedAt > CACHE_MS) return null;
      return obj.data;
    } catch (_) { return null; }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        fetchedAt: Date.now(),
        data,
      }));
    } catch (_) {}
  }

  async function fetchWeather() {
    const cached = readCache();
    if (cached) return cached;
    try {
      const res = await fetch(URL);
      if (!res.ok) throw new Error('http ' + res.status);
      const json = await res.json();
      const c = json.current;
      if (!c || typeof c.temperature_2m !== 'number') throw new Error('bad response');
      const d = json.daily || {};
      const num = (v) => (typeof v === 'number' ? Math.round(v) : null);
      const data = {
        temperatureC: Math.round(c.temperature_2m),
        feelsLikeC: num(c.apparent_temperature),
        humidity: num(c.relative_humidity_2m),
        weatherCode: c.weather_code,
        windKph: c.wind_speed_10m,
        isDay: c.is_day === 1,
        observedAt: c.time,
        highC: (d.temperature_2m_max && d.temperature_2m_max.length) ? Math.round(d.temperature_2m_max[0]) : null,
        lowC: (d.temperature_2m_min && d.temperature_2m_min.length) ? Math.round(d.temperature_2m_min[0]) : null,
      };
      writeCache(data);
      return data;
    } catch (e) {
      console.warn('[weather] fetch failed', e);
      return null;
    }
  }

  function label(data, lang) {
    if (!data) return '';
    const code = CODES[data.weatherCode] || { emoji: '🌡', zh: '', en: '' };
    const wordKey = lang === 'en' ? 'en' : 'zh';
    const cityName = lang === 'en' ? 'Saskatoon' : '萨城';
    return code.emoji + ' ' + cityName + ' ' + data.temperatureC + '°';
  }

  function tooltip(data, lang) {
    if (!data) return '';
    const code = CODES[data.weatherCode] || { zh: '', en: '' };
    const word = lang === 'en' ? code.en : code.zh;
    const wind = (lang === 'en' ? 'Wind ' : '风速 ') + Math.round(data.windKph) + ' km/h';
    return word + ' · ' + wind;
  }

  const weather = {
    data: null,

    async init() {
      // Install chip into brandbar if not already present
      this._installChip();
      const data = await fetchWeather();
      this.data = data;
      this._renderChip();
    },

    refresh() {
      this._renderChip();
    },

    _installChip() {
      if (document.getElementById('weatherChip')) return;
      const brandbar = document.getElementById('brandbar');
      if (!brandbar) return;
      const chip = document.createElement('span');
      chip.id = 'weatherChip';
      chip.className = 'brandbar-weather';
      chip.textContent = '';
      chip.style.cursor = 'pointer';
      chip.onclick = () => this.showDetail();
      brandbar.appendChild(chip);
    },

    // Tap the chip → detailed current Saskatoon weather.
    showDetail() {
      const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
      const d = this.data;
      if (!d) {
        if (Farm.ui) Farm.ui.toast(lang === 'en' ? 'Weather unavailable' : '天气暂不可用', 1800);
        return;
      }
      const code = CODES[d.weatherCode] || { emoji: '🌡', zh: '', en: '' };
      const word = lang === 'en' ? code.en : code.zh;
      const time = (d.observedAt && d.observedAt.length >= 16) ? d.observedAt.slice(11, 16) : '';
      const row = (icon, lbl, val) => (val == null || val === '') ? '' : `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 4px;border-bottom:1px solid var(--border-soft);font-size:14px;">
          <span style="color:var(--warm-text-soft);">${icon} ${lbl}</span>
          <span style="font-weight:700;color:var(--warm-text);">${val}</span>
        </div>`;
      const hl = (d.highC != null && d.lowC != null)
        ? `↑ ${d.highC}°  ↓ ${d.lowC}°` : null;
      const html = `
        <h2 class="modal-title">🌤 ${lang === 'en' ? 'Saskatoon Weather' : '萨斯卡通天气'}</h2>
        <div style="text-align:center;margin:6px 0 14px;">
          <div style="font-size:60px;line-height:1;">${code.emoji}</div>
          <div style="font-size:46px;font-weight:800;color:var(--leaf-dark);margin-top:6px;">${d.temperatureC}°<span style="font-size:24px;">C</span></div>
          <div style="font-size:15px;color:var(--warm-text-soft);margin-top:2px;">${word}</div>
        </div>
        <div style="background:var(--cream-bg);border-radius:14px;padding:4px 14px;">
          ${row('🌡', lang === 'en' ? 'Feels like' : '体感温度', d.feelsLikeC != null ? d.feelsLikeC + '°C' : null)}
          ${row('📈', lang === 'en' ? 'Today high / low' : '今日最高 / 最低', hl)}
          ${row('💧', lang === 'en' ? 'Humidity' : '湿度', d.humidity != null ? d.humidity + '%' : null)}
          ${row('💨', lang === 'en' ? 'Wind' : '风速', Math.round(d.windKph) + ' km/h')}
        </div>
        <div style="text-align:center;font-size:11px;color:var(--warm-text-soft);margin-top:10px;">
          ${lang === 'en' ? 'Updated' : '更新于'} ${time} · Open-Meteo
        </div>
        <div class="btn-row" style="margin-top:12px;">
          <button class="btn" style="width:100%;" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      if (Farm.ui && Farm.ui.showModal) Farm.ui.showModal(html);
      if (Farm.audio) Farm.audio.play('tap');
    },

    _renderChip() {
      const chip = document.getElementById('weatherChip');
      if (!chip) return;
      const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
      const text = label(this.data, lang);
      chip.textContent = text;
      chip.title = tooltip(this.data, lang);
      // Hide if no data
      chip.style.display = text ? '' : 'none';
    },

    // Public: storekeeper.js can pull current temp for context-aware lines
    currentTemp() { return this.data ? this.data.temperatureC : null; },
    currentCode() { return this.data ? this.data.weatherCode : null; },
  };

  window.Farm = window.Farm || {};
  window.Farm.weather = weather;
})();
