const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stubDatabase, makeMatch, SRC } = require('./helpers');

stubDatabase([]);
global.window = global.window || {};
require(path.join(SRC, 'components', 'analyticsEngine.js'));
const P = require(path.join(SRC, 'components', 'coachingProgress.js'));
const Engine = require(path.join(SRC, 'components', 'coachingEngine.js'));
const cts = window.computeTabStats;

const DAY = 86400000;
function series(n, f) {
    return Array.from({ length: n }, (_, i) => makeMatch(Object.assign({
        matchId: 'EUW1_' + i, queueId: 420, teamPosition: 'JUNGLE',
        gameCreation: Date.UTC(2026, 5, 1) + i * DAY, gameDuration: 1800,
    }, f(i))));
}

test('only Solo/Duo, no remakes, oldest first', () => {
    const all = [
        makeMatch({ matchId: 'a', queueId: 420, gameCreation: 3 }),
        makeMatch({ matchId: 'b', queueId: 440, gameCreation: 2 }),
        makeMatch({ matchId: 'c', queueId: 420, gameCreation: 1 }),
        makeMatch({ matchId: 'd', queueId: 420, gameCreation: 4, gameDuration: 200 }),
    ];
    assert.deepEqual(P.soloGames(all).map(g => g.matchId), ['c', 'a']);
});

test('last-game report uses the Analytics formulas and compares with the 20 games before', () => {
    // 25 ordinary games, then one great game
    const games = series(26, i => i < 25
        ? { kills: 3, deaths: 5, assists: 5, win: i % 2 }
        : { kills: 12, deaths: 1, assists: 10, win: 1 });
    const r = P.lastGameReport(games, games.length - 1, cts);
    assert.equal(r.baselineCount, 20);
    const kda = r.stats.find(s => s.id === 'avg_kda');
    // same number the Overview card would show for that one game
    const card = cts('Overview', [games[25]]).find(c => c.id === 'avg_kda');
    assert.equal(kda.value, card.value);
    assert.equal(kda.verdict, 'better');
    assert.ok(r.better >= 1);
});

test('stepping back compares an earlier game with the games before IT', () => {
    const games = series(30, () => ({ kills: 3, deaths: 3, assists: 3 }));
    const r = P.lastGameReport(games, 5, cts);
    assert.equal(r.index, 5);
    assert.equal(r.baselineCount, 5);
    assert.equal(P.lastGameReport(games, 999, cts).index, 29, 'clamped to the newest game');
});

test('tiny differences count as "same", not better/worse', () => {
    const { verdict } = P._internal;
    assert.equal(verdict(2.71, 2.68, true, 0.15), 'same');
    assert.equal(verdict(3.5, 2.68, true, 0.15), 'better');
    assert.equal(verdict(1, 0.6, false, 0.2), 'worse');
    assert.equal(verdict(null, 1, true, 0.1), null);
});

test('focus dots: hit/missed per game for the last 10, compared with the 10 before', () => {
    // early deaths: bad for 10 games, then good for 10
    const games = series(20, i => ({ deathsBefore10: i < 10 ? 2 : 0 }));
    const hits = P.focusHits(games, Engine, 'earlyDeaths', 'JUNGLE');
    assert.equal(hits.dots.length, 10);
    assert.ok(hits.dots.every(d => d.met === true));
    assert.deepEqual(hits.recent, { hit: 10, of: 10 });
    assert.deepEqual(hits.before, { hit: 0, of: 10 });
});

test('area trends: last 10 vs the 10 before, with a rolling sparkline', () => {
    // deaths drop sharply in the last 10 games
    const games = series(30, i => i < 20
        ? { deaths: 8, deathsBefore10: 2, isolatedDeaths: 4, kills: 4, assists: 6 }
        : { deaths: 2, deathsBefore10: 0, isolatedDeaths: 1, kills: 4, assists: 6 });
    const areas = P.areaTrends(games, cts);
    assert.deepEqual(areas.map(a => a.tab), P.AREAS.map(a => a.tab));
    const dr = areas.find(a => a.tab === 'Death Review');
    assert.equal(dr.verdict, 'improving');
    assert.equal(dr.spark.length, 21, 'one point per 10-game window ending at games 10..30');
    assert.equal(P.areaTrends(games.slice(0, 5), cts).length, 0, 'needs at least 10 games');
});

test('rank header: W-L and LP over the last 10, saying how many had LP tracked', () => {
    const games = series(12, i => ({ win: i % 3 !== 0 }));
    const h = P.rankHeader(games, { EUW1_11: 20, EUW1_10: -15, EUW1_0: 99 });
    assert.equal(h.games, 10);
    assert.equal(h.wins + h.losses, 10);
    assert.equal(h.lpChange, 5);
    assert.equal(h.lpTracked, 2);
    assert.equal(P.rankHeader(games, {}).lpChange, null);
});
