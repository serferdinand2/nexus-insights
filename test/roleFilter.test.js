/**
 * Issue #10: role table on Overview, and role benchmarks when the Analytics
 * role filter picks one role.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stubDatabase, makeMatch, SRC } = require('./helpers');

stubDatabase([]);
global.window = global.window || {};
require(path.join(SRC, 'components', 'analyticsEngine.js'));
const { roleTable } = require(path.join(SRC, 'services', 'championStats.js'));

const card = (cards, id) => cards.find(c => c.id === id);

test('roleTable: one row per role, most played first, with play rate', () => {
    const rows = roleTable([
        makeMatch({ teamPosition: 'JUNGLE', win: 1 }),
        makeMatch({ teamPosition: 'JUNGLE', win: 0 }),
        makeMatch({ teamPosition: 'JUNGLE', win: 1 }),
        makeMatch({ teamPosition: 'MIDDLE', win: 0 }),
        makeMatch({ teamPosition: '', win: 1 }),
    ]);
    assert.deepEqual(rows.map(r => [r.role, r.games]), [['JUNGLE', 3], ['MIDDLE', 1], ['', 1]]);
    assert.equal(rows[0].playRate, 0.6);
    assert.equal(rows[0].winRate, 2 / 3);
    assert.equal(rows[0].label, 'Jungle');
    assert.equal(rows[2].label, 'No role');
    assert.deepEqual(roleTable([]), []);
});

test('with a role, cards are ranked on that role\'s thresholds; without one, the general ones', () => {
    // 186 CS in 30 min = 6.2/min: Gold on the general ladder, Platinum for a jungler
    const games = [makeMatch({ teamPosition: 'JUNGLE', totalMinionsKilled: 186, gameDuration: 1800 })];
    assert.equal(card(window.computeTabStats('Overview', games, []), 'avg_csm').benchmarkRank, 'gold');
    assert.equal(card(window.computeTabStats('Overview', games, [], { role: 'JUNGLE' }), 'avg_csm').benchmarkRank, 'platinum');
    // A stat with no role override keeps the general ladder
    const general = card(window.computeTabStats('Overview', games, []), 'avg_kda').benchmarkRank;
    assert.equal(card(window.computeTabStats('Overview', games, [], { role: 'JUNGLE' }), 'avg_kda').benchmarkRank, general);
});

test('the role never leaks into a later call (Coaching and chat call without one)', () => {
    const games = [makeMatch({ teamPosition: 'JUNGLE', totalMinionsKilled: 186, gameDuration: 1800 })];
    window.computeTabStats('Overview', games, [], { role: 'JUNGLE' });
    assert.equal(card(window.computeTabStats('Overview', games, []), 'avg_csm').benchmarkRank, 'gold');
});

test('getStatBenchmark follows the role too, so the history chart\'s bands match the card', () => {
    assert.equal(window.getStatBenchmark('avg_csm').gold, 6.0);
    assert.equal(window.getStatBenchmark('avg_csm', 'JUNGLE').gold, 5.8);
    assert.equal(window.getStatBenchmark('avg_kda', 'JUNGLE').gold, window.getStatBenchmark('avg_kda').gold);
    assert.equal(window.getStatBenchmark('nope', 'JUNGLE'), null);
});
