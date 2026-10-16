/**
 * teammates.js — who you play with (#11). Pure.
 *
 * Each game's four teammates (same team, not you) are read once from rawJson
 * and kept in the small `match_teammates` table (see matchService
 * loadTeammates), so the Teammates page never reopens the match blobs.
 * Players are keyed by PUUID, which survives Riot ID changes; the name shown
 * is the newest one seen.
 */

const MIN_GAMES = 3;      // fewer games together isn't someone you play with
const STRIP = 30;         // last N games together, as win/loss squares

/** Your four teammates in a match: [{ puuid, name }]. */
function teammatesOf(raw, championName, teamId) {
    const ps = (raw && raw.info ? raw.info.participants : raw && raw.participants) || [];
    const me = ps.find(p => p.championName === championName && p.teamId === teamId);
    if (!me) return [];
    return ps
        .filter(p => p.teamId === teamId && p !== me && p.puuid && p.puuid !== 'BOT')
        .map(p => ({
            puuid: p.puuid,
            name: p.riotIdGameName
                ? `${p.riotIdGameName}#${p.riotIdTagline || ''}`.replace(/#$/, '')
                : (p.summonerName || 'Unknown'),
        }));
}

/**
 * Players you've played at least `minGames` with, most games first.
 * @param {Array} matches            the games to count (filtered, remakes out)
 * @param {Map}   teammatesByMatch   matchId → [{ puuid, name }]
 */
function teammateTable(matches, teammatesByMatch, { minGames = MIN_GAMES } = {}) {
    const byPlayer = new Map();
    const ordered = [...matches].sort((a, b) => a.gameCreation - b.gameCreation);
    for (const m of ordered) {
        for (const t of teammatesByMatch.get(m.matchId) || []) {
            const row = byPlayer.get(t.puuid) || { puuid: t.puuid, name: t.name, games: 0, wins: 0, lastPlayed: 0, results: [] };
            row.games++;
            if (m.win === 1) row.wins++;
            row.name = t.name;                         // newest name wins (oldest first loop)
            row.lastPlayed = Math.max(row.lastPlayed, m.gameCreation || 0);
            row.results.push(m.win === 1);
            byPlayer.set(t.puuid, row);
        }
    }
    return [...byPlayer.values()]
        .filter(r => r.games >= minGames)
        .map(({ results, ...r }) => ({ ...r, winRate: r.wins / r.games, strip: results.slice(-STRIP) }))
        .sort((a, b) => (b.games - a.games) || (b.lastPlayed - a.lastPlayed));
}

module.exports = { MIN_GAMES, STRIP, teammatesOf, teammateTable };
