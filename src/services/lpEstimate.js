/**
 * lpEstimate.js — an LP value for every ranked game, including the ones
 * played before the LP tracker existed (#5).
 *
 * Pure. Per queue it takes:
 *   - the games, oldest first
 *   - anchors: every known LP value (lp_history readings, tracked or entered
 *     by hand as checkpoints), as absolute LP at a time
 *   - real per-game deltas (getLpDeltasByMatch)
 *
 * Each game gets a delta: the real one when measured, 0 for a remake,
 * otherwise an estimate from your own recent average gain/loss (or +22/−20
 * until there are 5 real ones of each). Then the absolute LP after each game:
 *   - before the first anchor: walk back from it
 *   - between two anchors: estimates are shifted evenly so the games land
 *     exactly on the later anchor (real deltas are never changed; an estimate
 *     never flips a win negative or a loss positive). If that would move each
 *     estimate by more than MAX_SHIFT, the two anchors can't both be right
 *     (e.g. a wrong checkpoint): the estimates keep their usual values and
 *     are walked back from the later anchor, leaving the jump visible.
 *   - after the last anchor: walk forward
 */

const { absoluteLp } = require('./lpAttribution');

const DEFAULT_GAIN = 22;
const DEFAULT_LOSS = 20;
const MIN_SAMPLES  = 5;     // real wins (and losses) needed to trust your own average
const RECENT       = 20;    // how many recent real ones to average
const MAX_SHIFT    = 12;    // most an estimate is moved to fit between two anchors
const QUEUES       = { solo: 420, flex: 440 };
const APEX         = 7 * 400;                 // Master and above: no divisions
const TIER_NAMES   = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'];
const DIVISIONS    = ['IV', 'III', 'II', 'I'];

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Your recent average LP per win and per loss, or the defaults. */
function typicalDeltas(games, real) {
    const wins = [], losses = [];
    for (const g of [...games].reverse()) {            // newest first
        const d = real[g.matchId];
        if (!Number.isFinite(d)) continue;
        if (g.win && d > 0 && wins.length < RECENT) wins.push(d);
        if (!g.win && d < 0 && losses.length < RECENT) losses.push(-d);
    }
    const winOk = wins.length >= MIN_SAMPLES, lossOk = losses.length >= MIN_SAMPLES;
    return {
        gain: winOk ? Math.round(mean(wins)) : DEFAULT_GAIN,
        loss: lossOk ? Math.round(mean(losses)) : DEFAULT_LOSS,
        measured: winOk && lossOk,
    };
}

/**
 * @param {Array<{matchId, endAt, win, remake?}>} games  one queue, oldest first
 * @param {Array<{t, abs}>} anchors
 * @param {object} real  matchId → measured delta
 * @returns {Map} matchId → { delta, estimated, remake, lpAfter }
 */
