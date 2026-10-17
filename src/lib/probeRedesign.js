/*
  「线路质量」+「延迟曲线」的渲染和交互。
  从 probe-redesign-reference.html（2026-10-17 LF 确认的样式）原样搬过来：
  原文件里的常量和数据（NOW、START、TOT、LINES、CHART_LINES、DATA）改成 mount() 的参数，
  document.getElementById 改成在 root 里查找，window 上的监听在卸载时移除；
  选中时段虚线框的填充色 #ffffff 改成 var(--sel-fill)（暗色下仍是 #ffffff，亮色下换成深色才看得见）；
  除此之外和参考实现逐行一致，改外观和交互请先改参考文件。
  数据层在 probeData.ts。
*/
export function mount(root, D) {
const M = 60e3;
const { NOW, START, TOT, LINES, CHART_LINES, DATA } = D;
const $ = id => root.querySelector('#' + id);

const f2 = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return f2(d.getHours()) + ':' + f2(d.getMinutes()); };
const md = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };
const rangeTxt = (a, b) => b - a >= 1440 * M ? md(a)
  : (md(a) === md(b - 1) ? md(a) + ' ' + hm(a) + '–' + hm(b) : md(a) + ' ' + hm(a) + '–' + md(b) + ' ' + hm(b));
const ix = t => Math.round((t - START) / M);
const isMobile = () => window.innerWidth < 600;

function agg(i, a, b) {
  const x = Math.max(0, ix(a)), y = Math.min(TOT, ix(b));
  let s = 0, n = 0, mx = 0, mn = Infinity, l = 0;
  for (let k = x; k < y; k++) {
    const v = DATA[i].lat[k]; if (v == null) continue;
    s += v; n++; if (v > mx) mx = v; if (v < mn) mn = v; l += DATA[i].loss[k] || 0;
  }
  return n ? { a: Math.round(s / n), mx, mn, l: Math.round(l / n * 1000) / 10 } : null;
}
const lossColor = v => v === 0 ? 'var(--l0)' : v < 1 ? 'var(--l1)' : v < 5 ? 'var(--l2)' : 'var(--l3)';

/* ---------- 线路质量 ---------- */
const QR_DESKTOP = [{ t: '6 小时', n: 36, m: 10 }, { t: '1 天', n: 48, m: 30 }, { t: '7 天', n: 42, m: 240 }, { t: '30 天', n: 30, m: 1440 }];
const QR_MOBILE  = [{ t: '6 小时', n: 24, m: 15 }, { t: '1 天', n: 24, m: 60 }, { t: '7 天', n: 28, m: 360 }, { t: '30 天', n: 30, m: 1440 }];
const qRanges = () => (isMobile() ? QR_MOBILE : QR_DESKTOP).filter(g => g.n * g.m <= TOT);
let qc = 1, cells = [], sel = null, hov = null;
const qrows = $('qrows'), qi = $('qi'),
      qt = $('qt'), qb = $('qb'), q = $('q');

