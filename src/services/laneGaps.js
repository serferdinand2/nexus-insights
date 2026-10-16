/**
 * laneGaps.js — your gold and XP minus your lane opponent's, minute by
 * minute, 0 to 20 (issue #12). Pure, tested.
 *
 * Per game: computed once from the timeline at sync / backfill and stored in
 * the `laneGaps` column as JSON, so the Lane Phase chart never parses a
 * timeline. Across games: averaged per minute over the games that lasted
 * that long.
 */

const MAX_MINUTE = 20;

/**
 * { gold: [...], xp: [...] } with index = minute, from timeline frames.
 * Stops at the last full minute the game reached. null when either player
 * has no frames.
 */
function computeLaneGaps(frames, myPId, oppPId, maxMinute = MAX_MINUTE) {
    if (!Array.isArray(frames) || !myPId || !oppPId) return null;
    const gold = [], xp = [];
    for (let m = 0; m <= maxMinute; m++) {
        const f = frames[m];
        // The last frame is the end of the game, part-way through a minute:
        // a 19:30 end must not count as minute 20.
        if (!f || f.timestamp < m * 60000 - 1000) break;
        const me = f.participantFrames && f.participantFrames[myPId];
        const op = f.participantFrames && f.participantFrames[oppPId];
        if (!me || !op) break;
        gold.push((me.totalGold || 0) - (op.totalGold || 0));
        xp.push((me.xp || 0) - (op.xp || 0));
    }
    return gold.length ? { gold, xp } : null;
}

/** Stored column → { gold, xp } or null ('' and NULL both mean none). */
function parseLaneGaps(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        const v = JSON.parse(value);
        return v && Array.isArray(v.gold) && Array.isArray(v.xp) ? v : null;
    } catch { return null; }
}

/**
 * Average gap per minute across `matches` (rows with a `laneGaps` column).
 * @returns {{ points: Array<{minute, gold, xp, games}>, games: number }}
 *   `games` = matches that had any lane data.
 */
function averageLaneGaps(matches) {
    const sums = [];
    let games = 0;
    for (const m of matches || []) {
        const g = parseLaneGaps(m.laneGaps);
        if (!g) continue;
        games++;
        g.gold.forEach((v, minute) => {
            if (!Number.isFinite(v) || !Number.isFinite(g.xp[minute])) return;
            const s = sums[minute] || (sums[minute] = { gold: 0, xp: 0, games: 0 });
            s.gold += v; s.xp += g.xp[minute]; s.games++;
        });
    }
    const points = [];
    sums.forEach((s, minute) => {
        if (s) points.push({ minute, gold: s.gold / s.games, xp: s.xp / s.games, games: s.games });
    });
    return { points, games };
}

module.exports = { computeLaneGaps, parseLaneGaps, averageLaneGaps, MAX_MINUTE };
