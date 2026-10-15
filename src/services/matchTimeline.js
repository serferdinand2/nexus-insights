/**
 * matchTimeline.js — per-minute win probability, gold / XP / kill
 * differences and game events for one match (issue #3).
 *
 * Pure: takes Match-V5 rawJson + timelineJson (both already parsed), returns
 * plain data for components/matchTimelineChart.js to draw.
 *
 * Win probability is an ESTIMATE, not Riot data: a logistic curve over the
 * team gold, XP and kill differences at each minute. Gold counts fully, XP
 * half, a kill as 300 gold, and a 2500-gold-equivalent lead is one logistic
 * unit (~73%). Hand-tuned, not fitted to data.
 */

const GOLD_WEIGHT = 1;
const XP_WEIGHT   = 0.5;
const KILL_WEIGHT = 300;
const SCALE       = 2500;

/** Chance (0–1) that the team with these leads wins. */
function winProbability(goldDiff, xpDiff, killDiff) {
    const score = GOLD_WEIGHT * goldDiff + XP_WEIGHT * xpDiff + KILL_WEIGHT * killDiff;
    return 1 / (1 + Math.exp(-score / SCALE));
}

function participantsOf(raw) {
    return (raw && raw.info ? raw.info.participants : raw && raw.participants) || [];
}

function framesOf(timeline) {
    return (timeline && timeline.info ? timeline.info.frames : timeline && timeline.frames) || [];
}

/** participantId → { teamId, championName } */
function rosterOf(raw) {
    const roster = {};
    participantsOf(raw).forEach((p, i) => {
        roster[p.participantId || i + 1] = { teamId: p.teamId, championName: p.championName };
    });
    return roster;
}

/**
 * One point per timeline frame (every minute, plus the end of the game), from
 * `teamId`'s side: positive = that team is ahead.
 * @returns {Array<{t, minute, goldDiff, xpDiff, killDiff, winProb}>}
 */
function teamSeries(raw, timeline, teamId) {
    const roster = rosterOf(raw);
    const frames = framesOf(timeline);
    if (!frames.length || !Object.values(roster).some(r => r.teamId === teamId)) return [];

    // Kills by a player only (an execution adds no kill to the enemy score)
    const kills = frames.flatMap(f => f.events || [])
        .filter(e => e.type === 'CHAMPION_KILL' && roster[e.killerId])
        .map(e => ({ t: e.timestamp, team: roster[e.killerId].teamId }));

    return frames.map(frame => {
        let gold = 0, xp = 0;
        for (const [pid, pf] of Object.entries(frame.participantFrames || {})) {
            const r = roster[pid];
            if (!r) continue;
            const sign = r.teamId === teamId ? 1 : -1;
            gold += sign * (pf.totalGold || 0);
            xp   += sign * (pf.xp || 0);
        }
        const killDiff = kills.reduce((d, k) => k.t <= frame.timestamp ? d + (k.team === teamId ? 1 : -1) : d, 0);
        return {
            t: frame.timestamp,
            minute: frame.timestamp / 60000,
            goldDiff: gold, xpDiff: xp, killDiff,
            winProb: winProbability(gold, xp, killDiff),
        };
    });
}

const DRAGONS = {
    FIRE_DRAGON: 'Infernal Dragon', WATER_DRAGON: 'Ocean Dragon', EARTH_DRAGON: 'Mountain Dragon',
    AIR_DRAGON: 'Cloud Dragon', HEXTECH_DRAGON: 'Hextech Dragon', CHEMTECH_DRAGON: 'Chemtech Dragon',
    ELDER_DRAGON: 'Elder Dragon',
};
const MONSTERS = { BARON_NASHOR: 'Baron Nashor', RIFTHERALD: 'Rift Herald', HORDE: 'Voidgrubs', ATAKHAN: 'Atakhan' };
const LANES = { TOP_LANE: 'Top', MID_LANE: 'Mid', BOT_LANE: 'Bot' };
const TOWERS = { OUTER_TURRET: 'outer', INNER_TURRET: 'inner', BASE_TURRET: 'base' };

const titleCase = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

function objectiveLabel(e) {
    if (e.monsterType === 'DRAGON') return DRAGONS[e.monsterSubType] || 'Dragon';
    return MONSTERS[e.monsterType] || titleCase(e.monsterType || 'Objective');
}

function structureLabel(e) {
    const lane = LANES[e.laneType];
    if (e.buildingType === 'INHIBITOR_BUILDING') return `${lane || 'An'} inhibitor`;
    if (e.towerType === 'NEXUS_TURRET') return 'Nexus turret';
    return [lane, TOWERS[e.towerType], 'turret'].filter(Boolean).join(' ').replace(/^\w/, c => c.toUpperCase());
}

const otherTeam = team => (team === 100 ? 200 : team === 200 ? 100 : null);

/**
 * Kills, epic monsters and destroyed structures, oldest first. `team` /
 * `killerTeam` is the team that GOT it.
 */
function timelineEvents(raw, timeline) {
    const roster = rosterOf(raw);
    const champ = id => (roster[id] ? roster[id].championName : 'Unknown');
    const out = [];

    for (const e of framesOf(timeline).flatMap(f => f.events || [])) {
        if (e.type === 'CHAMPION_KILL') {
            const victimTeam = roster[e.victimId] ? roster[e.victimId].teamId : null;
            const executed = !roster[e.killerId];
            out.push({
                t: e.timestamp, kind: 'kill',
                killerId: e.killerId, victimId: e.victimId,
                killerTeam: executed ? otherTeam(victimTeam) : roster[e.killerId].teamId,
                label: executed ? `${champ(e.victimId)} was executed` : `${champ(e.killerId)} killed ${champ(e.victimId)}`,
            });
        } else if (e.type === 'ELITE_MONSTER_KILL') {
            out.push({
                t: e.timestamp, kind: 'objective', label: objectiveLabel(e),
                team: e.killerTeamId || (roster[e.killerId] ? roster[e.killerId].teamId : null),
            });
        } else if (e.type === 'BUILDING_KILL' &&
                   (e.buildingType === 'TOWER_BUILDING' || e.buildingType === 'INHIBITOR_BUILDING')) {
            // Riot's teamId here is the team that OWNED the building
            out.push({ t: e.timestamp, kind: 'structure', label: structureLabel(e), team: otherTeam(e.teamId) });
        }
    }
    return out.sort((a, b) => a.t - b.t);
}

/**
 * Events to mark on the chart, given the toggles and whose side it's viewed
 * from. Styles: my-kill / my-death (the viewed player), ally / enemy.
 *
 * @param {object} opts.show  { mine, kills, objectives, structures } booleans
 */
function visibleMarkers(events, { participantId, teamId, show = {} }) {
    const out = [];
    for (const e of events) {
        if (e.kind === 'kill') {
            const mine = e.killerId === participantId || e.victimId === participantId;
            if (show.mine && mine) {
                out.push({ ...e, style: e.victimId === participantId ? 'my-death' : 'my-kill' });
            } else if (show.kills) {
                out.push({ ...e, style: e.killerTeam === teamId ? 'ally' : 'enemy' });
            }
        } else if ((e.kind === 'objective' && show.objectives) || (e.kind === 'structure' && show.structures)) {
            out.push({ ...e, style: e.team === teamId ? 'ally' : 'enemy' });
        }
    }
    return out;
}

/** 845000 → "14:05" */
function formatClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = { winProbability, teamSeries, timelineEvents, visibleMarkers, formatClock, rosterOf };