function buildQButtons() {
  qb.innerHTML = '';
  qRanges().forEach((g, j) => {
    const b = document.createElement('button'); b.className = 'rb'; b.textContent = g.t;
    b.onclick = () => { qc = j; sel = null; resetView(); buildQ(); drawC(); };
    qb.appendChild(b);
  });
}
function buildQ() {
  const rs = qRanges(); if (qc >= rs.length) qc = rs.length - 1;
  const g = rs[qc], t0 = NOW - g.n * g.m * M;
  [...qb.children].forEach((b, j) => b.classList.toggle('on', j === qc));
  cells = LINES.map((_, i) => Array.from({ length: g.n }, (_, k) => {
    const a = t0 + k * g.m * M; return { t: a, e: a + g.m * M, s: agg(i, a, a + g.m * M) };
  }));
  qrows.innerHTML = cells.map((row, i) => {
    const s = agg(i, t0, NOW);
    return `<div class="qr"><div><div class="qname">${LINES[i]}</div><div class="qstat">${s ? s.a + ' ms · ' + s.l + '%' : '无数据'}</div></div>
      <div class="bars" style="grid-template-columns:repeat(${g.n},minmax(0,1fr))">${row.map((c, k) => c.s
        ? `<div class="bar" data-i="${i}" data-k="${k}" style="height:${Math.round(30 + Math.min(1, Math.max(0, (c.s.a - 140) / 90)) * 70)}%;background:${lossColor(c.s.l)}"></div>`
        : `<div class="bar empty" data-i="${i}" data-k="${k}"></div>`).join('')}</div></div>`;
  }).join('');
  qt.innerHTML = [0, .25, .5, .75, 1].map(p => {
    const t = t0 + Math.round(g.n * p) * g.m * M, lab = p === 1 ? '现在' : g.m >= 240 ? md(t) : hm(t);
    return `<span style="left:${p * 100}%;transform:translateX(${p === 0 ? '0' : p === 1 ? '-100%' : '-50%'})">${lab}</span>`;
  }).join('');
  paintQ();
}
function paintQ() {
  const g = qRanges()[qc], f = hov || sel;
  q.querySelectorAll('.bar').forEach(b => {
    const k = +b.dataset.k, i = +b.dataset.i;
    b.style.opacity = !f || f.k === k ? '1' : '.4';
    b.classList.toggle('sel', !!sel && sel.k === k && sel.i === i);
  });
  if (f) {
    const c = cells[f.i][f.k];
    qi.innerHTML = `<b>${LINES[f.i]} · ${rangeTxt(c.t, c.e)}</b>　` +
      (c.s ? `延迟 ${c.s.a} ms（${c.s.mn}–${c.s.mx}）　丢包 ${c.s.l}%` : '无数据') +
      (sel && !hov ? '　<a href="#" id="clr">清除</a>' : '');
    const cl = $('clr');
    if (cl) cl.onclick = e => { e.preventDefault(); clearSel(); };
  } else {
    const per = g.m >= 1440 ? '1 天' : g.m >= 60 ? g.m / 60 + ' 小时' : g.m + ' 分钟';
    qi.textContent = `每格 ${per} · 点柱子查看当时的延迟曲线`;
  }
}
function clearSel() { sel = null; resetView(); paintQ(); drawC(); }
q.addEventListener('mousemove', e => {
  if (isMobile()) return;
  const b = e.target.closest('.bar'), n = b ? { i: +b.dataset.i, k: +b.dataset.k } : null;
  if (JSON.stringify(n) !== JSON.stringify(hov)) { hov = n; paintQ(); }
});
q.addEventListener('mouseleave', () => { hov = null; paintQ(); });
q.addEventListener('click', e => {
  const b = e.target.closest('.bar'); if (!b) return;
  const i = +b.dataset.i, k = +b.dataset.k;
  if (sel && sel.i === i && sel.k === k) { clearSel(); return; }
  sel = { i, k }; hov = null;
  const c = cells[i][k], sp = c.e - c.t, pad = Math.max(sp * .25, (60 * M - sp) / 2);
  view = [Math.max(START, c.t - pad), Math.min(NOW, c.e + pad)];
  paintQ(); drawC();
});

/* ---------- 延迟曲线 ---------- */
const BLUE = 'var(--blue)';
const LR = [[1, '1 小时'], [6, '6 小时'], [24, '24 小时'], [168, '7 天']].filter(r => r[0] * 60 <= TOT);
let rng = 6, view = [NOW - 6 * 60 * M, NOW], drag = null, hx = null;
const lb = $('lb'), sv = $('sv'), rd = $('rd');
const resetView = () => { view = [NOW - rng * 60 * M, NOW]; };
LR.forEach(([h, t]) => {
  const b = document.createElement('button'); b.className = 'rb'; b.textContent = t;
  b.onclick = () => { rng = h; sel = null; resetView(); paintQ(); drawC(); };
  lb.appendChild(b);
});

