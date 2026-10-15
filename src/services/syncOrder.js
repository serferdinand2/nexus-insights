/**
 * syncOrder.js — pure rules for the order a sync stores games in, and when it
 * must stop (issue #13).
 *
 * The next sync only asks Riot for games after the newest stored one. So a
 * sync has to store games oldest first, and stop at a game it couldn't store
 * for a reason that may go away: storing anything newer after that leaves a
 * hole no later sync would ever fill.
 */

/** Numeric part of a Match-V5 id ("EUW1_7234567890" → 7234567890). */
function matchNumber(id) {
    const n = Number(String(id).split('_').pop());
    return Number.isFinite(n) ? n : 0;
}

/**
 * Match ids oldest first. Riot returns them newest first, and per queue, so a
 * multi-queue list isn't in any order. Game ids on a platform are sequential,
 * so the number after the underscore orders them by time.
 */
function oldestFirst(ids) {
    return [...ids].sort((a, b) => matchNumber(a) - matchNumber(b));
}

/**
 * Should a failure on one game stop the sync?
 *
 * Yes when a later sync might succeed: no response (network), an invalid or
 * expired key (401/403), rate limits and server errors that outlived the
 * limiter's retries, and a failed database write. No for a 404 (that game will never be available) or an
 * error while reading the game's data: retrying gives the same result, so
 * stopping would block every future sync at this game.
 */
function shouldStopSync(err) {
    if (!err) return false;
    // The game couldn't be saved (database busy, disk full): try again later.
    if (String(err.code || '').startsWith('SQLITE_')) return true;
    // Otherwise only API failures. Anything else is a problem with this game's data.
    if ((!err.isAxiosError && !('response' in err))) return false;
    return err.response?.status !== 404;
}

module.exports = { oldestFirst, shouldStopSync, matchNumber };
