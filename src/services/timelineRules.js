/**
 * timelineRules.js — rules for reading a player's plates and time spent dead
 * out of Match-V5 timeline events. Pure, tested.
 *
 * Both replace values that were badly off (see CLAUDE.md "Known data bugs,
 * fixed"): Riot's challenges.turretPlatesTaken counted ~6 plates a game, and
 * the old "was I alive for this objective" check said yes ~98% of the time.
 */

// Plates fall off at 14:00. The timeline keeps reporting TURRET_PLATE_DESTROYED
// after that (~40 events a game in 2026 data), which aren't plates you took.
const PLATES_END_MS = 14 * 60000;

/**
 * Plates `participantId` destroyed before 14:00. Riot sometimes sends the
 * same event twice; those are counted once.
 */
function platesTakenBy(events, participantId) {
    const seen = new Set();
    for (const e of events || []) {
        if (e.type !== 'TURRET_PLATE_DESTROYED' || e.killerId !== participantId || e.timestamp >= PLATES_END_MS) continue;
        seen.add(`${e.timestamp}|${e.position ? `${e.position.x},${e.position.y}` : ''}`);
    }
    return seen.size;
}

// Base respawn time in seconds at champion level 1–18
const BASE_RESPAWN = [6, 6, 8, 8, 10, 12, 16, 21, 26, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];

/**
 * Seconds until a champion of `level` who died `gameMs` into the game
 * respawns. After 15:00 the base time grows (+0.425% per 30 s to 30:00,
 * +0.3% to 45:00, +1.45% to 55:00, at most +50%).
 */
function respawnSeconds(level, gameMs) {
    const base = BASE_RESPAWN[Math.min(18, Math.max(1, Math.round(level || 1))) - 1];
    const min = gameMs / 60000;
    const halfMinutes = (from, to) => Math.max(0, Math.min(min, to) - from) * 2;
    const factor = Math.min(0.5,
        halfMinutes(15, 30) * 0.00425 + halfMinutes(30, 45) * 0.003 + halfMinutes(45, 55) * 0.0145);
    return base * (1 + factor);
}

/**
 * [start, end] ms for every death of `participantId`. Level at death comes
 * from the last frame before it.
 */
function deadWindows(events, frames, participantId) {
    const out = [];
    for (const e of events || []) {
        if (e.type !== 'CHAMPION_KILL' || e.victimId !== participantId) continue;
        const frame = (frames || [])[Math.floor(e.timestamp / 60000)];
        const pf = frame && frame.participantFrames && frame.participantFrames[participantId];
        out.push([e.timestamp, e.timestamp + respawnSeconds(pf ? pf.level : 1, e.timestamp) * 1000]);
    }
    return out;
}

const isDeadAt = (windows, t) => windows.some(([from, to]) => t > from && t < to);

module.exports = { platesTakenBy, respawnSeconds, deadWindows, isDeadAt, PLATES_END_MS };
