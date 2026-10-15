/**
 * coachingProgress.js — the numbers behind the Coaching page (2026-10).
 *
 * The page is organised around one question: "am I improving, game to game?"
 *
 *   rankHeader      current Solo/Duo rank + LP over the last 10 games
 *   lastGameReport  one game vs. your own normal (the 20 games before it)
 *   focusHits       the coaching focus, hit / missed for each of the last 10
 *   areaTrends      each Analytics area: last 10 games vs. the 10 before
 *
 * No second set of formulas: every stat value comes from running the
 * Analytics engine (`computeTabStats`) over the relevant games — a list of
 * one game for the last-game report — so Coaching can never disagree with
 * the cards on the Analytics page. Pure functions; the engine is injected.
 *
 * Solo/Duo only (queue 420), remakes excluded, oldest → newest.
 */

const SOLO_QUEUE = 420;
const WINDOW     = 10;   // "last 10 vs. the 10 before"
const BASELINE   = 20;   // a game is compared with the 20 before it

/**
 * The stats in the last-game report. `tol` is the absolute difference that
 * still counts as "about the same as usual" (plus 5% of the baseline), so a
 * KDA of 2.71 vs 2.68 isn't reported as an improvement.
 */
const REPORT_STATS = [
    { tab: 'Overview',   id: 'avg_kda',    label: 'KDA',               tol: 0.15 },
    { tab: 'Overview',   id: 'avg_csm',    label: 'CS / min',          tol: 0.2  },
    { tab: 'Lane Phase', id: 'deaths_10',  label: 'Deaths before 10',  tol: 0.2  },
    { tab: 'Lane Phase', id: 'gd_15',      label: 'Gold diff @15',     tol: 100  },
    { tab: 'Overview',   id: 'avg_kp',     label: 'Kill participation', tol: 2   },
    { tab: 'Vision',     id: 'vis_vs_min', label: 'Vision / min',      tol: 0.05 },
    { tab: 'Combat',     id: 'dmg_share',  label: 'Damage share',      tol: 1    },
    // (obj_rate would belong here, but objectiveRate is 100 in practically
    //  every stored game — the calculation needs fixing before it's useful)
    { tab: 'Lane Phase', id: 'cs_10',      label: 'CS at 10 min',      tol: 3    },
];

/** Areas for the trends section, each with the stat its sparkline follows. */
const AREAS = [
    { tab: 'Lane Phase',   lead: 'gd_15' },
    { tab: 'Combat',       lead: 'dmg_share' },
    { tab: 'Death Review', lead: 'dr_avg_deaths' },
    { tab: 'Vision',       lead: 'vis_vs_min' },
    { tab: 'Objectives',   lead: 'obj_tower' },
    { tab: 'Economy',      lead: 'eco_gold_min' },
];

const isNum = v => v !== null && v !== undefined && !Number.isNaN(v) && Number.isFinite(Number(v));

function defaultIsRemake(m) {
    if (m.isRemake !== null && m.isRemake !== undefined) return !!m.isRemake;
    return (m.gameDuration || 0) < 300;
}

/** Solo/Duo games, remakes removed, oldest first. */
function soloGames(all, isRemake = defaultIsRemake) {
    return (all || [])
        .filter(m => m.queueId === SOLO_QUEUE && !isRemake(m))
        .sort((a, b) => a.gameCreation - b.gameCreation);
}

/** Every tab whose stats a computation will touch (for JSON prefetching). */
function tabsNeeded() {
    return [...new Set([...REPORT_STATS.map(s => s.tab), ...AREAS.map(a => a.tab)])];
}

function cardsById(computeTabStats, tab, games, prev = []) {
    const out = {};
    if (!games.length) return out;
    for (const c of computeTabStats(tab, games, prev) || []) out[c.id] = c;
    return out;
}

// ── Rank header ────────────────────────────────────────────────────────────

