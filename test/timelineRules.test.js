const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const { platesTakenBy, respawnSeconds, deadWindows, isDeadAt } = require(path.join(SRC, 'services', 'timelineRules.js'));

const MIN = 60_000;
const plate = (timestamp, killerId, x = 1) => ({ type: 'TURRET_PLATE_DESTROYED', timestamp, killerId, position: { x, y: 1 } });

test('plates: only mine, only before 14:00, a repeated event once', () => {
    const events = [plate(5 * MIN, 3), plate(5 * MIN, 3), plate(6 * MIN, 3, 2), plate(7 * MIN, 8),
                    plate(13 * MIN + 59e3, 3, 3), plate(14 * MIN, 3), plate(20 * MIN, 3),
                    { type: 'CHAMPION_KILL', timestamp: 1, killerId: 3 }];
    assert.equal(platesTakenBy(events, 3), 3);
    assert.equal(platesTakenBy(events, 8), 1);
    assert.equal(platesTakenBy([], 3), 0);
    assert.equal(platesTakenBy(undefined, 3), 0);
});

test('respawn time by level, growing after 15:00, capped at +50%', () => {
    assert.equal(respawnSeconds(1, 3 * MIN), 6);
    assert.equal(respawnSeconds(10, 12 * MIN), 32.5);
    assert.equal(respawnSeconds(18, 10 * MIN), 52.5);
    // 30:00: 30 half-minutes × 0.425% = +12.75%
    assert.ok(Math.abs(respawnSeconds(10, 30 * MIN) - 32.5 * 1.1275) < 1e-9);
    // 60:00: capped at +50%
    assert.equal(respawnSeconds(18, 60 * MIN), 52.5 * 1.5);
    // unknown or silly level
    assert.equal(respawnSeconds(undefined, 0), 6);
    assert.equal(respawnSeconds(25, 0), 52.5);
});

test('dead windows from deaths and the level in the frame before', () => {
    const frames = [];
    for (let m = 0; m <= 20; m++) frames.push({ timestamp: m * MIN, participantFrames: { 3: { level: m < 10 ? 6 : 12 } } });
    const events = [
        { type: 'CHAMPION_KILL', victimId: 3, timestamp: 8 * MIN },    // level 6: 12 s
        { type: 'CHAMPION_KILL', victimId: 4, timestamp: 9 * MIN },    // someone else
        { type: 'CHAMPION_KILL', victimId: 3, timestamp: 11 * MIN },   // level 12: 37.5 s
    ];
    const w = deadWindows(events, frames, 3);
    assert.deepEqual(w, [[8 * MIN, 8 * MIN + 12000], [11 * MIN, 11 * MIN + 37500]]);
    assert.equal(isDeadAt(w, 8 * MIN + 5000), true);
    assert.equal(isDeadAt(w, 8 * MIN + 13000), false);
    assert.equal(isDeadAt(w, 11 * MIN + 30000), true);
    assert.equal(isDeadAt(w, 9 * MIN), false);
});