let W, L, RR = 8, LH, LANE_Y, H;
function layout() {
  W = Math.max(280, sv.clientWidth || 680);
  const mob = isMobile();
  L = mob ? 4 : 110; LH = mob ? 90 : 110;
  LANE_Y = CHART_LINES.map((_, j) => (mob ? 22 : 14) + j * (LH + (mob ? 40 : 20)));
  H = LANE_Y[LANE_Y.length - 1] + LH + 36;
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`); sv.style.height = H * (sv.clientWidth / W || 1) + 'px';
}
const X = t => L + (t - view[0]) / (view[1] - view[0]) * (W - L - RR);
const T = x => view[0] + (x - L) / (W - L - RR) * (view[1] - view[0]);

function buckets(i) {
  const a = Math.max(0, ix(view[0])), b = Math.min(TOT, ix(view[1]));
  const st = Math.max(1, Math.ceil((b - a) / (isMobile() ? 70 : 110))), out = [];
  for (let k = a; k < b; k += st) {
    const e = Math.min(b, k + st); let s = 0, n = 0, mn = Infinity, mx = 0;
    for (let j = k; j < e; j++) { const v = DATA[i].lat[j]; if (v == null) continue; s += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (n) out.push({ t: START + (k + (e - k) / 2) * M, a: Math.round(s / n), mn, mx, st });
  }
  return out;
}
function drawC() {
  layout();
  const mob = isMobile();
  [...lb.children].forEach((b, j) => b.classList.toggle('on', !sel && view[1] === NOW && view[1] - view[0] === LR[j][0] * 60 * M));
  const all = CHART_LINES.map(buckets), lo = 130, hi = 230;
  const Y = (v, y) => y + LH - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * LH;
  let h = '';
  if (sel) {
    const c = cells[sel.i][sel.k], x1 = Math.max(L, X(c.t)), x2 = Math.min(W - RR, X(c.e));
    if (x2 > x1) h += `<rect x="${x1}" y="4" width="${x2 - x1}" height="${H - 32}" fill="var(--sel-fill)" fill-opacity=".05" stroke="var(--text-2)" stroke-dasharray="3 3" stroke-width=".8"/>`;
  }
  CHART_LINES.forEach((li, j) => {
    const y0 = LANE_Y[j], b = all[j];
    if (!b.length) return;
    const av = Math.round(b.reduce((x, y) => x + y.a, 0) / b.length);
    const sr = b.map(y => y.mx).sort((p, q) => p - q), p95 = sr[Math.floor(sr.length * .95)];
    if (mob) {
      h += `<text x="${L}" y="${y0 - 8}" font-size="12" fill="var(--text)">${LINES[li]}<tspan fill="var(--text-2)" font-size="11">　均值 ${av} · P95 ${p95} ms</tspan></text>`;
    } else {
      h += `<text x="0" y="${y0 + 12}" font-size="13" fill="var(--text)">${LINES[li]}</text>
            <text x="0" y="${y0 + 32}" font-size="11" fill="var(--text-2)">均值 ${av} ms</text>
            <text x="0" y="${y0 + 48}" font-size="11" fill="var(--text-2)">P95 ${p95} ms</text>`;
    }
    [150, 180, 210].forEach(g => h += `<line x1="${L}" x2="${W - RR}" y1="${Y(g, y0)}" y2="${Y(g, y0)}" stroke="var(--border)" stroke-dasharray="3 4"/>
      <text x="${W - RR}" y="${Y(g, y0) - 3}" text-anchor="end" font-size="11" fill="var(--text-3)">${g}</text>`);
    const top = b.map(y => `${X(y.t).toFixed(1)},${Y(y.mx, y0).toFixed(1)}`), bot = b.map(y => `${X(y.t).toFixed(1)},${Y(y.mn, y0).toFixed(1)}`).reverse();
    h += `<polygon points="${top.concat(bot).join(' ')}" fill="${BLUE}" fill-opacity=".18"/>
          <polyline points="${b.map(y => `${X(y.t).toFixed(1)},${Y(y.a, y0).toFixed(1)}`).join(' ')}" fill="none" stroke="${BLUE}" stroke-width="1.6" stroke-linejoin="round"/>`;
  });
  const sp = view[1] - view[0];
  const st = [[2 * 60 * M, 15 * M], [7 * 60 * M, 60 * M], [30 * 60 * M, 4 * 60 * M], [4 * 1440 * M, 1440 * M], [Infinity, 2 * 1440 * M]].find(z => sp <= z[0])[1] * (mob ? 2 : 1);
  const tz = new Date().getTimezoneOffset() * M;
  for (let t = Math.ceil((view[0] - tz) / st) * st + tz; t <= view[1]; t += st)
    if (X(t) > L + 15 && X(t) < W - 20) h += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-3)">${st >= 1440 * M ? md(t) : hm(t)}</text>`;
  if (drag && drag.x1 != null)
    h += `<rect x="${Math.min(drag.x0, drag.x1)}" y="4" width="${Math.abs(drag.x1 - drag.x0)}" height="${H - 32}" fill="${BLUE}" fill-opacity=".12" stroke="${BLUE}" stroke-opacity=".5"/>`;
  if (hx != null && !drag && all[0].length) {
    h += `<line x1="${hx}" x2="${hx}" y1="4" y2="${H - 28}" stroke="var(--text-2)" stroke-width=".8"/>`;
    const t = T(hx), vs = all.map(b => b.reduce((p, y) => Math.abs(y.t - t) < Math.abs(p.t - t) ? y : p, b[0]));
    vs.forEach((y, j) => { if (y) h += `<circle cx="${X(y.t)}" cy="${Y(y.a, LANE_Y[j])}" r="3.5" fill="${BLUE}" stroke="var(--card)" stroke-width="1.5"/>`; });
    const y0 = vs[0], a = y0.t - y0.st * M / 2;
    rd.innerHTML = `<b>${y0.st > 1 ? rangeTxt(a, a + y0.st * M) : md(a) + ' ' + hm(a)}</b>　` +
      vs.map((y, j) => y ? `${LINES[CHART_LINES[j]]} ${y.a} ms <span style="color:var(--text-3)">(${y.mn}–${y.mx})</span>` : '').join('　');
  } else if (!drag) {
    rd.textContent = sel ? '已跳到选中的时间段（虚线框）' + (mob ? '' : '，拖选可再放大，双击还原')
                         : (mob ? '点曲线查看读数' : '拖选一段放大，双击还原');
  }
  sv.innerHTML = h;
}
const px = e => { const r = sv.getBoundingClientRect(); return Math.max(L, Math.min(W - RR, (e.clientX - r.left) / r.width * W)); };
sv.addEventListener('mousedown', e => { if (!isMobile()) drag = { x0: px(e), x1: null }; });
sv.addEventListener('mousemove', e => { if (isMobile()) return; hx = px(e); if (drag) drag.x1 = hx; drawC(); });
const onUp = () => {
  if (drag && drag.x1 != null && Math.abs(drag.x1 - drag.x0) > 8) {
    const a = T(Math.min(drag.x0, drag.x1)), b = T(Math.max(drag.x0, drag.x1));
    if (b - a >= 10 * M) view = [a, b];
  }
  drag = null; drawC();
};
window.addEventListener('mouseup', onUp);
sv.addEventListener('mouseleave', () => { if (isMobile()) return; hx = null; if (!drag) drawC(); });
sv.addEventListener('dblclick', () => { if (!isMobile()) clearSel(); });
sv.addEventListener('click', e => {           // 手机：点一下显示读数，再点附近取消
  if (!isMobile()) return;
  const x = px(e); hx = hx != null && Math.abs(hx - x) < 12 ? null : x; drawC();
});

let lastMob = isMobile();
const onResize = () => {
  if (isMobile() !== lastMob) { lastMob = isMobile(); sel = null; hov = null; hx = null; buildQButtons(); buildQ(); }
  drawC();
};
window.addEventListener('resize', onResize);

buildQButtons(); buildQ(); drawC();

return () => {
  window.removeEventListener('mouseup', onUp);
  window.removeEventListener('resize', onResize);
};
}
