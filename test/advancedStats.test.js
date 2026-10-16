/**
 * computeAdvancedStatsForMatch — the per-match values behind the Lane Phase,
 * Combat and Death Review cards (issue #14). Hand-built match + timeline, so
 * every expected number below can be checked by hand.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stubDatabase, SRC } = require('./helpers');

stubDatabase([]);
global.window = global.window || {};
const { computeAdvancedStatsForMatch } = require(path.join(SRC, 'services', 'matchService.js'));

const MIN = 60000;
const ME = 1, OPP = 6;                                  // both MIDDLE
const ROLES = ['MIDDLE', 'TOP', 'JUNGLE', 'BOTTOM', 'UTILITY'];
const CHAMPS = ['Ahri', 'Garen', 'LeeSin', 'Jinx', 'Thresh', 'Zed', 'Darius', 'Elise', 'Caitlyn', 'Leona'];

function rawJson({ duration = 1230, me = {}, opp = {} } = {}) {
    const participants = CHAMPS.map((championName, i) => {
        const id = i + 1;
        return {
            participantId: id, teamId: id <= 5 ? 100 : 200, championName,
            teamPosition: ROLES[i % 5], win: id <= 5,
            kills: id <= 5 ? 3 : 2, deaths: 3, assists: 5,
            totalDamageDealtToChampions: 20000, goldEarned: 10000, totalDamageTaken: 18000,
            challenges: { turretPlatesTaken: 0, soloKills: 0 },
        };
    });
    Object.assign(participants[ME - 1], {
        kills: 6, deaths: 3, assists: 8,
        totalDamageDealtToChampions: 30000, goldEarned: 12000, totalDamageTaken: 21000,
        doubleKills: 1, tripleKills: 1, firstBloodAssist: true,
        challenges: { killParticipation: 0.6, turretPlatesTaken: 3, soloKills: 2, visionScoreAdvantageLaneOpponent: 0.25 },
    }, me);
    Object.assign(participants[OPP - 1], { challenges: { turretPlatesTaken: 1, soloKills: 1 } }, opp);
    return { info: { gameDuration: duration, participants } };
}

/** Frames 0..lastMinute. Teammates stand far from mid unless placed. */
function timeline({ lastMinute = 20, events = [], place = {} } = {}) {
    const frames = [];
    for (let m = 0; m <= lastMinute; m++) {
        const pf = {};
        for (let id = 1; id <= 10; id++) {
            pf[id] = { minionsKilled: 5 * m, jungleMinionsKilled: 0, totalGold: 500 + 300 * m, xp: 400 * m,
                       position: { x: 2000, y: 12000 } };
        }
        Object.assign(pf[ME],  { minionsKilled: 8 * m, totalGold: 500 + 400 * m, xp: 450 * m, position: { x: 7000, y: 7000 } });
        Object.assign(pf[OPP], { minionsKilled: 7 * m, totalGold: 500 + 350 * m, xp: 420 * m, position: { x: 7500, y: 7500 } });
        for (const [key, pos] of Object.entries(place)) {
            const [minute, id] = key.split(':').map(Number);
            if (minute === m) pf[id].position = pos;
        }
        frames.push({
            timestamp: m * MIN, participantFrames: pf,
            events: events.filter(e => e.timestamp > (m - 1) * MIN && e.timestamp <= m * MIN),
        });
    }
    return { info: { frames } };
}

const round3 = v => parseFloat(v.toFixed(3));
const kill = (t, killerId, victimId, extra = {}) => ({ type: 'CHAMPION_KILL', timestamp: t, killerId, victimId, ...extra });
const monster = (t, killerId, monsterType = 'DRAGON') => ({ type: 'ELITE_MONSTER_KILL', timestamp: t, killerId, monsterType });

// Four deaths and two kills for "me", plus objectives
const EVENTS = [
    kill(3 * MIN, 7, ME),                                                       // no position → isolated
    kill(5.5 * MIN, 8, ME, { position: { x: 7000, y: 7000 }, bounty: 400 }),    // teammate 2 is close → not isolated; shutdown given
    kill(6 * MIN, ME, OPP, { bounty: 500 }),                                    // shutdown claimed
    kill(7 * MIN, ME, 7),
    kill(8 * MIN + 10000, 9, ME, { position: { x: 7000, y: 7000 } }),          // alone → isolated
    kill(12 * MIN + 20000, 8, ME, { position: { x: 9000, y: 5000 } }),         // alone, but…
    monster(12 * MIN + 30000, 8),                                               // …an objective 10 s later → not isolated
    monster(15 * MIN, 3),                                                       // your team's dragon, you're alive
];
const PLACE = { '5:2': { x: 7400, y: 7100 } };                                 // teammate 2 near you at minute 5

const stats = (raw = rawJson(), tl = timeline({ events: EVENTS, place: PLACE })) =>
    computeAdvancedStatsForMatch(raw, tl, 'Ahri', 100);

