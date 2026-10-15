/**
 * lpAttribution.js — which ranked game does each LP reading belong to?
 *
 * Pure: database.js loads the rows and writes the answer back. Kept apart so
 * the rules can be tested without SQLite.
 *
 * Riot only reports current LP, so the tracker stores readings; a reading's
 * change is "this one minus the one before". That change belongs to a game
 * only when it covers exactly one game:
 *
 *  - With wins/losses on both readings (League-V4 sends them), the change in
 *    wins + losses says how many games it covers. 0 = refund or decay,
 *    2+ = the watcher missed a game. Neither is credited to a game.
 *  - Exactly one stored, non-remake game of that queue must have ended between
 *    the two readings. None means it isn't synced yet: leave the reading
 *    unlinked and try again after the next sync.
 *  - Older readings without wins/losses rely on the second rule alone.
 *
 * Windows between consecutive readings don't overlap, so a game can never be
 * credited to two readings.
 */

const LP_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const LP_DIVS  = { IV: 0, III: 1, II: 2, I: 3 };

/**
 * Collapse tier + division + LP into one continuous number so a delta stays
 * correct across a promotion (Gold I 98 → Platinum IV 8 is +10, not −90).
 */
function absoluteLp(tier, rank, lp) {
    const t = String(tier || '').toUpperCase();
    const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].indexOf(t);
    if (apex >= 0) return LP_TIERS.length * 400 + lp;
    const ti = LP_TIERS.indexOf(t);
    if (ti < 0) return lp;
    return ti * 400 + (LP_DIVS[String(rank || 'IV').toUpperCase()] ?? 0) * 100 + lp;
}

/** Ranked games played between two readings, or null when either lacks W/L. */
function gamesBetween(prev, cur) {
    const known = r => r && r.wins != null && r.losses != null;
    if (!known(prev) || !known(cur)) return null;
    return (cur.wins + cur.losses) - (prev.wins + prev.losses);
}

/**
 * @param {Array<{id, recorded_at, wins?, losses?}>} readings  one queue, oldest first
 * @param {Array<{matchId, endAt}>} games  that queue's stored non-remake games
 * @returns {Map} reading id → matchId, or null when it shouldn't be credited
 */
function attributeReadings(readings, games) {
    const links = new Map();
    readings.forEach((cur, i) => {
        links.set(cur.id, null);
        if (i === 0) return;                       // nothing to measure from
        const prev = readings[i - 1];
        const played = gamesBetween(prev, cur);
        if (played !== null && played !== 1) return;
        const ended = games.filter(g => g.endAt > prev.recorded_at && g.endAt <= cur.recorded_at);
        if (ended.length === 1) links.set(cur.id, ended[0].matchId);
    });
    return links;
}

/**
 * Per-match LP change: { matchId: delta }, each linked reading measured from
 * the reading before it. Summed, so a match can never lose part of its change.
 *
 * @param {Array<{tier, rank, lp, matchId}>} readings  one or more queues, each oldest first
 */
function deltasByMatch(readings) {
    const out = {};
    for (let i = 1; i < readings.length; i++) {
        const cur = readings[i];
        if (!cur.matchId) continue;
        const prev = readings[i - 1];
        const delta = absoluteLp(cur.tier, cur.rank, cur.lp) - absoluteLp(prev.tier, prev.rank, prev.lp);
        out[cur.matchId] = (out[cur.matchId] || 0) + delta;
    }
    return out;
}

module.exports = { absoluteLp, gamesBetween, attributeReadings, deltasByMatch };
