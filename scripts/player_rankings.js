/**
 * player_rankings.js
 * Aggregates and ranks a defined list of players from all Solo/Duo (420)
 * and Flex (440) matches in the local SQLite database.
 *
 * ElsaMid#EUW is merged into chipotles#EUW (same person).
 */

const sqlite3 = require('sqlite3').verbose();
const zlib    = require('zlib');
const path    = require('path');
const fs      = require('fs');

// ── Target players (canonical name → list of aliases) ───────────────────────
const PLAYERS = [
    { display: 'Toan#GGWP',             aliases: [['Toan',          'GGWP'  ]] },
    { display: 'chipotles#EUW',          aliases: [['chipotles',     'EUW'   ], ['ElsaMid', 'EUW']] },
    { display: 'JonesAlex123#EUW',       aliases: [['JonesAlex123',  'EUW'   ]] },
    { display: 'nikolath#EUNE',          aliases: [['nikolath',      'EUNE'  ]] },
    { display: 'Aleksa Milin#1337',      aliases: [['Aleksa Milin',  '1337'  ]] },
    { display: 'Soki Balboa#EUW',        aliases: [['Soki Balboa',   'EUW'   ]] },
    { display: 'Uriziel II#2b3a',        aliases: [['Uriziel II',    '2b3a'  ]] },
    { display: 'Potpar109#vp109',        aliases: [['Potpar109',     'vp109' ]] },
    { display: 'Catto go purrrr#EUW',    aliases: [['Catto go purrrr','EUW'  ]] },
    { display: 'Splachina#YUG',          aliases: [['Splachina',     'YUG'   ]] },
    { display: 'Lazar Milin#1337',       aliases: [['Lazar Milin',   '1337'  ]] },
    { display: 'NIKOLa23#EUW',           aliases: [['NIKOLa23',      'EUW'   ]] },
    { display: 'Bogdan Car#1337',         aliases: [['Bogdan Car',    '1337'  ]] },
];

// Build lookup: "name|tag" → display name
const lookup = {};
for (const p of PLAYERS) {
    for (const [name, tag] of p.aliases) {
        lookup[`${name.toLowerCase()}|${tag.toLowerCase()}`] = p.display;
    }
}

// ── Stats accumulator ────────────────────────────────────────────────────────
function makeStats() {
    return {
        games: 0, wins: 0,
        kills: 0, deaths: 0, assists: 0,
        damage: 0, gold: 0, cs: 0, vision: 0,
        gameDurationSec: 0,
        teamDamage: 0,          // for damage share
        doubles: 0, triples: 0, quadras: 0, pentas: 0,
        firstBloods: 0,
        turretKills: 0, baronKills: 0, dragonKills: 0, objectivesStolen: 0,
        soloGames: 0, flexGames: 0,
        // advanced (may be 0 if timeline missing)
        csDiff15: 0,  csDiff15Count: 0,
        goldDiff15: 0, goldDiff15Count: 0,
    };
}

const stats = {};
for (const p of PLAYERS) stats[p.display] = makeStats();

// ── DB ───────────────────────────────────────────────────────────────────────
// The app (Electron) writes to %APPDATA%/nexus-insights/nexus_data.sqlite
const DB_PATH = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => {
    if (err) { console.error('DB error:', err.message); process.exit(1); }
});

function decompress(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return JSON.parse(blob);
    try { return JSON.parse(zlib.gunzipSync(blob).toString('utf8')); }
    catch { return null; }
}

console.log('🔍  Scanning Solo/Duo ONLY (420)…\n');

