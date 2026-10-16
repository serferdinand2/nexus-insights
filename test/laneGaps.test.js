const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const { computeLaneGaps, parseLaneGaps, averageLaneGaps } = require(path.join(SRC, 'services', 'laneGaps.js'));

const MIN = 60_000;

/** Frames 0..lastMinute, plus an end-of-game frame at `endMs` if given. */
function frames(lastMinute, endMs, me = m => ({ totalGold: 500 + 400 * m, xp: 450 * m }),
                                    op = m => ({ totalGold: 500 + 380 * m, xp: 430 * m })) {
    const out = [];
    for (let m = 0; m <= lastMinute; m++) {
        out.push({ timestamp: m * MIN + 30, participantFrames: { 3: me(m), 8: op(m) } });
    }
    if (endMs) out.push({ timestamp: endMs, participantFrames: { 3: me(lastMinute + 1), 8: op(lastMinute + 1) } });
    return out;
}

test('gap per minute from 0 to 20, mine minus theirs', () => {
    const g = computeLaneGaps(frames(30), 3, 8);
    assert.equal(g.gold.length, 21);
    assert.equal(g.gold[0], 0);
    assert.equal(g.gold[10], 200);
    assert.equal(g.xp[20], 400);
});

test('a game that ended at 17:30 stops at minute 17', () => {
    const g = computeLaneGaps(frames(17, 17 * MIN + 30_000), 3, 8);
    assert.equal(g.gold.length, 18);
});

test('no frames, missing players or no opponent give null', () => {
    assert.equal(computeLaneGaps([], 3, 8), null);
    assert.equal(computeLaneGaps(frames(20), 3, null), null);
    assert.equal(computeLaneGaps(frames(20), 3, 99), null);
    assert.equal(computeLaneGaps(null, 3, 8), null);
});

test('stored column: JSON, empty and broken values', () => {
    assert.deepEqual(parseLaneGaps('{"gold":[0,10],"xp":[0,5]}'), { gold: [0, 10], xp: [0, 5] });
    assert.equal(parseLaneGaps(''), null);
    assert.equal(parseLaneGaps(null), null);
    assert.equal(parseLaneGaps('{oops'), null);
    assert.equal(parseLaneGaps('{"gold":3}'), null);
});

test('average per minute over the games that lasted that long', () => {
    const rows = [
        { laneGaps: JSON.stringify({ gold: [0, 100, 300], xp: [0, 50, 100] }) },
        { laneGaps: JSON.stringify({ gold: [0, -100], xp: [0, -30] }) },   // ended early
        { laneGaps: '' },                                                     // no lane opponent
        { laneGaps: null },                                                   // not indexed yet
    ];
    const { points, games } = averageLaneGaps(rows);
    assert.equal(games, 2);
    assert.deepEqual(points, [
        { minute: 0, gold: 0,   xp: 0,   games: 2 },
        { minute: 1, gold: 0,   xp: 10,  games: 2 },
        { minute: 2, gold: 300, xp: 100, games: 1 },
    ]);
    assert.deepEqual(averageLaneGaps([]), { points: [], games: 0 });
});
