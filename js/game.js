// DEEP CUT game UI
(function () {
  const VER = '1.0.0';
  const $ = (id) => document.getElementById(id);
  const T = DC.TIER_INFO;
  DC.cats.forEach(DC.build);
  const PROMPTS = DC.genPrompts();

  // ---------- save ----------
  const KEY = 'deepcut_v1';
  const S = Object.assign({ seen: {}, rounds: 0, recentCats: [], best: {}, cuts: [], tiers: [0, 0, 0, 0, 0, 0, 0], answered: 0, daily: {}, sound: true, starSum: 0 }, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  // ---------- sound (soft, short) ----------
  let ac = null;
  function tone(f, d = 0.09, type = 'sine', vol = 0.06, delay = 0) {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + 0.02);
    } catch (e) {}
  }
  const SFX = {
    rung: (i) => tone(330 * Math.pow(1.19, i), 0.12, 'triangle', 0.05),
    miss: () => tone(150, 0.14, 'square', 0.025),
    legend: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.06, i * 0.08)),
    star: (i) => tone(600 + i * 120, 0.15, 'sine', 0.05),
  };

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nice = (s) => DC.title(s);
  function show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id)); window.scrollTo(0, 0); }
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 1800); }
  const today = () => new Date().toISOString().slice(0, 10);
  function shuffle(a, r = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const STAR = '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/>';
  function starSvg(fill, i) {
    const id = 'sg' + i + Math.random().toString(36).slice(2, 6);
    return `<svg class="st" style="animation-delay:${0.25 + i * 0.18}s" viewBox="0 0 24 24"><defs><linearGradient id="${id}"><stop offset="${fill * 100}%" stop-color="#ffc93c"/><stop offset="${fill * 100}%" stop-color="#252c3b"/></linearGradient></defs><g fill="url(#${id})" stroke="${fill > 0 ? '#8a6400' : '#3a4356'}" stroke-width="1">${STAR}</g></svg>`;
  }
  function ladderHTML() {
    let h = '';
    for (let t = 1; t <= 6; t++) h += `<div class="rung r${t}" data-t="${t}"><i></i><span>${T[t].name}</span><span class="p">${t === 6 ? '500 + BONUS' : T[t].pts}</span></div>`;
    return h;
  }
  $('ladder').innerHTML = ladderHTML();
  $('howLadder').innerHTML = ladderHTML();
  $('foot').innerHTML = `v${VER} &middot; ${PROMPTS.length.toLocaleString()} questions &middot; <button class="link" id="sndBtn" style="font-size:11px;padding:0">Sound ${S.sound ? 'on' : 'off'}</button>`;
  $('sndBtn').onclick = () => { S.sound = !S.sound; save(); $('sndBtn').textContent = 'Sound ' + (S.sound ? 'on' : 'off'); };

  // ---------- picking ----------
  function pick(n, theme, daily) {
    let pool = PROMPTS.filter((p) => theme === 'mix' || p.cat.theme === theme);
    const out = [], used = new Set();
    if (daily) {
      const r = DC.rng(DC.hash('deepcut' + today()));
      pool = shuffle(PROMPTS.slice(), r);
    } else {
      const recent = new Set(S.recentCats.slice(-14));
      pool = pool.map((p) => {
        const seen = S.seen[p.id];
        return { p, k: (seen != null ? 1e6 + seen * 10 : 0) + (recent.has(p.cat.id) ? 5000 : 0) + Math.random() * 4000 };
      }).sort((a, b) => a.k - b.k).map((x) => x.p);
    }
    for (const p of pool) { if (out.length >= n) break; if (used.has(p.cat.id)) continue; used.add(p.cat.id); out.push(p); }
    return out;
  }

  // ---------- round ----------
  let R = null, timer = 0;
  let lenSel = 5, themeSel = 'mix';
  function start(n, daily) {
    R = { n, daily, qs: pick(n, daily ? 'mix' : themeSel, daily), i: 0, score: 0, res: [] };
    R.n = R.qs.length;
    $('pips').innerHTML = R.qs.map(() => '<i></i>').join('');
    show('play');
    nextQ();
  }
  function nextQ() {
    const p = R.qs[R.i];
    R.cur = { p, t0: performance.now(), tries: 0, done: false };
    $('qn').textContent = (R.daily ? 'Daily ' : 'Q ') + (R.i + 1) + ' / ' + R.n;
    $('score').textContent = R.score;
    $('cat').textContent = (p.cat.label || p.cat.noun || p.cat.id).toUpperCase();
    $('prompt').textContent = p.q;
    $('card').classList.remove('done', 'legend');
    $('msg').textContent = ''; $('msg').className = 'msg';
    $('ans').value = '';
    $('ladder').querySelectorAll('.rung').forEach((r) => r.classList.remove('lit', 'hit'));
    [...$('pips').children].forEach((el, k) => { if (k === R.i) el.className = 'now'; });
    setTimeout(() => $('ans').focus(), 30);
    cancelAnimationFrame(timer);
    const tick = () => {
      const left = DC.TIME - (performance.now() - R.cur.t0) / 1000;
      const bar = $('timebar');
      bar.style.transform = `scaleX(${Math.max(0, left / DC.TIME)})`;
      bar.classList.toggle('low', left < 6);
      if (left <= 0) return finish(null, 'time');
      timer = requestAnimationFrame(tick);
    };
    tick();
  }
  function submit(e) {
    e && e.preventDefault();
    if (!R || R.cur.done) return;
    const val = $('ans').value.trim();
    if (!val) return;
    const p = R.cur.p, m = DC.check(p, val);
    const card = $('card'), msg = $('msg');
    const bad = (t) => { msg.textContent = t; msg.className = 'msg'; card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); SFX.miss(); $('ans').select(); };
    R.cur.tries++;
    if (!m) return bad('Not on our board. Try another one.');
    if (m.bad === 'letter') return bad('It has to start with “' + p.letter.toUpperCase() + '”.');
    finish(m.a, null, val);
  }
  function finish(a, why, typed) {
    const c = R.cur; if (c.done) return; c.done = true;
    cancelAnimationFrame(timer);
    $('ans').blur();
    const left = Math.max(0, DC.TIME - (performance.now() - c.t0) / 1000);
    const p = c.p;
    const tier = a ? DC.tierOf(a, p) : 0;
    const sc = a ? DC.score(tier, left) : { base: 0, speed: 0, total: 0 };
    R.score += sc.total;
    const an = a ? DC.dname(a, p) : null;
    R.res.push({ q: p.q, ans: an, tier, base: sc.base, total: sc.total, why, legend: p.legend && DC.dname(p.legend, p) });
    S.seen[p.id] = S.rounds; S.recentCats.push(p.cat.id); if (S.recentCats.length > 40) S.recentCats = S.recentCats.slice(-40);
    S.answered++; S.tiers[tier]++;
    if (tier === 6 && !S.cuts.some((x) => x.name === an && x.q === p.q)) S.cuts.unshift({ name: an, q: p.q, d: today() });
    save();

    // reveal
    const card = $('card');
    card.classList.add('done');
    $('yours').textContent = a ? an : why === 'time' ? 'Time’s up' : 'Skipped';
    $('yours').className = 'yours' + (a ? '' : ' none');
    const b = $('badge');
    b.textContent = a ? T[tier].name : 'NO SCORE'; b.className = 'badge ' + (a ? T[tier].cls : 'tb0');
    $('pts').innerHTML = a ? `+${sc.base}${sc.speed ? `<small>+${sc.speed} speed</small>` : ''}` : '+0';
    $('note').textContent = a ? T[tier].note : '';
    const pool = p.pool ? [...p.pool] : p.cat.answers;
    const notMine = (x) => x !== a && x !== p.legend;
    const common = pool.filter((x) => x.tier === 1 && notMine(x)).slice(0, 3);
    const nm = (x) => esc(nice(DC.dname(x, p)));
    const deep = shuffle(pool.filter((x) => x.tier === 5 && notMine(x))).slice(0, 3);
    let oh = '';
    if (common.length) oh += `<div><b>Most said</b><span>${common.map(nm).join(', ')}</span></div>`;
    if (deep.length) oh += `<div><b>Way deeper</b><span>${deep.map(nm).join(', ')}</span></div>`;
    if (p.legend) oh += tier === 6 ? `<div class="dc"><b>Deep Cut</b><span>You found it.</span></div>` : `<div class="dc"><b>The Deep Cut</b><span>${nm(p.legend)}</span></div>`;
    $('others').innerHTML = oh;
    const pip = $('pips').children[R.i]; if (pip) pip.className = 'p' + tier;
    $('score').textContent = R.score;
    $('nextBtn').textContent = R.i + 1 >= R.n ? 'See results' : 'Next';
    // climb the ladder
    const rungs = [...$('ladder').querySelectorAll('.rung')];
    for (let t = 1; t <= tier; t++) setTimeout(() => {
      const r = rungs[t - 1]; r.classList.add('lit'); SFX.rung(t);
      if (t === tier) { r.classList.add('hit'); if (tier === 6) { card.classList.add('legend'); SFX.legend(); toast('Deep Cut found'); } }
    }, 120 + t * 140);
    if (!a) SFX.miss();
  }

  const GRADES = ['Ice cold', 'Basic', 'Getting there', 'Solid round', 'Deep thinker', 'Certified Deep Cut'];
  function results() {
    S.rounds++;
    const st = DC.stars(R.res);
    S.starSum = (S.starSum || 0) + st;
    let rec = '';
    if (R.daily) {
      if (!S.daily[today()]) { S.daily[today()] = { score: R.score, stars: st }; rec = 'Daily 5 locked in'; }
      else rec = 'Practice run (first try today: ' + S.daily[today()].score + ')';
    } else {
      const k = String(R.n) + (themeSel === 'mix' ? '' : ':' + themeSel);
      if (!S.best[k] || R.score > S.best[k]) { if (S.best[k]) rec = 'New record'; S.best[k] = R.score; }
      else rec = 'Best: ' + S.best[k];
    }
    save();
    show('results');
    $('resTitle').textContent = R.daily ? 'Daily 5 · ' + today() : R.n + '-question round';
    let sh = '';
    for (let i = 0; i < 5; i++) sh += starSvg(Math.max(0, Math.min(1, st - i)), i);
    $('stars').innerHTML = sh;
    for (let i = 0; i < Math.ceil(st); i++) setTimeout(() => SFX.star(i), 250 + i * 180);
    $('grade').textContent = GRADES[Math.floor(st)] + ' · ' + st + ' / 5';
    $('rec').textContent = rec;
    // count up
    const tgt = R.score, t0 = performance.now();
    (function up() { const f = Math.min(1, (performance.now() - t0) / 900); $('resTotal').textContent = Math.round(tgt * (1 - Math.pow(1 - f, 3))); if (f < 1) requestAnimationFrame(up); })();
    $('reslist').innerHTML = R.res.map((r) => `<div class="ri k${r.tier}"><div class="rq">${esc(r.q)}</div><div><div class="ra">${r.ans ? esc(r.ans) : r.why === 'time' ? 'Time’s up' : 'Skipped'}</div><div class="rt">${r.tier ? T[r.tier].name : 'NO SCORE'}${r.tier !== 6 && r.legend ? ' · Deep Cut: ' + esc(nice(r.legend)) : ''}</div></div><div class="rp">${r.total}</div></div>`).join('');
  }

  function vault() {
    const tot = PROMPTS.length, seen = Object.keys(S.seen).length;
    const deep = S.tiers[4] + S.tiers[5] + S.tiers[6];
    const avgSt = S.rounds ? (S.starSum / S.rounds).toFixed(1) : '-';
    const best = (n) => Math.max(S.best[n] || 0, S.best[n + ':nature'] || 0, S.best[n + ':world'] || 0, S.best[n + ':pop'] || 0) || '-';
    $('stats').innerHTML = [
      [S.rounds, 'Rounds played'], [avgSt, 'Avg stars'], [S.cuts.length, 'Deep cuts found'], [S.answered ? Math.round((deep / S.answered) * 100) + '%' : '-', 'Obscure or deeper'],
      [best(3), 'Best 3-round'], [best(5), 'Best 5-round'], [best(7), 'Best 7-round'], [best(10), 'Best 10-round'],
      [seen.toLocaleString() + ' / ' + tot.toLocaleString(), 'Questions seen'], [S.daily[today()] ? S.daily[today()].score : '-', 'Daily 5 today'],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    $('cuts').innerHTML = S.cuts.length ? S.cuts.map((c) => `<div class="cut"><b>${esc(c.name)}</b><span>${esc(c.q)}<br>${c.d}</span></div>`).join('') : '<div class="empty">None yet. Every question hides one. Go deep.</div>';
    show('vault');
  }

  function refreshHome() {
    const d = S.daily[today()];
    $('dailySub').textContent = d ? 'Today: ' + d.score + ' pts · ' + d.stars + ' stars' : 'Same 5 for everyone today';
    $('vaultSub').textContent = S.cuts.length ? S.cuts.length + ' deep cut' + (S.cuts.length === 1 ? '' : 's') + ' found' : 'Your deep cuts + records';
    show('home');
  }

  // ---------- wiring ----------
  $('lens').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; lenSel = +b.dataset.n; $('lens').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); };
  $('themes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; themeSel = b.dataset.t; $('themes').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); };
  $('playBtn').onclick = () => start(lenSel, false);
  $('dailyBtn').onclick = () => start(5, true);
  $('vaultBtn').onclick = vault;
  $('howBtn').onclick = () => show('how');
  document.querySelectorAll('[data-home]').forEach((b) => (b.onclick = refreshHome));
  $('ansForm').onsubmit = submit;
  $('skipBtn').onclick = () => finish(null, 'skip');
  $('nextBtn').onclick = () => { R.i++; if (R.i >= R.n) results(); else nextQ(); };
  $('quitBtn').onclick = () => { if (confirm('Quit this round?')) { cancelAnimationFrame(timer); R = null; refreshHome(); } };
  $('againBtn').onclick = () => start(R.daily ? lenSel : R.n, false);
  $('homeBtn').onclick = refreshHome;
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && R && R.cur && R.cur.done && $('play').classList.contains('on')) { e.preventDefault(); $('nextBtn').click(); } });
  refreshHome();
  window.__dc = { PROMPTS, S, start, get R() { return R; } };
})();