db.all(
    'SELECT matchId, queueId, rawJson, csDiff15, goldDiff15 FROM matches WHERE queueId = 420',
    (err, rows) => {
        if (err) { console.error(err); process.exit(1); }
        console.log(`📦  ${rows.length} ranked matches found.\n`);

        let skipped = 0;
        let included = 0;

        const TOAN_KEY = 'toan|ggwp';
        // All listed player keys except Toan himself
        const OTHER_KEYS = new Set(
            Object.keys(lookup).filter(k => k !== TOAN_KEY)
        );

        for (const row of rows) {
            const match = decompress(row.rawJson);
            if (!match) continue;

            const parts   = match.info?.participants ?? [];
            const qLabel  = row.queueId === 420 ? 'solo' : 'flex';

            // Build set of participant keys for this match
            const presentKeys = new Set(
                parts.map(p => `${(p.riotIdGameName || '').toLowerCase()}|${(p.riotIdTagline || '').toLowerCase()}`)
            );

            // Skip if Toan is not in this match
            if (!presentKeys.has(TOAN_KEY)) { skipped++; continue; }

            // Skip if no other listed player is present alongside Toan
            const hasOtherPlayer = [...OTHER_KEYS].some(k => presentKeys.has(k));
            if (!hasOtherPlayer) { skipped++; continue; }

            included++;

            // Compute per-team total damage for damage share
            const teamDmg = { 100: 0, 200: 0 };
            for (const p of parts) teamDmg[p.teamId] = (teamDmg[p.teamId] || 0) + (p.totalDamageDealtToChampions || 0);

            for (const p of parts) {
                const key = `${(p.riotIdGameName || '').toLowerCase()}|${(p.riotIdTagline || '').toLowerCase()}`;
                const display = lookup[key];
                if (!display) continue;

                const s = stats[display];
                s.games++;
                if (p.win) s.wins++;
                s.kills     += p.kills   || 0;
                s.deaths    += p.deaths  || 0;
                s.assists   += p.assists || 0;
                s.damage    += p.totalDamageDealtToChampions || 0;
                s.gold      += p.goldEarned || 0;
                s.cs        += (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
                s.vision    += p.visionScore || 0;
                s.gameDurationSec += match.info?.gameDuration || 0;
                s.teamDamage += teamDmg[p.teamId] || 0;
                s.doubles   += p.doubleKills || 0;
                s.triples   += p.tripleKills || 0;
                s.quadras   += p.quadraKills || 0;
                s.pentas    += p.pentaKills  || 0;
                if (p.firstBloodKill || p.firstBloodAssist) s.firstBloods++;
                s.turretKills        += p.turretKills        || 0;
                s.baronKills         += p.baronKills         || 0;
                s.dragonKills        += p.dragonKills        || 0;
                s.objectivesStolen   += p.objectivesStolen   || 0;
                if (qLabel === 'solo') s.soloGames++; else s.flexGames++;
            }
        }

        console.log(`✅  Included: ${included} matches (Toan + ≥1 listed player)`);
        console.log(`⏭️   Skipped:  ${skipped} matches (Toan solo or Toan absent)\n`);

        db.close();

        // ── Compute derived stats ────────────────────────────────────────────
        const results = PLAYERS.map(p => {
            const s = stats[p.display];
            if (s.games === 0) return { display: p.display, games: 0, note: 'No data found' };

            const durationMin = s.gameDurationSec / 60;
            const kda = s.deaths === 0
                ? (s.kills + s.assists).toFixed(2) + ':0'
                : ((s.kills + s.assists) / s.deaths).toFixed(2);
            const kdaNum = s.deaths === 0 ? (s.kills + s.assists) : (s.kills + s.assists) / s.deaths;

            return {
                display:      p.display,
                games:        s.games,
                soloGames:    s.soloGames,
                flexGames:    s.flexGames,
                winRate:      ((s.wins / s.games) * 100).toFixed(1),
                winRateNum:   (s.wins / s.games) * 100,
                kda:          kda,
                kdaNum:       kdaNum,
                avgKills:     (s.kills   / s.games).toFixed(1),
                avgDeaths:    (s.deaths  / s.games).toFixed(1),
                avgAssists:   (s.assists / s.games).toFixed(1),
                avgDmg:       Math.round(s.damage  / s.games),
                avgGold:      Math.round(s.gold    / s.games),
                avgCSmin:     (s.cs / (durationMin)).toFixed(2),
                avgCSminNum:  s.cs / durationMin,
                avgVision:    (s.vision  / s.games).toFixed(1),
                avgVisionNum: s.vision  / s.games,
                dmgShare:     ((s.damage / s.teamDamage) * 100).toFixed(1),
                dmgShareNum:  (s.damage / s.teamDamage) * 100,
                doubles:      s.doubles,
                triples:      s.triples,
                quadras:      s.quadras,
                pentas:       s.pentas,
                firstBloods:  s.firstBloods,
                turretKills:  s.turretKills,
                baronKills:   s.baronKills,
                dragonKills:  s.dragonKills,
                objectivesStolen: s.objectivesStolen,
            };
        });

        // ── Ranking helper ───────────────────────────────────────────────────
        // For each metric, assign rank 1–N (lower = better unless inverted)
        const activeResults = results.filter(r => r.games > 0);

        function rankBy(key, higherIsBetter = true) {
            const sorted = [...activeResults].sort((a, b) =>
                higherIsBetter ? b[key] - a[key] : a[key] - b[key]
            );
            const rankMap = {};
            sorted.forEach((r, i) => rankMap[r.display] = i + 1);
            return rankMap;
        }

        const ranks = {
            winRate:   rankBy('winRateNum'),
            kda:       rankBy('kdaNum'),
            avgDmg:    rankBy('avgDmg'),
            avgCSmin:  rankBy('avgCSminNum'),
            avgVision: rankBy('avgVisionNum'),
            dmgShare:  rankBy('dmgShareNum'),
            avgDeaths: rankBy('avgDeaths', false), // lower deaths = better rank
            avgGold:   rankBy('avgGold'),
        };

        const METRICS = ['winRate','kda','avgDmg','avgCSmin','avgVision','dmgShare','avgDeaths','avgGold'];

        // Overall score = avg rank across all metrics (lower = better)
        for (const r of activeResults) {
            const total = METRICS.reduce((sum, m) => sum + (ranks[m][r.display] || activeResults.length), 0);
            r.overallScore = total / METRICS.length;
        }
        activeResults.sort((a, b) => a.overallScore - b.overallScore);
        activeResults.forEach((r, i) => r.overallRank = i + 1);

        // ── Print Results ────────────────────────────────────────────────────
        const W = [5, 24, 7, 9, 7, 7, 7, 9, 9, 8, 9, 9];
        const headers = ['Rank','Player','Games','Win%','KDA','Kills','Deaths','Assists','Avg Dmg','CS/min','Vision','Dmg%'];

        console.log('═'.repeat(115));
        console.log(' OVERALL PLAYER RANKINGS — Solo/Duo Only (Queue 420)');
        console.log('═'.repeat(115));
        console.log(headers.map((h,i) => h.padEnd(W[i])).join(''));
        console.log('─'.repeat(115));

        activeResults.forEach(r => {
            const row = [
                `#${r.overallRank}`,
                r.display.substring(0,22),
                `${r.games} (${r.soloGames}S/${r.flexGames}F)`,
                `${r.winRate}%`,
                r.kda,
                r.avgKills,
                r.avgDeaths,
                r.avgAssists,
                r.avgDmg.toLocaleString(),
                r.avgCSmin,
                r.avgVision,
                `${r.dmgShare}%`,
            ];
            console.log(row.map((v,i) => String(v).padEnd(W[i])).join(''));
        });

        console.log('─'.repeat(115));

        // ── Individual metric rankings ───────────────────────────────────────
        const metricLabels = {
            winRate:   'Win Rate',
            kda:       'KDA',
            avgDmg:    'Avg Damage',
            avgCSmin:  'CS/min',
            avgVision: 'Vision Score',
            dmgShare:  'Damage Share',
            avgDeaths: 'Fewest Deaths',
            avgGold:   'Avg Gold',
        };

        console.log('\n📊  PER-METRIC RANKINGS:\n');
        for (const metric of METRICS) {
            const sorted = [...activeResults].sort((a,b) => a.overallRank - b.overallRank)
                .map(r => ({ name: r.display, rank: ranks[metric][r.display] }))
                .sort((a,b) => a.rank - b.rank);
            console.log(`  ${metricLabels[metric]}:`);
            sorted.forEach(r => {
                const bar = '█'.repeat(Math.max(1, activeResults.length + 1 - r.rank));
                console.log(`    #${r.rank} ${r.name}`);
            });
            console.log('');
        }

        // ── Multi-kill summary ───────────────────────────────────────────────
        console.log('🎯  HIGHLIGHT PLAYS (total across all ranked games):');
        console.log('─'.repeat(70));
        const mkSorted = [...activeResults].sort((a,b) =>
            (b.pentas*100 + b.quadras*10 + b.triples*3 + b.doubles) -
            (a.pentas*100 + a.quadras*10 + a.triples*3 + a.doubles)
        );
        console.log('Player'.padEnd(26) + 'Penta'.padEnd(8) + 'Quadra'.padEnd(8) + 'Triple'.padEnd(8) + 'Double'.padEnd(8) + 'FirstBloods');
        console.log('─'.repeat(70));
        mkSorted.forEach(r => {
            console.log(
                r.display.substring(0,24).padEnd(26) +
                String(r.pentas).padEnd(8) +
                String(r.quadras).padEnd(8) +
                String(r.triples).padEnd(8) +
                String(r.doubles).padEnd(8) +
                String(r.firstBloods)
            );
        });

        // ── No-data players ──────────────────────────────────────────────────
        const noData = results.filter(r => r.games === 0);
        if (noData.length) {
            console.log('\n⚠️   Players NOT found in database:');
            noData.forEach(r => console.log('   •', r.display));
        }

        // Save JSON
        const outPath = path.join(__dirname, 'player_rankings_output.json');
        fs.writeFileSync(outPath, JSON.stringify(activeResults, null, 2));
        console.log('\n✅  Full data saved to scripts/player_rankings_output.json');
    }
);
