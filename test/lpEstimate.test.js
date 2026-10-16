/**
 * Issue #5: an LP value for every ranked game, including the ones played
 * before the tracker existed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const E = require(path.join(SRC, 'services', 'lpEstimate.js'));

const H = 3600000;
const g = (id, hour, win, extra = {}) => ({ matchId: id, endAt: hour * H, win, ...extra });
const a = (hour, abs, extra = {}) => ({ t: hour * H, abs, ...extra });
const deltas = (res) => Object.fromEntries([...res].map(([id, r]) => [id, r.delta]));
const after = (res) => Object.fromEntries([...res].map(([id, r]) => [id, r.lpAfter]));

test('typical gain/loss: your own average once there are 5 real ones, else +22/−20', () => {
    const games = [g('w1', 1, true), g('w2', 2, true), g('l1', 3, false)];
    assert.deepEqual(E.typicalDeltas(games, { w1: 24 }), { gain: 22, loss: 20, measured: false });

    const many = [];
    const real = {};
    for (let i = 0; i < 6; i++) { many.push(g(`w${i}`, i, true)); real[`w${i}`] = 18 + i; }        // 18..23 → 20.5
    for (let i = 0; i < 5; i++) { many.push(g(`l${i}`, 10 + i, false)); real[`l${i}`] = -(15 + i); } // 15..19 → 17
    assert.deepEqual(E.typicalDeltas(many, real), { gain: 21, loss: 17, measured: true });
});

test('no readings at all: real deltas kept, the rest estimated, no LP value', () => {
    const res = E.estimateQueue([g('a', 1, true), g('b', 2, false), g('r', 3, false, { remake: true }), g('c', 4, true)], [], { c: 19 });
    assert.deepEqual(deltas(res), { a: 22, b: -20, r: 0, c: 19 });
    assert.equal(res.get('a').estimated, true);
    assert.equal(res.get('c').estimated, false);
    assert.equal(res.get('r').estimated, false, 'a remake moves no LP');
    assert.equal(res.get('r').remake, true);
    assert.deepEqual(Object.values(after(res)), [null, null, null, null]);
});

test('games before the first reading walk back from it', () => {
    // Reading at hour 10 says 1250. Games at 1, 2, 3 (W, W, L): after the
    // last one you were at 1250, before it 1270, before that 1248, …
    const res = E.estimateQueue([g('a', 1, true), g('b', 2, true), g('c', 3, false)], [a(10, 1250)], {});
    assert.deepEqual(after(res), { a: 1248, b: 1270, c: 1250 });
});

test('between two readings, estimates are pulled through both; real deltas stay', () => {
    // 1000 at hour 0, 1010 at hour 10. Games: W (est), real +19, L (est).
    // Estimates sum to +2 but need −9 → each estimate moves by −5.5 → +17 / −26 (rounded)
    const res = E.estimateQueue(
        [g('a', 1, true), g('b', 2, true), g('c', 3, false)],
        [a(0, 1000), a(10, 1010)],
        { b: 19 });
    assert.equal(res.get('b').delta, 19);
    assert.equal(res.get('a').delta + res.get('c').delta, 10 - 19);
    assert.equal(res.get('c').lpAfter, 1010, 'lands exactly on the later reading');
    assert.equal(res.get('a').lpAfter, 1000 + res.get('a').delta);
});

test('a long segment: every estimate within 1 LP of its share, and it lands exactly', () => {
    // 300 alternating games, needed change chosen so each estimate shifts by −3.4
    const games = [];
    for (let i = 0; i < 300; i++) games.push(g(`m${i}`, 1 + i * 0.01, i % 2 === 0));
    const base = 150 * 22 - 150 * 20;                      // +300
    const needed = base - 3.4 * 300;                       // −720
    const res = E.estimateQueue(games, [a(0, 2000), a(10, 2000 + needed)], {});
    for (const [id, r] of res) {
        const ideal = (Number(id.slice(1)) % 2 === 0 ? 22 : -20) - 3.4;
        assert.ok(Math.abs(r.delta - ideal) <= 1, `${id}: ${r.delta} vs ${ideal}`);
    }
    assert.equal(res.get('m299').lpAfter, 2000 + needed);
});

test('readings that can\'t both be right are not forced to fit', () => {
    // 1000 LP down in 4 games: no believable LP per game does that. Keep the
    // usual values, walk back from the later reading, leave the jump visible.
    const res = E.estimateQueue([g('a', 1, true), g('b', 2, false), g('c', 3, true), g('d', 4, false)],
        [a(0, 2000), a(10, 1000)], {});
    assert.deepEqual(deltas(res), { a: 22, b: -20, c: 22, d: -20 });
    // walked back from 1000: d 1000, c 1020, b 998, a 1018
    assert.deepEqual(after(res), { a: 1018, b: 998, c: 1020, d: 1000 });
});

test('an estimate never flips sign: a win stays ≥ 0, a loss ≤ 0', () => {
    // Two wins between 1000 and 990 can't be explained; they become 0, not negative
    const res = E.estimateQueue([g('a', 1, true), g('b', 2, true)], [a(0, 1000), a(10, 990)], {});
    assert.ok(res.get('a').delta >= 0 && res.get('b').delta >= 0);
});

test('games after the last reading walk forward from it', () => {
    const res = E.estimateQueue([g('a', 11, true), g('b', 12, false)], [a(10, 1300)], {});
    assert.deepEqual(after(res), { a: 1322, b: 1302 });
});

test('a game is counted in the segment that ends at the reading taken after it', () => {
    // Real reading right after the game (its delta is real): no double counting
    const res = E.estimateQueue([g('a', 5, true)], [a(0, 1000), a(5.1, 1021)], { a: 21 });
    assert.deepEqual(after(res), { a: 1021 });
});

test('buildLpEstimates: per queue, by match id, with a series for the charts', () => {
    const matches = [
        { matchId: 's1', queueId: 420, gameCreation: 1 * H, gameDuration: 1800, win: 1 },
        { matchId: 'f1', queueId: 440, gameCreation: 2 * H, gameDuration: 1800, win: 0 },
        { matchId: 'n1', queueId: 400, gameCreation: 3 * H, gameDuration: 1800, win: 1 },   // normals have no LP
        { matchId: 's2', queueId: 420, gameCreation: 4 * H, gameDuration: 200, win: 0, isRemake: 1 },
    ];
    const readings = {
        solo: [{ recorded_at: 10 * H, tier: 'SILVER', rank: 'II', lp: 79 }],
        flex: [{ recorded_at: 10 * H, tier: 'SILVER', rank: 'III', lp: 69 }],
    };
    const out = E.buildLpEstimates(matches, readings, {});
    assert.deepEqual(Object.keys(out.byMatch).sort(), ['f1', 's1', 's2']);
    assert.equal(out.byMatch.s1.lpAfter, 800 + 200 + 79, 'Silver II 79 → absolute');
    assert.equal(out.byMatch.s2.remake, true);
    assert.deepEqual(out.series.solo.map(p => p.matchId), ['s1', 's2']);
    assert.equal(out.series.flex[0].lpAfter, 800 + 100 + 69);
    assert.equal(out.typical.solo.measured, false);
});

test('nextDivision: LP and wins to the next division, none in apex tiers', () => {
    // Silver II 79 = 1079 → 21 to Silver I; at +20 per win that's 2 wins
    assert.deepEqual(E.nextDivision(1079, 20), { needed: 21, wins: 2, label: 'Silver I' });
    // Silver I 0 = 1100 → 100 to Gold IV
    assert.deepEqual(E.nextDivision(1100, 25), { needed: 100, wins: 4, label: 'Gold IV' });
    // Diamond I 90 → 10 to Master
    assert.deepEqual(E.nextDivision(6 * 400 + 300 + 90, 20), { needed: 10, wins: 1, label: 'Master' });
    assert.equal(E.nextDivision(2850, 20), null, 'Master+ has no divisions');
    assert.equal(E.nextDivision(null, 20), null);
});

test('rankLabel turns an absolute value back into a rank', () => {
    assert.equal(E.rankLabel(1079), 'Silver II 79 LP');
    assert.equal(E.rankLabel(2800 + 145), 'Master+ 145 LP');
    assert.equal(E.rankLabel(0), 'Iron IV 0 LP');
});
