/**
 * frequent_players.js
 * Scans all Solo/Duo (420) and Flex (440) matches in the DB and finds
 * players who appear most frequently alongside you.
 */

const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');

// ── Config: locate user config ──────────────────────────────────────────────
const configPath = path.join(process.env.APPDATA, 'nexus-insights', 'config.json');
if (!fs.existsSync(configPath)) {
    console.error('❌  Could not find config at:', configPath);
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const MY_PUUID = config.puuid || null;

// ── SQLite ───────────────────────────────────────────────────────────────────
const sqlite3 = require('sqlite3').verbose();
const DB_PATH = path.join(__dirname, '..', 'nexus_data.sqlite');
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => {
    if (err) { console.error('❌  DB open error:', err.message); process.exit(1); }
});

// ── Decompress helper ────────────────────────────────────────────────────────
function decompressJson(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return JSON.parse(blob);
    try {
        return JSON.parse(zlib.gunzipSync(blob).toString('utf8'));
    } catch {
        return null;
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('🔍  Scanning Solo/Duo (420) and Flex (440) matches…\n');

const RANKED_QUEUES = [420, 440];
const placeholders  = RANKED_QUEUES.map(() => '?').join(',');
const sql = `SELECT matchId, queueId, rawJson FROM matches WHERE queueId IN (${placeholders})`;

const playerCount = {};   // puuid → { gameName, tagLine, count, wins, losses }
let myPuuid = MY_PUUID;
let totalMatches = 0;

db.all(sql, RANKED_QUEUES, (err, rows) => {
    if (err) { console.error('❌  Query error:', err.message); process.exit(1); }

    totalMatches = rows.length;
    console.log(`📦  Found ${totalMatches} ranked matches to process…`);

    for (const row of rows) {
        const match = decompressJson(row.rawJson);
        if (!match) continue;

        const participants = match.info?.participants ?? [];

        // Auto-detect the user's PUUID on first match if not stored in config
        if (!myPuuid && participants.length > 0) {
            // We can't auto-detect without extra info, skip
        }

        for (const p of participants) {
            if (!p.puuid) continue;
            if (myPuuid && p.puuid === myPuuid) continue; // skip self

            const key = p.puuid;
            if (!playerCount[key]) {
                playerCount[key] = {
                    gameName: p.riotIdGameName || p.summonerName || 'Unknown',
                    tagLine:  p.riotIdTagline  || '',
                    count:    0,
                    wins:     0,
                    losses:   0,
                    soloCount: 0,
                    flexCount: 0,
                };
            }
            playerCount[key].count++;
            if (p.win) playerCount[key].wins++;
            else        playerCount[key].losses++;
            if (row.queueId === 420) playerCount[key].soloCount++;
            if (row.queueId === 440) playerCount[key].flexCount++;
        }
    }

    db.close();

    // Sort by frequency descending
    const sorted = Object.entries(playerCount)
        .map(([puuid, d]) => ({ puuid, ...d }))
        .sort((a, b) => b.count - a.count);

    // Filter: only players seen more than once (to skip one-off encounters)
    const frequent = sorted.filter(p => p.count >= 2);

    console.log(`\n✅  Processed ${totalMatches} matches.`);
    console.log(`👥  Found ${frequent.length} players appearing 2+ times.\n`);
    console.log('═'.repeat(75));
    console.log(
        'Rank'.padEnd(6) +
        'Player'.padEnd(30) +
        'Games'.padEnd(8) +
        'W/L'.padEnd(10) +
        'Solo'.padEnd(8) +
        'Flex'
    );
    console.log('─'.repeat(75));

    frequent.slice(0, 50).forEach((p, i) => {
        const name    = `${p.gameName}#${p.tagLine}`.substring(0, 28);
        const wl      = `${p.wins}W / ${p.losses}L`;
        console.log(
            `#${(i + 1)}`.padEnd(6) +
            name.padEnd(30) +
            String(p.count).padEnd(8) +
            wl.padEnd(10) +
            String(p.soloCount).padEnd(8) +
            String(p.flexCount)
        );
    });

    console.log('─'.repeat(75));
    console.log('\n📝  Results saved to: frequent_players_output.json');

    // Save full results to JSON
    const outPath = path.join(__dirname, 'frequent_players_output.json');
    fs.writeFileSync(outPath, JSON.stringify(frequent, null, 2));
});