/**
 * @param {object[]} games      solo games, oldest first
 * @param {object}   lpDeltas   matchId → LP change (from the LP tracker)
 */
function rankHeader(games, lpDeltas = {}) {
    const last = games.slice(-WINDOW);
    const wins = last.filter(g => g.win).length;
    let lp = 0, tracked = 0;
    for (const g of last) {
        const d = lpDeltas[g.matchId];
        if (isNum(d)) { lp += Number(d); tracked++; }
    }
    return {
        games: last.length,
        wins,
        losses: last.length - wins,
        lpChange: tracked ? lp : null,
        lpTracked: tracked,
    };
}

// ── Last-game report ───────────────────────────────────────────────────────

function verdict(value, baseline, higherIsBetter, tol) {
    if (!isNum(value) || !isNum(baseline)) return null;
    const diff = value - baseline;
    const allowed = tol + Math.abs(baseline) * 0.05;
    if (Math.abs(diff) <= allowed) return 'same';
    return (diff > 0) === !!higherIsBetter ? 'better' : 'worse';
}

/**
 * One game compared with the BASELINE games before it.
 * @param {object[]} games   solo games, oldest first
 * @param {number}   index   which game (games.length - 1 = most recent)
 */
function lastGameReport(games, index, computeTabStats) {
    if (!games.length) return null;
    const i = Math.max(0, Math.min(games.length - 1, index));
    const game = games[i];
    const baselineGames = games.slice(Math.max(0, i - BASELINE), i);

    const tabs = [...new Set(REPORT_STATS.map(s => s.tab))];
    const gameCards = {}, baseCards = {};
    for (const tab of tabs) {
        Object.assign(gameCards, cardsById(computeTabStats, tab, [game]));
        Object.assign(baseCards, cardsById(computeTabStats, tab, baselineGames));
    }

    const stats = REPORT_STATS.map(s => {
        const g = gameCards[s.id], b = baseCards[s.id];
        if (!g || !isNum(g.value)) return null;   // not measurable for this game
        return {
            id: s.id,
            label: s.label,
            value: g.value,
            display: g.displayValue,
            baseline: b && isNum(b.value) ? b.value : null,
            baselineDisplay: b && isNum(b.value) ? b.displayValue : '—',
            higherIsBetter: g.higherIsBetter,
            verdict: baselineGames.length >= 5 ? verdict(g.value, b && b.value, g.higherIsBetter, s.tol) : null,
            tier: g.benchmarkRank && g.benchmarkRank !== 'unrated' ? g.benchmarkRank : null,
            color: g.benchmarkRank && g.benchmarkRank !== 'unrated' ? g.color : null,
        };
    }).filter(Boolean);

    return {
        index: i,
        total: games.length,
        game,
        baselineCount: baselineGames.length,
        stats,
        better: stats.filter(s => s.verdict === 'better').length,
        worse:  stats.filter(s => s.verdict === 'worse').length,
        same:   stats.filter(s => s.verdict === 'same').length,
    };
}

// ── Focus: hit or missed, game by game ─────────────────────────────────────

function targetFor(metric, role) {
    if (!metric.target) return null;
    const t = metric.target[role];
    return t === undefined ? metric.target.default : t;
}

/**
 * @param {object[]} games   solo games, oldest first
 * @param {object}   engine  coachingEngine (METRICS + _internal.enrich)
 * @param {string}   metricId, role
 */
