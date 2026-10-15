const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const T = require(path.join(SRC, 'services', 'matchTimeline.js'));

const MIN = 60000;

/** Ten players; ids 1–5 on team 100, 6–10 on 200 (champion = 'C' + id). */
function raw() {
    return {
        info: {
            participants: Array.from({ length: 10 }, (_, i) => ({
                participantId: i + 1, teamId: i < 5 ? 100 : 200, championName: 'C' + (i + 1),
            })),
        },
    };
}

/** Frames 0..n; `gold(min, pid)` / `xp(min, pid)` per player; events placed by timestamp. */
function timeline(n, { gold = () => 1000, xp = () => 500, events = [] } = {}) {
    const frames = [];
    for (let m = 0; m <= n; m++) {
        const participantFrames = {};
        for (let p = 1; p <= 10; p++) participantFrames[p] = { totalGold: gold(m, p), xp: xp(m, p) };
        frames.push({
            timestamp: m * MIN,
            participantFrames,
            // Riot lists an event in the frame that ends after it
            events: events.filter(e => e.timestamp > (m - 1) * MIN && e.timestamp <= m * MIN),
        });
    }
    return { info: { frames } };
}

const kill = (t, killerId, victimId) => ({ type: 'CHAMPION_KILL', timestamp: t, killerId, victimId });

test('win probability is 50% when even and follows Lol Stats\' weights', () => {
    assert.equal(T.winProbability(0, 0, 0), 0.5);
    // (gold + 0.5·xp + 300·kills) / 2500 through a sigmoid
    assert.equal(T.winProbability(2500, 0, 0), 1 / (1 + Math.exp(-1)));
    assert.equal(T.winProbability(0, 5000, 0), T.winProbability(2500, 0, 0));
    assert.equal(T.winProbability(0, 0, 5), T.winProbability(1500, 0, 0));
    assert.ok(T.winProbability(-3000, -2000, -4) < 0.2);
});

test('team series: per-minute gold, XP and kill differences from one team\'s side', () => {
    // Team 100 gains 100 gold per player per minute over team 200; one kill at 2:30
    const tl = timeline(4, {
        gold: (m, p) => 1000 + (p <= 5 ? m * 100 : 0),
        xp: (m, p) => 500 + (p <= 5 ? m * 40 : 0),
        events: [kill(150000, 2, 7)],
    });
    const s = T.teamSeries(raw(), tl, 100);
    assert.deepEqual(s.map(f => f.minute), [0, 1, 2, 3, 4]);
    assert.deepEqual(s.map(f => f.goldDiff), [0, 500, 1000, 1500, 2000]);
    assert.deepEqual(s.map(f => f.xpDiff), [0, 200, 400, 600, 800]);
    assert.deepEqual(s.map(f => f.killDiff), [0, 0, 0, 1, 1]);
    assert.equal(s[0].winProb, 0.5);
    assert.ok(s[4].winProb > s[1].winProb);

    // The other side sees the mirror image
    const other = T.teamSeries(raw(), tl, 200);
    assert.deepEqual(other.map(f => f.goldDiff), [0, -500, -1000, -1500, -2000]);
    assert.ok(Math.abs(other[4].winProb - (1 - s[4].winProb)) < 1e-12);
});

test('team series is empty without a timeline or with an unknown team', () => {
    assert.deepEqual(T.teamSeries(raw(), null, 100), []);
    assert.deepEqual(T.teamSeries(raw(), timeline(2), 300), []);
});

