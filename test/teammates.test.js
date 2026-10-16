/**
 * Issue #11: teammates per game, and the Teammates table.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const T = require(path.join(SRC, 'services', 'teammates.js'));

function raw() {
    return { info: { participants: Array.from({ length: 10 }, (_, i) => ({
        puuid: `p${i}`, participantId: i + 1, teamId: i < 5 ? 100 : 200,
        championName: i === 0 ? 'Ahri' : `C${i}`,
        riotIdGameName: `Name${i}`, riotIdTagline: 'EUW',
    })) } };
}

test('teammatesOf: the four players on your team, with Riot IDs', () => {
    const t = T.teammatesOf(raw(), 'Ahri', 100);
    assert.deepEqual(t.map(x => x.puuid), ['p1', 'p2', 'p3', 'p4']);
    assert.equal(t[0].name, 'Name1#EUW');
    assert.deepEqual(T.teammatesOf(raw(), 'Nobody', 100), []);
});

test('teammatesOf falls back to summonerName on old payloads', () => {
    const r = raw();
    delete r.info.participants[1].riotIdGameName;
    r.info.participants[1].summonerName = 'OldName';
    assert.equal(T.teammatesOf(r, 'Ahri', 100)[0].name, 'OldName');
});

test('teammateTable: 3+ games, most games first, win rate, newest name, last played, strip', () => {
    const day = 86400000;
    const games = Array.from({ length: 5 }, (_, i) => ({ matchId: `m${i}`, gameCreation: i * day, win: i % 2 === 0 ? 1 : 0 }));
    const by = new Map([
        ['m0', [{ puuid: 'duo', name: 'Duo#OLD' }, { puuid: 'once', name: 'Once#1' }]],
        ['m1', [{ puuid: 'duo', name: 'Duo#OLD' }, { puuid: 'trio', name: 'Trio#1' }]],
        ['m2', [{ puuid: 'duo', name: 'Duo#EUW' }, { puuid: 'trio', name: 'Trio#1' }]],
        ['m3', [{ puuid: 'duo', name: 'Duo#EUW' }, { puuid: 'trio', name: 'Trio#1' }]],
        ['m4', [{ puuid: 'duo', name: 'Duo#EUW' }]],
    ]);
    const rows = T.teammateTable(games, by);
    assert.deepEqual(rows.map(r => [r.name, r.games, r.wins]), [['Duo#EUW', 5, 3], ['Trio#1', 3, 1]]);
    assert.equal(rows[0].winRate, 0.6);
    assert.equal(rows[0].lastPlayed, 4 * day);
    assert.deepEqual(rows[0].strip, [true, false, true, false, true], 'oldest → newest');
    // Only games in the list count (filters), so a filtered list can drop someone
    assert.deepEqual(T.teammateTable(games.slice(0, 2), by).map(r => r.name), []);
});

test('the strip keeps the last 30 games', () => {
    const games = Array.from({ length: 40 }, (_, i) => ({ matchId: `m${i}`, gameCreation: i, win: i < 10 ? 0 : 1 }));
    const by = new Map(games.map(g => [g.matchId, [{ puuid: 'duo', name: 'Duo' }]]));
    const [row] = T.teammateTable(games, by);
    assert.equal(row.strip.length, 30);
    assert.ok(row.strip.every(Boolean), 'the 10 early losses fell off the strip');
});