function focusHits(games, engine, metricId, role) {
    const metric = engine.METRICS.find(m => m.id === metricId);
    if (!metric) return null;
    const enriched = engine._internal.enrich(games);
    const target = targetFor(metric, role);

    const mark = r => {
        if (metric.skipRoles && metric.skipRoles.includes(r.teamPosition)) return null;
        const v = metric.value(r);
        if (!isNum(v) || target === null) return null;
        return metric.lowerIsBetter ? v <= target : v >= target;
    };

    const recent = enriched.slice(-WINDOW);
    const before = enriched.slice(-2 * WINDOW, -WINDOW);
    const rate = list => {
        const m = list.map(mark).filter(x => x !== null);
        return m.length ? { hit: m.filter(Boolean).length, of: m.length } : null;
    };

    return {
        target,
        dots: recent.map(r => ({
            matchId: r.matchId,
            met: mark(r),
            win: !!r.win,
            champion: r.championName,
            when: r.gameCreation,
            value: metric.value(r),
        })),
        recent: rate(recent),
        before: rate(before),
    };
}

// ── Trends by area ─────────────────────────────────────────────────────────

function areaVerdict(cards) {
    const judged = cards.filter(c => c.isImproving !== null && c.isImproving !== undefined);
    if (!judged.length) return 'steady';
    const up = judged.filter(c => c.isImproving).length;
    const down = judged.length - up;
    const score = (up - down) / cards.length;
    if (score >= 0.25) return 'improving';
    if (score <= -0.25) return 'slipping';
    return 'steady';
}

/** Relative size of a change, so CS and gold can be ranked together. */
function relChange(c, prev) {
    if (!isNum(c.value) || !isNum(prev)) return 0;
    return Math.abs(c.value - prev) / Math.max(Math.abs(prev), 1e-6);
}

/**
 * @param {object[]} games   solo games, oldest first
 * @param {number}   [sparkPoints]  how many rolling-10 points per sparkline
 */
function areaTrends(games, computeTabStats, sparkPoints = 30) {
    if (games.length < WINDOW) return [];
    const recent = games.slice(-WINDOW);
    const before = games.slice(-2 * WINDOW, -WINDOW);

    return AREAS.map(area => {
        const now = cardsById(computeTabStats, area.tab, recent);
        const prev = cardsById(computeTabStats, area.tab, before);
        // Same rule as the stat history chart: only benchmarkable averages,
        // no counts — those are the cards whose trend means something.
        const cards = Object.values(cardsById(computeTabStats, area.tab, recent, before))
            .filter(c => c.benchmarkable && c.aggregationType !== 'count' && isNum(c.value));

        const highlights = cards
            .filter(c => prev[c.id] && isNum(prev[c.id].value) && c.isImproving !== null)
            .map(c => ({
                id: c.id,
                label: c.label,
                now: now[c.id].displayValue,
                before: prev[c.id].displayValue,
                improving: c.isImproving,
                size: relChange(c, prev[c.id].value),
            }))
            .sort((a, b) => b.size - a.size)
            .slice(0, 3);

        // Sparkline: rolling 10-game value of the lead stat
        const spark = [];
        const start = Math.max(WINDOW, games.length - sparkPoints + 1);
        for (let end = start; end <= games.length; end++) {
            const c = cardsById(computeTabStats, area.tab, games.slice(end - WINDOW, end))[area.lead];
            spark.push(c && isNum(c.value) ? c.value : null);
        }
        const leadCard = now[area.lead];

        return {
            tab: area.tab,
            verdict: before.length >= 5 ? areaVerdict(cards) : 'steady',
            improving: cards.filter(c => c.isImproving === true).length,
            slipping: cards.filter(c => c.isImproving === false).length,
            total: cards.length,
            highlights,
            lead: leadCard ? {
                id: area.lead,
                label: leadCard.label,
                display: leadCard.displayValue,
                higherIsBetter: leadCard.higherIsBetter,
                color: leadCard.benchmarkRank && leadCard.benchmarkRank !== 'unrated' ? leadCard.color : null,
            } : null,
            spark,
        };
    });
}

module.exports = {
    SOLO_QUEUE, WINDOW, BASELINE, REPORT_STATS, AREAS,
    soloGames, tabsNeeded, rankHeader, lastGameReport, focusHits, areaTrends,
    _internal: { verdict, areaVerdict, targetFor },
};