test('events: kills, objectives (with dragon names) and structures, oldest first', () => {
    const tl = timeline(30, { events: [
        { type: 'BUILDING_KILL', timestamp: 14 * MIN, buildingType: 'TOWER_BUILDING', teamId: 200,
          laneType: 'MID_LANE', towerType: 'OUTER_TURRET', killerId: 3 },
        { type: 'ELITE_MONSTER_KILL', timestamp: 9 * MIN, monsterType: 'DRAGON',
          monsterSubType: 'FIRE_DRAGON', killerTeamId: 100, killerId: 2 },
        kill(5 * MIN, 0, 4),                    // executed: no killer
        kill(6 * MIN, 1, 6),
        { type: 'ELITE_MONSTER_KILL', timestamp: 25 * MIN, monsterType: 'BARON_NASHOR', killerId: 8 },
        { type: 'BUILDING_KILL', timestamp: 26 * MIN, buildingType: 'INHIBITOR_BUILDING', teamId: 100, laneType: 'BOT_LANE' },
        { type: 'ITEM_PURCHASED', timestamp: 7 * MIN, participantId: 1, itemId: 1055 },
    ] });
    const ev = T.timelineEvents(raw(), tl);
    assert.deepEqual(ev.map(e => e.kind), ['kill', 'kill', 'objective', 'structure', 'objective', 'structure']);
    assert.deepEqual(ev.map(e => e.t), [5, 6, 9, 14, 25, 26].map(m => m * MIN));

    const [executed, k] = ev;
    assert.equal(executed.killerTeam, 200, 'an execution counts for the victim\'s enemies');
    assert.equal(executed.label, 'C4 was executed');
    assert.equal(k.label, 'C1 killed C6');
    assert.equal(k.killerTeam, 100);

    assert.equal(ev[2].label, 'Infernal Dragon');
    assert.equal(ev[2].team, 100);
    assert.equal(ev[3].label, 'Mid outer turret');
    assert.equal(ev[3].team, 100, 'a structure counts for the team that destroyed it');
    assert.equal(ev[4].label, 'Baron Nashor');
    assert.equal(ev[4].team, 200, 'killer team falls back to the killer\'s team');
    assert.equal(ev[5].label, 'Bot inhibitor');
    assert.equal(ev[5].team, 200);
});

test('markers follow the toggles and the viewed player', () => {
    const tl = timeline(20, { events: [
        kill(3 * MIN, 1, 6), kill(4 * MIN, 7, 1), kill(5 * MIN, 2, 8),
        { type: 'ELITE_MONSTER_KILL', timestamp: 9 * MIN, monsterType: 'HORDE', killerTeamId: 200 },
        { type: 'BUILDING_KILL', timestamp: 12 * MIN, buildingType: 'TOWER_BUILDING', teamId: 200, laneType: 'TOP_LANE', towerType: 'OUTER_TURRET' },
    ] });
    const ev = T.timelineEvents(raw(), tl);

    const mine = T.visibleMarkers(ev, { participantId: 1, teamId: 100, show: { mine: true } });
    assert.deepEqual(mine.map(m => m.style), ['my-kill', 'my-death']);

    const all = T.visibleMarkers(ev, { participantId: 1, teamId: 100, show: { mine: true, kills: true } });
    assert.deepEqual(all.map(m => m.style), ['my-kill', 'my-death', 'ally']);

    const objs = T.visibleMarkers(ev, { participantId: 1, teamId: 100, show: { objectives: true, structures: true } });
    assert.deepEqual(objs.map(m => [m.kind, m.style]), [['objective', 'enemy'], ['structure', 'ally']]);
    assert.equal(objs[0].label, 'Voidgrubs');

    // Viewed from player 7 on the other team, the same kill is theirs
    const theirs = T.visibleMarkers(ev, { participantId: 7, teamId: 200, show: { mine: true } });
    assert.deepEqual(theirs.map(m => m.style), ['my-kill']);

    assert.deepEqual(T.visibleMarkers(ev, { participantId: 1, teamId: 100, show: {} }), []);
});

test('formatClock', () => {
    assert.equal(T.formatClock(0), '0:00');
    assert.equal(T.formatClock(14 * MIN + 5000), '14:05');
    assert.equal(T.formatClock(61 * MIN), '61:00');
});
