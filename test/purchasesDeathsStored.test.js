/**
 * #7 / #8: the computed-stats pipeline stores your purchases and death spots.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stubDatabase, SRC } = require('./helpers');

stubDatabase([]);
global.window = global.window || {};
const { computeAdvancedStatsForMatch } = require(path.join(SRC, 'services', 'matchService.js'));

const raw = { info: { gameDuration: 1800, participants: Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1, teamId: i < 5 ? 100 : 200, championName: 'C' + (i + 1), teamPosition: 'TOP',
})) } };

test('purchases and deaths are stored for the tracked player; red side turned to blue', () => {
    const timeline = { info: { frames: [
        { timestamp: 0, participantFrames: {}, events: [
            { type: 'ITEM_PURCHASED', timestamp: 2000, participantId: 7, itemId: 1055 },
            { type: 'ITEM_PURCHASED', timestamp: 3000, participantId: 2, itemId: 9999 },     // someone else
        ] },
        { timestamp: 60000, participantFrames: {}, events: [
            { type: 'CHAMPION_KILL', timestamp: 610000, victimId: 7, killerId: 2, position: { x: 4000, y: 13500 } },
            { type: 'ITEM_PURCHASED', timestamp: 615000, participantId: 7, itemId: 3006 },
        ] },
    ] } };
    const s = computeAdvancedStatsForMatch(raw, timeline, 'C7', 200);
    assert.equal(s.itemPurchases, '1055:2,3006:615');
    assert.equal(s.deathPositions, `${14980 - 13500},${14980 - 4000},610`);
});

test("no timeline: '' for both, so the backfill doesn't keep coming back", () => {
    const s = computeAdvancedStatsForMatch(raw, null, 'C1', 100);
    assert.equal(s.itemPurchases, '');
    assert.equal(s.deathPositions, '');
});
