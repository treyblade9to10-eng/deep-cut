// DEEP CUT core: data registry, answer matching, prompt generation, scoring
(function () {
  const TIERS = ['t1', 't2', 't3', 't4', 't5'];
  const DC = (window.DC = {
    cats: [],
    theme: 'mix',
    add(c) { c.theme = c.theme || this.theme; this.cats.push(c); },
  });

  // ---------- text helpers ----------
  function norm(s) {
    s = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    s = s.replace(/^(the|a|an) /, '');
    return s;
  }
  function singular(s) {
    if (s.length < 4) return s;
    if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
    if (/(ch|sh|x|ss|z)es$/.test(s)) return s.slice(0, -2);
    if (/[^s]s$/.test(s)) return s.slice(0, -1);
    return s;
  }
  function compact(s) { return s.replace(/ /g, ''); }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i; let best = i;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2] + 1);
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function article(noun) {
    if (/^(us |u\.s|uni|use|euro|one|ufo)/i.test(noun)) return 'a';
    if (/^[A-Z]{2,3}\b/.test(noun)) return /^[AEFHILMNORSX]/.test(noun) ? 'an' : 'a';
    return /^[aeiou]/i.test(noun) ? 'an' : 'a';
  }
  function title(s) { return s.replace(/(^|[\s\-\/(])([a-z])/g, (m, p, c) => p + c.toUpperCase()); }

  // ---------- build category indexes ----------
  function build(c) {
    c.answers = [];
    TIERS.forEach((t, ti) => {
      String(c[t] || '').split('|').forEach((raw) => {
        raw = raw.trim(); if (!raw) return;
        const names = raw.split('/').map((x) => x.trim()).filter(Boolean);
        c.answers.push({ name: names[0], names, keys: names.map(norm).filter(Boolean), tier: ti + 1 });
      });
    });
    if (c.legend) {
      const names = String(c.legend).split('/').map((x) => x.trim()).filter(Boolean);
      const keys = names.map(norm);
      // if a helper also put the legend inside a tier, pull it out
      c.answers = c.answers.filter((a) => !a.keys.some((k) => keys.includes(k)));
      c.answers.push({ name: names[0], names, keys, tier: 6, legend: true });
    }
    c.idx = new Map();
    const put = (k, a) => { if (k && !c.idx.has(k)) c.idx.set(k, a); };
    for (const a of c.answers) for (const k of a.keys) put(k, a);
    for (const a of c.answers) for (const k of a.keys) { put(compact(k), a); put(singular(k), a); put(compact(singular(k)), a); }
    c.keyList = [...c.idx.keys()];
  }

  // match a typed answer inside a category, optional pool filter
  function match(c, input, pool) {
    const k = norm(input);
    if (!k) return null;
    const ok = (a) => !pool || pool.has(a);
    for (const v of [k, compact(k), singular(k), compact(singular(k))]) {
      const a = c.idx.get(v); if (a && ok(a)) return { a, key: v, exact: true };
    }
    const ck = compact(k);
    const max = ck.length <= 4 ? 0 : ck.length <= 7 ? 1 : 2;
    if (!max) return null;
    let best = null, bd = max + 1;
    for (const key of c.keyList) {
      const kk = compact(key);
      if (kk.length < 4) continue;
      const d = lev(ck, kk, Math.min(max, kk.length <= 7 ? 1 : 2));
      if (d < bd) { const a = c.idx.get(key); if (ok(a)) { bd = d; best = { a, key, exact: false }; if (d === 0) break; } }
    }
    return best;
  }

  // ---------- prompts ----------
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  function genPrompts() {
    const out = [];
    for (const c of DC.cats) {
      const legend = c.answers.find((a) => a.legend);
      out.push({ id: c.id, cat: c, q: c.q, letter: null, legend, pool: null, size: c.answers.length });
      if (!c.noun || c.noLetters || c.answers.length < 40) continue;
      const vars = [];
      for (const L of LETTERS) {
        const pool = c.answers.filter((a) => a.keys.some((k) => k[0] === L));
        const deep = pool.filter((a) => a.tier >= 4);
        const easy = pool.filter((a) => a.tier <= 2);
        if (pool.length < 9 || deep.length < 3 || easy.length < 1) continue;
        vars.push({ L, pool, deep });
      }
      vars.sort((a, b) => b.pool.length - a.pool.length);
      const keep = vars.slice(0, Math.max(4, Math.min(26, Math.floor(c.answers.length / 12))));
      for (const v of keep) {
        const top = v.pool.filter((a) => a.tier >= 5);
        const lg = v.pool.find((a) => a.legend) || (top.length ? top : v.deep)[hash(c.id + v.L) % (top.length || v.deep.length)];
        out.push({
          id: c.id + ':' + v.L, cat: c, letter: v.L, legend: lg, pool: new Set(v.pool), size: v.pool.length,
          q: 'Name ' + article(c.noun) + ' ' + c.noun + ' that starts with “' + v.L.toUpperCase() + '”',
        });
      }
    }
    return out;
  }

  // display name for an answer inside a prompt (letter prompts show the alias that starts with the letter)
  function dname(a, p) {
    if (p && p.letter) { const n = a.names.find((x) => norm(x)[0] === p.letter); if (n) return n; }
    return a.name;
  }
  // tier of an answer inside a prompt (letter prompts promote their chosen deep cut to tier 6)
  function tierOf(a, p) { return a === p.legend ? 6 : Math.min(a.tier, 5); }
  function check(p, input) {
    const k = norm(input);
    if (p.letter) {
      if (k[0] !== p.letter) {
        const any = match(p.cat, input);
        return any ? { bad: 'letter', a: any.a } : null;
      }
      return match(p.cat, input, p.pool);
    }
    return match(p.cat, input);
  }

  // ---------- scoring ----------
  const TIER_INFO = [
    null,
    { name: 'BASIC', pts: 10, cls: 'tb1', note: 'Everybody says that one' },
    { name: 'SOLID', pts: 30, cls: 'tb2', note: 'Common, but not the first thing people say' },
    { name: 'DEEP', pts: 60, cls: 'tb3', note: 'People know it, almost nobody says it' },
    { name: 'OBSCURE', pts: 120, cls: 'tb4', note: 'Real nerd territory' },
    { name: 'NICHE', pts: 200, cls: 'tb5', note: 'Barely anyone knows that' },
    { name: 'DEEP CUT', pts: 500, cls: 'tb6', note: 'The rarest answer on the board' },
  ];
  const TIME = 25;
  function score(tier, secsLeft) {
    const base = TIER_INFO[tier].pts;
    const speed = Math.round(base * 0.2 * Math.max(0, Math.min(1, secsLeft / TIME)));
    return { base, speed, total: base + speed };
  }
  // stars out of 5 (half steps) from average base points per question
  const STAR_AT = [0, 12, 35, 70, 120, 185];
  function stars(results) {
    if (!results.length) return 0;
    const avg = results.reduce((s, r) => s + (r.base || 0), 0) / results.length;
    let st = 0;
    for (let i = 1; i <= 5; i++) {
      if (avg >= STAR_AT[i]) st = i;
      else { const f = (avg - STAR_AT[i - 1]) / (STAR_AT[i] - STAR_AT[i - 1]); if (f >= 0.5) st += 0.5; break; }
    }
    if (results.some((r) => r.tier === 6)) st = Math.max(st, 3);
    return Math.min(5, st);
  }

  Object.assign(DC, { dname, tierOf, norm, singular, lev, hash, rng, title, build, match, genPrompts, check, score, stars, TIER_INFO, TIME, STAR_AT });
})();