test('lane diffs at 15:00 against the same-position opponent', () => {
    const s = stats();
    assert.equal(s.csDiff15, 8 * 15 - 7 * 15);                       // 120 − 105
    assert.equal(s.goldDiff15, (500 + 400 * 15) - (500 + 350 * 15)); // +750
    assert.equal(s.xpDiff15, 450 * 15 - 420 * 15);                   // +450
    assert.equal(s.laneOpponent, 'Zed');
});

test('CS at 10/15/20 only for games that lasted that long', () => {
    assert.deepEqual([stats().cs10, stats().cs15, stats().cs20], [80, 120, 160]);

    const short = stats(rawJson({ duration: 760 }), timeline({ lastMinute: 12, events: EVENTS, place: PLACE }));
    assert.equal(short.cs10, 80);
    assert.equal(short.cs15, null);
    assert.equal(short.cs20, null);
    assert.equal(short.csDiff15, null, 'no fake @15 diff for a game that ended before 15:00');
    assert.equal(short.goldDiff15, null);
});

test('deaths: early, isolated, and shutdowns both ways', () => {
    const s = stats();
    assert.equal(s.deathsBefore10, 3);           // 3:00, 5:30, 8:10
    assert.equal(s.isolatedDeaths, 2);           // 3:00 (no position) and 8:10 (alone)
    assert.equal(s.shutdownsGiven, 1);
    assert.equal(s.shutdownBountyGiven, 400);
    assert.equal(s.shutdownsClaimed, 1);
});

test('values from the match payload: shares, KP, plates, solo kills, multikills', () => {
    const s = stats();
    assert.equal(s.firstBlood, 1, 'an assist on first blood counts');
    assert.equal(s.dmgShare, 0.273);             // 30000 / 110000
    assert.equal(s.goldShare, 0.231);            // 12000 / 52000
    assert.equal(s.killParticipation, 0.6, "Riot's own KP when present");
    assert.equal(s.enemyTeamKills, 10);
    assert.equal(s.dmgTakenPerDeath, 7000);      // 21000 / 3
    assert.equal(s.multikills, 2);
    assert.equal(s.dmgGoldRatio, 2.5);
    assert.equal(s.platesTaken, 3);
    assert.equal(s.platesLost, 1, "the lane opponent's plates");
    assert.equal(s.soloKillDiff, 1);
    assert.equal(s.visionAdvantage, 0.25);
    assert.equal(s.isRemake, 0);
});

test('KP falls back to (kills + assists) / team kills without challenges', () => {
    const s = stats(rawJson({ me: { challenges: undefined } }));
    assert.equal(s.killParticipation, round3((6 + 8) / (6 + 3 * 4)));
    assert.equal(s.platesTaken, null);
});

test('remakes: Riot\'s flag, or under five minutes', () => {
    assert.equal(stats(rawJson({ me: { gameEndedInEarlySurrender: true } })).isRemake, 1);
    assert.equal(stats(rawJson({ duration: 250 }), timeline({ lastMinute: 4 })).isRemake, 1);
});

test('no timeline: payload values still computed, timeline values stay null', () => {
    const s = computeAdvancedStatsForMatch(rawJson(), null, 'Ahri', 100);
    assert.equal(s.dmgShare, 0.273);
    assert.equal(s.impactRank !== null, true);
    for (const k of ['csDiff15', 'cs10', 'deathsBefore10', 'isolatedDeaths', 'objectiveRate']) {
        assert.equal(s[k], null, k);
    }
});

test('player not found, no position, or broken JSON: defaults, never a throw', () => {
    assert.equal(computeAdvancedStatsForMatch(rawJson(), null, 'Teemo', 100).dmgShare, null);
    assert.equal(computeAdvancedStatsForMatch('{not json', null, 'Ahri', 100).dmgShare, null);
    const noRole = computeAdvancedStatsForMatch(rawJson({ me: { teamPosition: '' } }), null, 'Ahri', 100);
    assert.equal(noRole.laneOpponent, '');
    assert.equal(noRole.platesLost, null);
});

test('objective rate: your team\'s objectives taken while you were alive', () => {
    // The only team objective (15:00) comes 2:40 after your last death
    assert.equal(stats().objectiveRate, 100);
});

// KNOWN BUG (#14): objectiveRate is ~100 for nearly every stored game. To
// decide "dead", the code reads your position from the minute frame BEFORE
// the objective and only counts you dead if that position is in your fountain
// AND you died under 30 s earlier. Riot reports a dead player at the spot they
// died, not the fountain, and respawn timers run past 30 s from mid-game, so
// the check almost never fires. A fix needs real respawn timers (level-based
// wait + the late-game increase), and a recompute of the stored column.
test('objective rate: you were dead 20 s before your team took Baron', { todo: 'objectiveRate dead check, see comment' }, () => {
    const events = [...EVENTS, kill(19 * MIN + 40000, 9, ME, { position: { x: 7000, y: 7000 } }), monster(20 * MIN, 3, 'BARON_NASHOR')];
    // Dragon at 15:00 alive, Baron at 20:00 dead → 1 of 2
    assert.equal(stats(rawJson(), timeline({ events, place: PLACE })).objectiveRate, 50);
});
