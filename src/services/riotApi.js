const axios = require('axios');
const { loadConfig } = require('./config');
const { RateLimiter, DEFAULT_WINDOWS } = require('./rateLimiter');

// Every outbound Riot call goes through this one limiter so the windows are
// enforced across the whole app, not per-function.
const limiter = new RateLimiter(DEFAULT_WINDOWS, {
    log: msg => console.warn(`[riot] ${msg}`),
});

// Get config values (loaded fresh each time to pick up changes)
function getApiKey() {
    return loadConfig().apiKey;
}

function getRegion() {
    return loadConfig().region || 'europe';
}

function getPlatform() {
    return loadConfig().platform || 'euw1';
}

/**
 * Single entry point for Riot HTTP calls.
 *
 * The key goes in the X-Riot-Token header rather than an api_key query
 * parameter — query strings end up in proxy logs, crash reports and browser
 * history, headers generally don't.
 */
function riotGet(url, { params, label, timeout = 15000 } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No Riot API key configured — open Settings and add one.');

    return limiter.request(
        () => axios.get(url, {
            params,
            timeout,
            headers: { 'X-Riot-Token': apiKey },
        }),
        { label }
    ).then(res => res.data);
}

// Fetch ALL match IDs with pagination support.
// startTime: epoch milliseconds (optional) — only fetch matches after this time.
// existingIds: Set of match IDs already in the DB; hitting one stops pagination.
async function getMatchIds(puuid, startTime = null, queue = null, existingIds = null) {
    const REGION = getRegion();
    const allMatchIds = [];
    const batchSize = 100; // Riot API max per request
    let start = 0;

    console.log(`Fetching match IDs${startTime ? ` since ${new Date(startTime).toISOString()}` : ' (recent)'}${queue ? ` (queue=${queue})` : ''}...`);

    while (true) {
        const url = `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`;
        const params = { start, count: batchSize };

        // Riot expects startTime in SECONDS; the app stores milliseconds
        if (startTime) params.startTime = Math.floor(startTime / 1000);
        if (queue) params.queue = queue;

        const matchIds = await riotGet(url, { params, label: `match ids start=${start}` });

        if (matchIds.length === 0) break;

        // If we hit a match we already have, everything older is already stored
        let stopFetching = false;
        for (const id of matchIds) {
            if (existingIds && existingIds.has(id)) {
                console.log(`Encountered existing match ID ${id}, stopping pagination.`);
                stopFetching = true;
                break;
            }
            allMatchIds.push(id);
        }

        if (stopFetching) break;
        if (matchIds.length < batchSize) break; // partial batch = end of history

        start += batchSize;
        // No manual sleep here — the limiter paces every request.
    }

    console.log(`Total NEW match IDs fetched: ${allMatchIds.length}`);
    return allMatchIds;
}

async function getMatchData(matchId) {
    const REGION = getRegion();
    return riotGet(
        `https://${REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        { label: `match ${matchId}` }
    );
}

async function getMatchTimeline(matchId) {
    const REGION = getRegion();
    return riotGet(
        `https://${REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
        { label: `timeline ${matchId}`, timeout: 30000 }
    );
}

// Get PUUID from Riot ID (gameName#tagLine)
async function getPuuidByRiotId(gameName, tagLine) {
    const REGION = getRegion();
    // Account-v1 uses regional routing (americas, europe, asia)
    const url = `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/`
        + `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

    try {
        const data = await riotGet(url, { label: `account ${gameName}#${tagLine}`, timeout: 10000 });
        return data.puuid; // 78-character PUUID
    } catch (error) {
        console.error(`Could not resolve ${gameName}#${tagLine}:`, describeError(error));
        throw error;
    }
}

// Get summoner info (needed for the league endpoint)
async function getSummonerByPuuid(puuid) {
    const PLATFORM = getPlatform();
    try {
        return await riotGet(
            `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
            { label: 'summoner', timeout: 10000 }
        );
    } catch (error) {
        console.error('Error fetching summoner:', describeError(error));
        throw error;
    }
}

// Get league/rank information by PUUID
async function getLeagueByPuuid(puuid) {
    const PLATFORM = getPlatform();
    try {
        const leagues = await riotGet(
            `https://${PLATFORM}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
            { label: 'league', timeout: 10000 }
        );

        const pick = (entry) => entry ? {
            tier: entry.tier,
            rank: entry.rank,
            leaguePoints: entry.leaguePoints,
            wins: entry.wins,
            losses: entry.losses,
        } : null;

        return {
            solo: pick(leagues.find(l => l.queueType === 'RANKED_SOLO_5x5')),
            flex: pick(leagues.find(l => l.queueType === 'RANKED_FLEX_SR')),
        };
    } catch (error) {
        console.error('Error fetching league data:', describeError(error));
        throw error;
    }
}

/** Error summary that never includes the API key. */
function describeError(error) {
    if (error.response) {
        return `HTTP ${error.response.status} ${JSON.stringify(error.response.data)}`;
    }
    return error.message;
}

module.exports = {
    getMatchIds, getMatchData, getMatchTimeline,
    getPuuidByRiotId, getSummonerByPuuid, getLeagueByPuuid,
    limiter,
};
