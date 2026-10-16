/**
 * laneGapChart.js — the chart under the Lane Phase cards (#12).
 *
 * Average gold and XP difference to your lane opponent at each minute from
 * 0 to 20, over the games the current filters show. The numbers come from
 * services/laneGaps.js (pure, tested) and the stored `laneGaps` column; this
 * file only draws them on a Canvas, like matchTimelineChart.js.
 */

const { averageLaneGaps, MAX_MINUTE } = require('../services/laneGaps');

// A minute averaged over fewer games than this is drawn hollow
const LOW_SAMPLE = 5;
const PAD = { top: 14, right: 16, bottom: 24, left: 52 };
const SERIES = [
    { key: 'gold', label: 'Gold', color: c => c.gold },
    { key: 'xp',   label: 'XP',   color: c => c.accent },
];

let state = null;      // { host, canvas, points, hover }

function cssVar(name, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch { return fallback; }
}
function colors() {
    return {
        accent: cssVar('--accent-primary', '#00cfbc'),
        gold:   cssVar('--gold', '#c8aa6e'),
        good:   cssVar('--success', '#22c55e'),
        bad:    cssVar('--error', '#ef4444'),
    };
}

/** +1.2k / −350 */
function fmt(v) {
    const sign = v > 0.5 ? '+' : v < -0.5 ? '−' : '';
    const a = Math.abs(v);
    return sign + (a >= 1000 ? `${(a / 1000).toFixed(1)}k` : String(Math.round(a)));
}

/** Round, evenly spaced ticks covering [lo, hi]. */
function ticks(lo, hi, count = 4) {
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
    return out;
}

function draw() {
    if (!state) return;
    const { canvas, points, hover } = state;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
    const c = colors();
    ctx.clearRect(0, 0, W, H);

    // Fit the data, always keeping zero (and ±200) in view; small samples
    // don't set the range, they're pinned to the edge instead
    const scaled = points.filter(p => p.games >= LOW_SAMPLE);
    const vals = (scaled.length ? scaled : points).flatMap(p => [p.gold, p.xp]);
    const span = Math.max(400, Math.max(...vals) - Math.min(...vals));
    const lo = Math.min(-200, Math.min(...vals) - span * 0.12);
    const hi = Math.max(200, Math.max(...vals) + span * 0.12);
    const xOf = minute => PAD.left + (minute / MAX_MINUTE) * cW;
    const yOf = v => PAD.top + cH - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * cH;
    state.geo = { xOf, cW };

    // Grid, y labels, dashed zero line
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (const v of ticks(lo, hi, 4)) {
        const y = yOf(v);
        ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)';
        ctx.setLineDash(v === 0 ? [4, 4] : []);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(fmt(v), PAD.left - 8, y + 3.5);
    }
    ctx.setLineDash([]);

    // "ahead" / "behind" hints at the top and bottom of the plot
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('ahead', PAD.left + 6, PAD.top + 10);
    ctx.fillText('behind', PAD.left + 6, PAD.top + cH - 5);

    // x labels
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let min = 0; min <= MAX_MINUTE; min += 5) ctx.fillText(`${min}m`, xOf(min), H - 7);

    // Lines + points
    for (const s of SERIES) {
        const col = s.color(c);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, xOf(p.minute), yOf(p[s.key])));
        ctx.stroke();
        for (const p of points) {
            ctx.beginPath();
            ctx.arc(xOf(p.minute), yOf(p[s.key]), 2.5, 0, Math.PI * 2);
            if (p.games >= LOW_SAMPLE) { ctx.fillStyle = col; ctx.fill(); }
            else { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); }
        }
    }

    // Hover guide
    if (hover) {
        const x = xOf(hover.minute);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
    }
}

function showTip(p, x) {
    const tip = state.host.querySelector('.lg-tip');
    if (!p) { tip.hidden = true; return; }
    tip.innerHTML = `<div class="lg-tip-time">${p.minute}:00</div>
        <div class="lg-tip-row"><span>Gold</span><b>${fmt(p.gold)}</b></div>
        <div class="lg-tip-row"><span>XP</span><b>${fmt(p.xp)}</b></div>
        <div class="lg-tip-games">${p.games} game${p.games === 1 ? '' : 's'}</div>`;
    tip.hidden = false;
    const wrap = state.canvas.parentElement.getBoundingClientRect();
    const flip = x > wrap.width - 140;
    tip.style.left = `${flip ? x - 12 : x + 12}px`;
    tip.style.transform = flip ? 'translateX(-100%)' : '';
}

function onMove(e) {
    if (!state || !state.geo || !state.points.length) return;
    const r = state.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const minute = Math.round(((x - PAD.left) / state.geo.cW) * MAX_MINUTE);
    const p = state.points.find(q => q.minute === minute) || null;
    state.hover = p;
    draw();
    showTip(p, p ? state.geo.xOf(p.minute) : 0);
}

function onLeave() {
    if (!state) return;
    state.hover = null;
    draw();
    showTip(null);
}

let resizeWired = false;

/**
 * @param {Array|null} matches  the games the Lane Phase cards use (remakes
 *   excluded); null hides the chart
 */
function renderLaneGapChart(matches) {
    const host = document.getElementById('laneGapChart');
    if (!host) return;
    if (!matches) { host.hidden = true; host.innerHTML = ''; state = null; return; }

    const { points, games } = averageLaneGaps(matches);
    host.hidden = false;
    const at = min => points.find(p => p.minute === min);
    const p10 = at(10), p15 = at(15);
    const summary = games
        ? `Average over ${games} game${games === 1 ? '' : 's'}` +
          (p10 ? ` · at 10:00 ${fmt(p10.gold)} gold` : '') +
          (p15 ? ` · at 15:00 ${fmt(p15.gold)} gold` : '')
        : '';

    host.innerHTML = `
        <div class="rb-head lg-head">
            <span class="rb-title">Gold &amp; XP gap to your lane opponent</span>
            <span class="rb-sub">${summary}</span>
            <span class="lg-legend">
                ${SERIES.map(s => `<span><i class="lg-swatch lg-swatch--${s.key}"></i>${s.label}</span>`).join('')}
                <span><i class="lg-swatch lg-swatch--hollow"></i>under ${LOW_SAMPLE} games</span>
            </span>
        </div>
        ${games
            ? `<div class="lg-chart"><canvas></canvas><div class="lg-tip" hidden></div></div>`
            : `<div class="lg-empty">No lane data for these games yet. It needs a lane opponent (same position) and a stored timeline; older games are filled in shortly after launch.</div>`}`;

    if (!games) { state = null; return; }
    const canvas = host.querySelector('canvas');
    state = { host, canvas, points, hover: null };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    if (!resizeWired) { window.addEventListener('resize', draw); resizeWired = true; }
    draw();
}

window.renderLaneGapChart = renderLaneGapChart;
module.exports = { renderLaneGapChart };
