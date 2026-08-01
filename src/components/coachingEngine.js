/**
 * coachingEngine.js — decides what is actually worth working on.
 *
 * The old board showed 20 goals against hardcoded thresholds, all presented as
 * equally actionable. Twenty priorities is zero priorities, and most of those
 * "goals" were not things you do — they were things that happen to you when you
 * win. This module fixes both problems.
 *
 * ── Causes vs symptoms ──────────────────────────────────────────────────────
 * Metrics are tagged 'input' or 'outcome'.
 *
 *   input   — a decision you make, mostly before the game diverges: dying
 *             early, CS at 10, control wards bought, queueing while tilted.
 *   outcome — a consequence of already winning: barons, towers, dragons, kill
 *             participation, multikills.
 *
 * "Win rate with Baron 70%" is nearly circular — you take Baron *because* you
 * are ahead. Coaching on outcomes tells you to be winning, which is not advice.
 * Only inputs are ranked as things to fix; outcomes are reported as evidence.
 *
 * ── Ranking ─────────────────────────────────────────────────────────────────
 * Instead of a hardcoded severity, each input metric is scored on the player's
 * own games:
 *
 *   split games by whether the metric met its (role-aware) target
 *   gap         = winRate(met) - winRate(missed)
 *   failureRate = games missed / total games
 *   recoverable = gap * failureRate
 *
 * `recoverable` is the win rate associated with closing that gap entirely, and
 * it naturally balances severity against frequency: a huge gap you rarely hit
 * ranks below a moderate gap you hit constantly.
 *
 * ── Honesty about what this is ──────────────────────────────────────────────
 * These are correlations over a few hundred of the player's own games, not
 * causal effects. Early deaths and losses reinforce each other. Every result
 * therefore carries `sampleSize` and `standardError`, and `confident` is false
 * when the gap is within noise. The UI must present these as "associated with",
 * never "will gain you".
 */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CoachingEngine = api;
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    // A session ends after this long without playing; used for tilt detection.
    const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

    // Below this many games on either side of a split, the comparison is noise.
    const MIN_SIDE_SAMPLE = 12;

    const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

    const ROLE_LABEL = {
        TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid',
        BOTTOM: 'Bot', UTILITY: 'Support', UNKNOWN: 'All roles',
    };

    /**
     * Metric catalogue.
     *
     * value()       per-match number, or null when not measurable
     * target        role -> threshold (with a `default`)
     * lowerIsBetter which side of the target counts as "met"
     * rule          the single sentence a player can hold in their head
     */
    const METRICS = [
        {
            id: 'earlyDeaths', kind: 'input',
            label: 'Dying before 10 minutes',
            unit: 'per game', decimals: 1,
            value: m => num(m.deathsBefore10),
            lowerIsBetter: true,
            target: { TOP: 0.8, JUNGLE: 0.6, MIDDLE: 0.7, BOTTOM: 0.6, UTILITY: 1.0, default: 0.7 },
            rule: 'Don\'t cross the river before 8:00 without vision.',
        },
        {
            id: 'isolatedDeaths', kind: 'input',
            label: 'Dying alone',
            unit: 'per game', decimals: 1,
            value: m => num(m.isolatedDeaths),
            lowerIsBetter: true,
            target: { UTILITY: 1.8, default: 1.5 },
            rule: 'If no teammate is on your screen, you are pushing too far.',
        },
        {
            id: 'controlWards', kind: 'input',
            label: 'Control wards bought',
            unit: 'per game', decimals: 1,
            value: m => num(m.detectorWardsPlaced),
            lowerIsBetter: false,
            target: { UTILITY: 6, JUNGLE: 4, default: 3 },
            rule: 'Buy a control ward on every single back. No exceptions.',
        },
        {
            id: 'csAt10', kind: 'input',
            label: 'CS at 10 minutes',
            unit: 'CS', decimals: 0,
            value: m => num(m.cs10),
            lowerIsBetter: false,
            // Support is excluded rather than given a soft target: CS is not
            // their job and a target would only generate noise.
            target: { TOP: 68, JUNGLE: 60, MIDDLE: 72, BOTTOM: 75, default: 68 },
            skipRoles: ['UTILITY'],
            rule: 'Last-hit through the first back. Recall on a wave, not a whim.',
        },
        {
            id: 'goldDiff15', kind: 'input',
            label: 'Gold difference at 15',
            unit: 'gold', decimals: 0,
            value: m => num(m.goldDiff15),
            lowerIsBetter: false,
            target: { default: -200 },
            rule: 'Take the even trade and reset. Losing lane slowly beats dying.',
        },
        {
            id: 'tiltQueue', kind: 'input',
            label: 'Queueing after two losses',
            unit: '', decimals: 0,
            // Boolean flag rendered as a number so it shares the split maths.
            value: m => (m._afterTwoLosses ? 1 : 0),
            lowerIsBetter: true,
            target: { default: 0 },
            binary: true,
            // Circular by construction: the flag comes from the win/loss
            // sequence and is then split against that same sequence, so inside
            // a losing run these games are losses by definition. It is kept for
            // display but never chosen as the focus — see tiltBehaviour() for
            // the non-circular evidence that actually belongs on the board.
            circular: true,
            excludeFromFocus: true,
            rule: 'Two losses in a row means stop. Not one more game.',
        },
        {
            id: 'champPool', kind: 'input',
            label: 'Playing off-pool champions',
            unit: '', decimals: 0,
            value: m => (m._onMainChamp ? 0 : 1),
            lowerIsBetter: true,
            target: { default: 0 },
            binary: true,
            rule: 'Pick from your top three unless the game is already won.',
        },

        // ── Outcomes: evidence, never tasks ──────────────────────────────────
        { id: 'dragons',   kind: 'outcome', label: 'Dragons per game',    unit: '', decimals: 1, value: m => num(m.teamDragons) },
        { id: 'barons',    kind: 'outcome', label: 'Barons per game',     unit: '', decimals: 1, value: m => num(m.teamBarons) },
        { id: 'turrets',   kind: 'outcome', label: 'Turret takedowns',    unit: '', decimals: 1, value: m => num(m.turretKills) },
        { id: 'vision',    kind: 'outcome', label: 'Vision score',        unit: '', decimals: 0, value: m => num(m.visionScore) },
        { id: 'kp',        kind: 'outcome', label: 'Kill participation',  unit: '%', decimals: 0,
          value: m => (m.teamKills ? ((num(m.kills) + num(m.assists)) / m.teamKills) * 100 : null) },
        { id: 'deaths',    kind: 'outcome', label: 'Deaths per game',     unit: '', decimals: 1, value: m => num(m.deaths) },
        { id: 'firstBlood',kind: 'outcome', label: 'First blood rate',    unit: '%', decimals: 0, value: m => (m.firstBlood ? 100 : 0) },
    ];

    function num(v) {
        return (v === null || v === undefined || Number.isNaN(Number(v))) ? null : Number(v);
    }

    function mean(xs) {
        const v = xs.filter(x => x !== null && x !== undefined);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }

    function winRate(games) {
        if (!games.length) return null;
        return (games.filter(g => g.win).length / games.length) * 100;
    }

    /** Most-played position, used to pick benchmarks. */
    function primaryRole(rows) {
        const counts = {};
        for (const r of rows) {
            const p = (r.teamPosition || '').toUpperCase();
            if (ROLES.includes(p)) counts[p] = (counts[p] || 0) + 1;
        }
        let best = null, bestN = 0;
        for (const [role, n] of Object.entries(counts)) {
            if (n > bestN) { best = role; bestN = n; }
        }
        return { role: best || 'UNKNOWN', games: bestN, share: rows.length ? bestN / rows.length : 0 };
    }

    /**
     * Annotate rows with the derived per-match flags the behavioural metrics
     * need. Rows must be in chronological order.
     */
    function enrich(rows) {
        // Champion pool: top three by games played
        const played = {};
        for (const r of rows) played[r.championName] = (played[r.championName] || 0) + 1;
        const top3 = Object.entries(played).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

        let consecutiveLosses = 0;
        let prevTime = null;

        return rows.map(r => {
            // A gap long enough to be a different sitting resets the tilt count
            if (prevTime !== null && (r.gameCreation - prevTime) > SESSION_GAP_MS) consecutiveLosses = 0;
            prevTime = r.gameCreation;

            const out = Object.assign({}, r, {
                _afterTwoLosses: consecutiveLosses >= 2,
                _onMainChamp:    top3.includes(r.championName),
            });

            consecutiveLosses = r.win ? 0 : consecutiveLosses + 1;
            return out;
        });
    }

    /**
     * Standard error of the difference between two win rates, as percentages.
     * Used to say plainly when a gap is inside the noise.
     */
    function seOfDifference(games1, games2) {
        const p = g => (g.filter(x => x.win).length / g.length);
        if (!games1.length || !games2.length) return Infinity;
        const p1 = p(games1), p2 = p(games2);
        return Math.sqrt((p1 * (1 - p1)) / games1.length + (p2 * (1 - p2)) / games2.length) * 100;
    }

    function targetFor(metric, role) {
        if (!metric.target) return null;
        const t = metric.target[role];
        return t === undefined ? metric.target.default : t;
    }

    function meetsTarget(metric, value, target) {
        if (value === null || target === null) return null;
        return metric.lowerIsBetter ? value <= target : value >= target;
    }

    /**
     * Behavioural evidence for tilt, which the win-rate split cannot provide.
     *
     * Splitting "games after two losses" on win rate is circular: inside a
     * losing run those games are losses by definition. Shuffling the outcomes
     * does not rescue it either — that tests whether results are streaky, and
     * streaks have causes other than tilt (matchmaking, opponent quality,
     * fatigue, playing with a duo). Tilt and streaky matchmaking are
     * indistinguishable from the win/loss sequence alone.
     *
     * What is NOT circular is asking whether the player's own inputs get worse
     * after two losses. Early deaths and isolated deaths are measured inside
     * the game and are not derived from the result sequence, so a degradation
     * there is real evidence about behaviour rather than an artefact.
     */
    function tiltBehaviour(rows) {
        const tilted = rows.filter(r => r._afterTwoLosses);
        const normal = rows.filter(r => !r._afterTwoLosses);
        if (tilted.length < MIN_SIDE_SAMPLE || normal.length < MIN_SIDE_SAMPLE) return null;

        const compare = (fn) => {
            const a = mean(normal.map(fn));
            const b = mean(tilted.map(fn));
            return (a === null || b === null) ? null : { normal: a, tilted: b, delta: b - a };
        };

        const earlyDeaths    = compare(r => num(r.deathsBefore10));
        const isolatedDeaths = compare(r => num(r.isolatedDeaths));
        const csAt10         = compare(r => num(r.cs10));

        // "Degraded" means the in-game inputs actually got worse, not merely
        // that the results did.
        const worse = [
            earlyDeaths    && earlyDeaths.delta    > 0.15,
            isolatedDeaths && isolatedDeaths.delta > 0.15,
            csAt10         && csAt10.delta         < -3,
        ].filter(Boolean).length;

        return {
            games: tilted.length,
            share: (tilted.length / rows.length) * 100,
            winRateTilted: winRate(tilted),
            winRateNormal: winRate(normal),
            earlyDeaths, isolatedDeaths, csAt10,
            degraded: worse > 0,
            degradedCount: worse,
        };
    }

    /** Split games on the target and measure the win-rate consequence. */
    function evaluateInput(metric, rows, role) {
        if (metric.skipRoles && metric.skipRoles.includes(role)) return null;

        const target = targetFor(metric, role);
        const met = [], missed = [];

        for (const r of rows) {
            const v = metric.value(r);
            const ok = meetsTarget(metric, v, target);
            if (ok === null) continue;
            (ok ? met : missed).push(r);
        }

        const total = met.length + missed.length;
        if (!total) return null;

        const wrMet    = winRate(met);
        const wrMissed = winRate(missed);
        const gap = (wrMet === null || wrMissed === null) ? 0 : wrMet - wrMissed;
        const failureRate = missed.length / total;

        // Only a positive gap is actionable. A negative one means the target is
        // wrong for this player, not that they should do less of it.
        const recoverable = Math.max(0, gap) * failureRate;

        const se = seOfDifference(met, missed);
        const enoughData = met.length >= MIN_SIDE_SAMPLE && missed.length >= MIN_SIDE_SAMPLE;

        return {
            id: metric.id, kind: 'input', label: metric.label, rule: metric.rule,
            unit: metric.unit, decimals: metric.decimals, binary: !!metric.binary,
            target, role,
            current: mean(rows.map(metric.value)),
            wrMet, wrMissed, gap,
            circular: !!metric.circular,
            excludeFromFocus: !!metric.excludeFromFocus,
            failureRate: failureRate * 100,
            failedGames: missed.length,
            metGames: met.length,
            sampleSize: total,
            standardError: se,
            // "Confident" means the observed gap is larger than the noise in it
            confident: enoughData && Number.isFinite(se) && gap > se,
            recoverable,
        };
    }

    function evaluateOutcome(metric, rows) {
        const values = rows.map(metric.value).filter(v => v !== null);
        if (!values.length) return null;
        return {
            id: metric.id, kind: 'outcome', label: metric.label,
            unit: metric.unit, decimals: metric.decimals,
            current: mean(values),
            sampleSize: values.length,
        };
    }

    /** Direction of travel: recent third vs the rest. */
    function trendOf(metric, rows, role) {
        if (rows.length < 30) return null;
        const cut    = Math.floor(rows.length * 2 / 3);
        const before = mean(rows.slice(0, cut).map(metric.value));
        const after  = mean(rows.slice(cut).map(metric.value));
        if (before === null || after === null) return null;

        const delta = after - before;

        // A flat metric is stable, not worsening. Without this, anything that
        // hasn't moved reads as a warning on the watch list.
        const scale = Math.abs(before) || 1;
        if (Math.abs(delta) < scale * 0.02) {
            return { before, after, delta, improving: null, flat: true };
        }

        const better = metric.lowerIsBetter ? delta < 0 : delta > 0;
        return { before, after, delta, improving: better, flat: false };
    }

    /**
     * Main entry point.
     * @param {Array} rawRows chronologically ordered matches
     * @param {object} [opts] { focusId, focusSince } to report progress against
     */
    function analyse(rawRows, opts = {}) {
        const rows = Array.isArray(rawRows) ? rawRows.slice() : [];
        if (rows.length === 0) {
            return { empty: true, sampleSize: 0, role: 'UNKNOWN', focus: null, watch: [], reference: [] };
        }

        rows.sort((a, b) => a.gameCreation - b.gameCreation);
        const enriched = enrich(rows);
        const roleInfo = primaryRole(enriched);
        const role     = roleInfo.role;

        const inputs = [];
        const reference = [];

        for (const metric of METRICS) {
            if (metric.kind === 'input') {
                const res = evaluateInput(metric, enriched, role);
                if (res) {
                    res.trend = trendOf(metric, enriched, role);
                    inputs.push(res);
                }
            } else {
                const res = evaluateOutcome(metric, enriched);
                if (res) reference.push(res);
            }
        }

        // Confident results first, then by how much is on the table.
        inputs.sort((a, b) => {
            if (a.confident !== b.confident) return a.confident ? -1 : 1;
            return b.recoverable - a.recoverable;
        });

        // Circular metrics can be shown, but must never be the thing the board
        // tells you to work on.
        const focusable = inputs.filter(i => !i.excludeFromFocus);

        // An explicitly chosen focus wins over the computed one, so the board
        // doesn't change target every time a game is played.
        let focus = focusable[0] || null;
        if (opts.focusId) {
            const pinned = focusable.find(i => i.id === opts.focusId);
            if (pinned) { focus = pinned; focus.pinned = true; }
        }

        // Watch list: next best, plus anything actively getting worse.
        const watch = inputs
            .filter(i => focus && i.id !== focus.id)
            .sort((a, b) => {
                // Actively getting worse outranks merely being suboptimal.
                // `improving === false` is a real decline; null means flat.
                const aWorse = (a.trend && a.trend.improving === false) ? 1 : 0;
                const bWorse = (b.trend && b.trend.improving === false) ? 1 : 0;
                if (aWorse !== bWorse) return bWorse - aWorse;
                return b.recoverable - a.recoverable;
            })
            .slice(0, 3);

        const progress = focus ? progressSince(focus, enriched, opts.focusSince) : null;

        return {
            empty: false,
            sampleSize: enriched.length,
            role, roleLabel: ROLE_LABEL[role] || role,
            roleShare: roleInfo.share,
            focus, watch, reference, progress,
            // Non-circular tilt evidence: do the in-game inputs degrade after
            // two losses? Shown separately because it is a different kind of
            // claim from the ranked metrics.
            tilt: tiltBehaviour(enriched),
            allInputs: inputs,
        };
    }

    /** How the focus metric has moved since it was chosen. */
    function progressSince(focus, rows, since) {
        if (!since) return null;
        const metric = METRICS.find(m => m.id === focus.id);
        if (!metric) return null;

        const before = rows.filter(r => r.gameCreation <  since);
        const after  = rows.filter(r => r.gameCreation >= since);
        if (after.length < 5) return { since, games: after.length, tooEarly: true };

        return {
            since,
            games: after.length,
            before: mean(before.map(metric.value)),
            after:  mean(after.map(metric.value)),
            winRateSince: winRate(after),
            winRateBefore: winRate(before),
            improving: (() => {
                const b = mean(before.map(metric.value));
                const a = mean(after.map(metric.value));
                if (b === null || a === null) return null;
                return metric.lowerIsBetter ? a < b : a > b;
            })(),
        };
    }

    return {
        analyse, METRICS, ROLE_LABEL,
        // exported for tests
        _internal: { enrich, primaryRole, evaluateInput, seOfDifference, winRate, mean },
    };
});
