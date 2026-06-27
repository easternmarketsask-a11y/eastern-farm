// Generate a REAL data/wc2026.json from ESPN's public (no-key, CORS-open) API.
// node gen_wc2.js <existingWc2026.json> <out.json>
const fs = require('fs');
const https = require('https');

const EXISTING = process.argv[2];
const OUT = process.argv[3];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const SB = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ST = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';

const STAGE_BY_SLUG = {
  'group-stage': 'group',
  'round-of-32': 'r32',
  'round-of-16': 'r16',
  'quarterfinals': 'qf', 'quarter-finals': 'qf',
  'semifinals': 'sf', 'semi-finals': 'sf',
  'third-place': '3p', '3rd-place': '3p', '3rd-place-match': '3p', 'play-off-for-third-place': '3p',
  'final': 'final'
};
const STAGE_CN = { r32: '16强 (R32)', r16: '8强 (R16)', qf: '四分之一决赛', sf: '半决赛', '3p': '三四名决赛', final: '决赛 FINAL' };

(async function () {
  const existing = JSON.parse(fs.readFileSync(EXISTING, 'utf8'));
  const cnMap = {};
  (existing.teams || []).forEach((t) => { cnMap[t.code] = { cn: t.cn, flag: t.flag }; });

  const st = await get(ST);
  const codeGroup = {};
  const groupTeams = {};
  const enName = {};
  (st.children || []).forEach((g) => {
    const letter = (g.name || '').replace(/^Group\s+/i, '').trim();
    groupTeams[letter] = [];
    (g.standings && g.standings.entries || []).forEach((e) => {
      const code = e.team.abbreviation;
      codeGroup[code] = letter;
      enName[code] = e.team.displayName || e.team.shortDisplayName || code;
      groupTeams[letter].push(code);
    });
  });

  const ranges = ['20260611-20260627', '20260628-20260720'];
  const evById = {};
  for (const r of ranges) {
    const sb = await get(SB + '?dates=' + r);
    (sb.events || []).forEach((e) => { evById[e.id] = e; });
  }
  const events = Object.values(evById);

  function minute(c) {
    if (!c || !c.displayValue) return null;
    const m = String(c.displayValue).replace(/'/g, '').trim();
    const n = parseInt(m, 10);
    return isNaN(n) ? m : n;
  }
  function normIso(d) {
    // ESPN dates look like 2026-06-26T19:00Z -> 2026-06-26T19:00:00Z
    if (/T\d\d:\d\dZ$/.test(d)) return d.replace(/Z$/, ':00Z');
    return d;
  }
  const matches = events.map((ev) => {
    const c = ev.competitions[0];
    const slug = (ev.season && ev.season.slug) || '';
    const stage = STAGE_BY_SLUG[slug] || 'group';
    const home = c.competitors.find((x) => x.homeAway === 'home') || c.competitors[0];
    const away = c.competitors.find((x) => x.homeAway === 'away') || c.competitors[1];
    const hc = home.team.abbreviation, ac = away.team.abbreviation;
    const idToCode = {}; c.competitors.forEach((x) => { idToCode[x.team.id] = x.team.abbreviation; });
    const stt = c.status.type;
    const completed = !!stt.completed;
    const inplay = stt.state === 'in';
    const hs = parseInt(home.score, 10), as = parseInt(away.score, 10);
    const hasScore = !isNaN(hs) && !isNaN(as) && (completed || inplay);
    const grp = stage === 'group' ? (codeGroup[hc] || codeGroup[ac] || null) : null;

    const scorers = [];
    (c.details || []).forEach((d) => {
      if (!d.scoringPlay) return;
      const ath = (d.athletesInvolved && d.athletesInvolved[0]) || null;
      scorers.push({
        team: idToCode[d.team && d.team.id] || null,
        player: ath ? (ath.shortName || ath.displayName) : (d.ownGoal ? 'OG' : ''),
        minute: minute(d.clock),
        pen: !!d.penaltyKick,
        og: !!d.ownGoal
      });
    });

    return {
      _date: ev.date,
      stage: stage,
      group: grp,
      kickoffUtc: normIso(ev.date),
      venue: (c.venue && c.venue.fullName) || '',
      city: (c.venue && c.venue.address && c.venue.address.city) || '',
      home: hc, away: ac,
      apiScore: hasScore ? [hs, as] : null,
      apiStatus: stt.shortDetail || stt.detail || '',
      officialScore: completed && hasScore ? [hs, as] : null,
      officialFinal: completed,
      scorers: scorers
    };
  });

  matches.sort((a, b) => new Date(a._date) - new Date(b._date));
  // matchday: within each group, sort its 6 fixtures by kickoff; every 2 = one round.
  const perGroup = {};
  matches.filter((m) => m.stage === 'group' && m.group).forEach((m) => {
    (perGroup[m.group] = perGroup[m.group] || []).push(m);
  });
  Object.keys(perGroup).forEach((g) => {
    perGroup[g].sort((a, b) => new Date(a._date) - new Date(b._date));
    perGroup[g].forEach((m, idx) => { m._md = Math.floor(idx / 2) + 1; });
  });

  matches.forEach((m, i) => {
    m.id = 'M' + String(i + 1).padStart(3, '0');
    if (m.stage === 'group' && m.group) {
      m.round = '小组赛 第' + (m._md || 1) + '轮';
    } else {
      m.round = STAGE_CN[m.stage] || '淘汰赛';
    }
    delete m._date; delete m._md;
  });

  const groupStats = {};
  Object.keys(groupTeams).forEach((g) => {
    const rows = {};
    groupTeams[g].forEach((c) => { rows[c] = { code: c, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, status: 'alive' }; });
    matches.filter((m) => m.stage === 'group' && m.group === g && m.officialScore).forEach((m) => {
      const [h, a] = m.officialScore; const H = rows[m.home], A = rows[m.away];
      if (!H || !A) return;
      H.P++; A.P++; H.GF += h; H.GA += a; A.GF += a; A.GA += h;
      if (h > a) { H.W++; A.L++; } else if (h < a) { A.W++; H.L++; } else { H.D++; A.D++; }
    });
    const arr = Object.values(rows).map((r) => Object.assign(r, { Pts: r.W * 3 + r.D, GD: r.GF - r.GA }));
    arr.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF);
    const allPlayed = arr.every((r) => r.P >= 3);
    arr.forEach((r, idx) => {
      r.status = allPlayed ? (idx < 2 ? 'q' : (idx === 2 ? 'alive' : 'out')) : 'alive';
      delete r.Pts; delete r.GD;
    });
    groupStats[g] = arr;
  });

  const teams = [];
  Object.keys(groupTeams).sort().forEach((g) => {
    groupTeams[g].forEach((code) => {
      const cm = cnMap[code] || {};
      teams.push({ code: code, name: enName[code] || code, cn: cm.cn || code, flag: cm.flag || '🏳️', group: g });
    });
  });

  const out = {
    meta: {
      source: 'ESPN (site.api.espn.com) FIFA World Cup 2026 — real fixtures/scores',
      tz: 'America/Regina (UTC-6, no DST)'
    },
    teams: teams,
    groups: groupTeams,
    groupStats: groupStats,
    matches: matches
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const byStage = {};
  matches.forEach((m) => { byStage[m.stage] = (byStage[m.stage] || 0) + 1; });
  console.log('teams:', teams.length, '| matches:', matches.length, '| byStage:', JSON.stringify(byStage));
  console.log('completed:', matches.filter((m) => m.officialFinal).length, '| with scorers:', matches.filter((m) => m.scorers.length).length);
  console.log('groups:', Object.keys(groupStats).join(','));
  const missCn = teams.filter((t) => t.cn === t.code);
  console.log('teams missing CN:', missCn.length, missCn.map((t) => t.code).join(' '));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