function estimateQueue(games, anchors, real = {}, typical = typicalDeltas(games, real)) {
    const out = new Map();
    for (const g of games) {
        if (g.remake) out.set(g.matchId, { delta: 0, estimated: false, remake: true, lpAfter: null });
        else if (Number.isFinite(real[g.matchId])) out.set(g.matchId, { delta: real[g.matchId], estimated: false, remake: false, lpAfter: null });
        else out.set(g.matchId, { delta: g.win ? typical.gain : -typical.loss, estimated: true, remake: false, lpAfter: null });
    }
    const sorted = [...anchors].filter(a => Number.isFinite(a.t) && Number.isFinite(a.abs)).sort((x, y) => x.t - y.t);
    if (!sorted.length) return out;

    // Before the first anchor: walk back from it
    const first = sorted[0];
    let lp = first.abs;
    const before = games.filter(g => g.endAt <= first.t);
    for (let i = before.length - 1; i >= 0; i--) {
        const r = out.get(before[i].matchId);
        r.lpAfter = lp;
        lp -= r.delta;
    }

    // Between anchors: pull the estimates through both ends
    for (let k = 0; k < sorted.length - 1; k++) {
        const A = sorted[k], B = sorted[k + 1];
        const seg = games.filter(g => g.endAt > A.t && g.endAt <= B.t).map(g => out.get(g.matchId));
        if (!seg.length) continue;
        const est = seg.filter(r => r.estimated);
        const fixed  = seg.filter(r => !r.estimated).reduce((s, r) => s + r.delta, 0);
        const needed = B.abs - A.abs - fixed;              // what the estimates must add up to
        const shift  = est.length ? (needed - est.reduce((s, r) => s + r.delta, 0)) / est.length : 0;

        if (est.length && Math.abs(shift) <= MAX_SHIFT) {
            // Round the running total, not each game: every estimate stays
            // within 1 LP of its share and the segment lands exactly on B
            let ideal = 0, used = 0;
            for (const r of est) {
                const isWin = r.delta >= 0;
                ideal += r.delta + shift;
                let d = Math.round(ideal) - used;
                d = isWin ? Math.max(0, d) : Math.min(0, d);
                r.delta = d;
                used += d;
            }
            let cur = A.abs;
            for (const r of seg) { cur += r.delta; r.lpAfter = cur; }
        } else {
            // Nothing to fit, or A and B can't both be right: walk back from B
            let cur = B.abs;
            for (let i = seg.length - 1; i >= 0; i--) { seg[i].lpAfter = cur; cur -= seg[i].delta; }
        }
    }

    // After the last anchor: walk forward
    const last = sorted[sorted.length - 1];
    let cur = last.abs;
    for (const g of games.filter(g2 => g2.endAt > last.t)) {
        const r = out.get(g.matchId);
        cur += r.delta;
        r.lpAfter = cur;
    }
    return out;
}

function isRemake(m) {
    if (m.isRemake !== null && m.isRemake !== undefined) return m.isRemake === 1;
    return (m.gameDuration || 0) < 300;
}

/**
 * Both queues at once, from the app's match rows and lp_history readings.
 * @returns {{ byMatch, series: {solo, flex}, typical: {solo, flex} }}
 */
function buildLpEstimates(matches, readingsByQueue = {}, real = {}) {
    const byMatch = {}, series = {}, typical = {};
    for (const [queue, queueId] of Object.entries(QUEUES)) {
        const games = matches
            .filter(m => m.queueId === queueId)
            .map(m => ({
                matchId: m.matchId, win: m.win === 1, remake: isRemake(m),
                endAt: (m.gameCreation || 0) + (m.gameDuration || 0) * 1000,
                gameCreation: m.gameCreation, championName: m.championName,
            }))
            .sort((x, y) => x.endAt - y.endAt);
        const anchors = (readingsByQueue[queue] || []).map(r => ({
            t: r.recorded_at, abs: absoluteLp(r.tier, r.rank, r.lp),
        }));
        typical[queue] = typicalDeltas(games, real);
        const res = estimateQueue(games, anchors, real, typical[queue]);
        series[queue] = games.map(g => ({ ...g, ...res.get(g.matchId) }));
        for (const p of series[queue]) {
            byMatch[p.matchId] = { queue, delta: p.delta, estimated: p.estimated, remake: p.remake, lpAfter: p.lpAfter };
        }
    }
    return { byMatch, series, typical };
}

/** LP and wins to the next division, or null in Master+. */
function nextDivision(abs, gainPerWin) {
    if (!Number.isFinite(abs) || abs >= APEX) return null;
    const needed = 100 - (((abs % 100) + 100) % 100);
    const next = abs + needed;
    const label = next >= APEX ? 'Master'
        : `${TIER_NAMES[Math.floor(next / 400)]} ${DIVISIONS[Math.floor((next % 400) / 100)]}`;
    return { needed, wins: Math.ceil(needed / Math.max(1, gainPerWin)), label };
}

/** 1079 → "Silver II 79 LP" */
function rankLabel(abs) {
    if (!Number.isFinite(abs)) return '';
    if (abs >= APEX) return `Master+ ${Math.round(abs - APEX)} LP`;
    const v = Math.max(0, Math.round(abs));
    return `${TIER_NAMES[Math.floor(v / 400)]} ${DIVISIONS[Math.floor((v % 400) / 100)]} ${v % 100} LP`;
}

module.exports = { typicalDeltas, estimateQueue, buildLpEstimates, nextDivision, rankLabel, DEFAULT_GAIN, DEFAULT_LOSS };
