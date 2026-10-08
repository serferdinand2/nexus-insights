const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stubDatabase, makeMatch, SRC } = require('./helpers');

// The analytics engine reaches for the database at require time
stubDatabase([]);
global.window = {};
require(path.join(SRC, 'components', 'analyticsEngine.js'));
const {
    isChartable, monthBuckets, computeMonthlyHistory, benchmarkBands, axisLabel,
} = require(path.join(SRC, 'components', 'statHistory.js'));

const at = (y, m, d = 10) => new Date(y, m, d, 18, 0, 0).getTime();   // local time, month 0-based

test('12 months, oldest first, ending with the current month', () => {
    const b = monthBuckets(new Date(2026, 9, 8));          // 8 Oct 2026
    assert.equal(b.length, 12);
    assert.equal(b[11].year, 2026); assert.equal(b[11].month, 9);
    assert.equal(b[11].isCurrent, true);
    assert.equal(b[0].year, 2025);  assert.equal(b[0].month, 10); // Nov 2025
    assert.equal(b.filter(x => x.isCurrent).length, 1);
    // contiguous: each month starts where the previous ended
    for (let i = 1; i < b.length; i++) assert.equal(b[i].start, b[i - 1].end);
});

test('month window wraps across the new year correctly', () => {
    const b = monthBuckets(new Date(2026, 1, 15));         // Feb 2026
    assert.deepEqual([b[0].year, b[0].month], [2025, 2]);  // Mar 2025
    assert.deepEqual([b[11].year, b[11].month], [2026, 1]);
});

test('only cards with a meaningful monthly trend are clickable', () => {
    assert.equal(isChartable({ id: 'win_rate', aggregationType: 'percentage' }), true);
    assert.equal(isChartable({ id: 'avg_kda',  aggregationType: 'average' }), true);
    assert.equal(isChartable({ id: 'csd_15',   aggregationType: 'differential' }), true);
    // Total Matches and the streak cards
    assert.equal(isChartable({ id: 'total_matches',  aggregationType: 'count' }), false);
    assert.equal(isChartable({ id: 'con_max_win',    aggregationType: 'count' }), false);
    assert.equal(isChartable({ id: 'con_cur_streak', aggregationType: 'count' }), false);
    // "last 10 games" has no per-month meaning
    assert.equal(isChartable({ id: 'con_last10_wr',  aggregationType: 'percentage' }), false);
    assert.equal(isChartable({ id: 'coming_soon',    aggregationType: 'none' }), false);
    assert.equal(isChartable(null), false);
});

test('each month equals what the card computes for just that month', () => {
    const now = new Date(2026, 9, 8);
    const aug = [
        makeMatch({ gameCreation: at(2026, 7, 3), win: 1, kills: 10, deaths: 2, assists: 4 }),
        makeMatch({ gameCreation: at(2026, 7, 9), win: 0, kills: 2,  deaths: 6, assists: 3 }),
    ];
    const oct = [
        makeMatch({ gameCreation: at(2026, 9, 1), win: 1, kills: 5, deaths: 1, assists: 9 }),
    ];
    const tooOld = [makeMatch({ gameCreation: at(2025, 5, 1), win: 1 })]; // Jun 2025 — outside window

    const h = computeMonthlyHistory({
        tabName: 'Overview', statId: 'avg_kda',
        matches: [...aug, ...oct, ...tooOld],
        computeTabStats: window.computeTabStats, now,
    });

    const byMonth = Object.fromEntries(h.points.map(p => [`${p.year}-${p.month}`, p]));
    const expect = (ms) => window.computeTabStats('Overview', ms, []).find(c => c.id === 'avg_kda');

    assert.equal(byMonth['2026-7'].games, 2);
    assert.equal(byMonth['2026-7'].value, expect(aug).value);
    assert.equal(byMonth['2026-7'].display, expect(aug).displayValue);
    assert.equal(byMonth['2026-9'].value, expect(oct).value);
    assert.equal(byMonth['2026-8'].games, 0);
    assert.equal(byMonth['2026-8'].value, null, 'a month with no games has no value');
    assert.equal(h.totalGames, 3, 'games older than 12 months are not counted');
    assert.equal(h.aggregationType, 'average');
    assert.equal(h.benchmarkable, true);
});

test('benchmark bands agree with the tier the card is coloured by', () => {
    // higher is better
    const wr = window.getStatBenchmark('win_rate');
    const wrBands = benchmarkBands(wr, true);
    const tierOf = (bands, v) => (bands.find(b => v >= b.lo && v < b.hi) || {}).tier;
    for (const v of [30, 47.5, 52.5, 60]) {
        // Same rule as analyticsEngine.evaluateBenchmark (higher is better)
        const expected = (() => {
            const tiers = ['challenger','grandmaster','master','diamond','emerald','platinum','gold','silver','bronze','iron'];
            for (const t of tiers) if (v >= wr[t]) return t;
            return 'iron';
        })();
        assert.equal(tierOf(wrBands, v), expected, `win rate ${v}`);
    }

    // lower is better
    const d10 = window.getStatBenchmark('deaths_10');
    const dBands = benchmarkBands(d10, false);
    const tierOfLow = (v) => (dBands.find(b => v > b.lo && v <= b.hi) || {}).tier;
    assert.equal(tierOfLow(0.05), 'challenger');
    assert.equal(tierOfLow(0.45), 'gold');      // <= 0.50 but > 0.40
    assert.equal(tierOfLow(5),    'iron');

    // bands tile the whole number line with no gaps
    const sorted = [...wrBands].sort((a, b) => a.lo - b.lo);
    assert.equal(sorted[0].lo, -Infinity);
    assert.equal(sorted[sorted.length - 1].hi, Infinity);
    for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].lo, sorted[i - 1].hi);
});

test('axis labels are readable for each kind of stat', () => {
    assert.equal(axisLabel(52.4, 'percentage'), '52%');
    assert.equal(axisLabel(2.84, 'average'), '2.84');
    assert.equal(axisLabel(6.5, 'per-minute'), '6.5');
    assert.equal(axisLabel(24662, 'average'), '24.7k');
    assert.equal(axisLabel(300, 'differential'), '+300');
    assert.equal(axisLabel(-150, 'differential'), '-150');
    assert.equal(axisLabel(0, 'differential'), '0');
});
