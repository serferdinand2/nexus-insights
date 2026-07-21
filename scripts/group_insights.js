/**
 * group_insights.js
 * Deep-dive analytics on the friend group across all shared ranked games.
 */

const sqlite3 = require('sqlite3').verbose();
const zlib    = require('zlib');
const path    = require('path');
const fs      = require('fs');

const DB_PATH = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');

const PLAYERS = [
    { display: 'Toan#GGWP',             aliases: [['Toan',           'GGWP'  ]] },
    { display: 'Catto go purrrr#EUW',    aliases: [['Catto go purrrr','EUW'   ]] },
    { display: 'Lazar Milin#1337',       aliases: [['Lazar Milin',    '1337'  ]] },
    { display: 'chipotles#EUW',          aliases: [['chipotles',      'EUW'   ], ['ElsaMid','EUW']] },
    { display: 'NIKOLa23#EUW',           aliases: [['NIKOLa23',       'EUW'   ]] },
    { display: 'nikolath#EUNE',          aliases: [['nikolath',       'EUNE'  ]] },
    { display: 'JonesAlex123#EUW',       aliases: [['JonesAlex123',   'EUW'   ]] },
    { display: 'Aleksa Milin#1337',      aliases: [['Aleksa Milin',   '1337'  ]] },
    { display: 'Splachina#YUG',          aliases: [['Splachina',      'YUG'   ]] },
    { display: 'Potpar109#vp109',        aliases: [['Potpar109',      'vp109' ]] },
    { display: 'Uriziel II#2b3a',        aliases: [['Uriziel II',     '2b3a'  ]] },
    { display: 'Soki Balboa#EUW',        aliases: [['Soki Balboa',    'EUW'   ]] },
    { display: 'Bogdan Car#1337',        aliases: [['Bogdan Car',     '1337'  ]] },
];

const lookup = {};
for (const p of PLAYERS) {
    for (const [name, tag] of p.aliases) {
        lookup[`${name.toLowerCase()}|${tag.toLowerCase()}`] = p.display;
    }
}

const TOAN_KEY   = 'toan|ggwp';
const OTHER_KEYS = new Set(Object.keys(lookup).filter(k => k !== TOAN_KEY));

function decompress(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return JSON.parse(blob);
    try { return JSON.parse(zlib.gunzipSync(blob).toString('utf8')); }
    catch { return null; }
}

// Per-player accumulators
const acc = {};
for (const p of PLAYERS) {
    acc[p.display] = {
        games: 0, wins: 0,
        kills: 0, deaths: 0, assists: 0,
        damage: 0, gold: 0, cs: 0, vision: 0,
        durationSec: 0, teamDamage: 0,
        roles:     {},   // role -> count
        champions: {},   // champion -> { games, wins }
        kdaPerGame: [],  // per-game KDA for consistency
        winStreak: 0, lossStreak: 0, curStreak: 0, curStreakType: null,
        monthStats: {},  // 'YYYY-MM' -> { games, wins }
        // performance in wins vs losses
        winKills: 0, winDeaths: 0, winAssists: 0, winDmg: 0, winGames: 0,
        lossKills: 0, lossDeaths: 0, lossAssists: 0, lossDmg: 0, lossGames: 0,
    };
}

// Synergy: pair -> { games, wins }
const synergy = {};
function pairKey(a, b) { return [a,b].sort().join(' ⟷ '); }

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => {
    if (err) { console.error('DB:', err.message); process.exit(1); }
});

console.log('⚙️   Loading matches from real DB…\n');

db.all('SELECT matchId, queueId, gameCreation, rawJson FROM matches WHERE queueId = 420 ORDER BY gameCreation ASC', (err, rows) => {
    if (err) { console.error(err); process.exit(1); }

    let included = 0;

    for (const row of rows) {
        const match = decompress(row.rawJson);
        if (!match) continue;

        const parts = match.info?.participants ?? [];
        const presentKeys = new Set(parts.map(p =>
            `${(p.riotIdGameName||'').toLowerCase()}|${(p.riotIdTagline||'').toLowerCase()}`
        ));

        if (!presentKeys.has(TOAN_KEY)) continue;
        const others = [...OTHER_KEYS].filter(k => presentKeys.has(k));
        if (others.length === 0) continue;

        included++;
        const duration = match.info?.gameDuration || 0;
        const month = new Date(row.gameCreation).toISOString().slice(0, 7);

        // Per-team damage totals
        const teamDmg = {};
        for (const p of parts) teamDmg[p.teamId] = (teamDmg[p.teamId]||0) + (p.totalDamageDealtToChampions||0);

        // Collect which listed players are in this match (for synergy)
        const presentDisplays = [];

        for (const p of parts) {
            const key = `${(p.riotIdGameName||'').toLowerCase()}|${(p.riotIdTagline||'').toLowerCase()}`;
            const display = lookup[key];
            if (!display) continue;

            const s = acc[display];
            s.games++;
            const won = !!p.win;
            if (won) s.wins++;

            s.kills   += p.kills   || 0;
            s.deaths  += p.deaths  || 0;
            s.assists += p.assists || 0;
            s.damage  += p.totalDamageDealtToChampions || 0;
            s.gold    += p.goldEarned || 0;
            s.cs      += (p.totalMinionsKilled||0) + (p.neutralMinionsKilled||0);
            s.vision  += p.visionScore || 0;
            s.durationSec += duration;
            s.teamDamage  += teamDmg[p.teamId] || 0;

            // Role
            const role = p.teamPosition || p.lane || 'UNKNOWN';
            s.roles[role] = (s.roles[role]||0) + 1;

            // Champion
            const champ = p.championName || 'Unknown';
            if (!s.champions[champ]) s.champions[champ] = { games: 0, wins: 0 };
            s.champions[champ].games++;
            if (won) s.champions[champ].wins++;

            // Per-game KDA
            const kda = p.deaths === 0 ? (p.kills + p.assists) : (p.kills + p.assists) / p.deaths;
            s.kdaPerGame.push(kda);

            // Month stats
            if (!s.monthStats[month]) s.monthStats[month] = { games: 0, wins: 0 };
            s.monthStats[month].games++;
            if (won) s.monthStats[month].wins++;

            // Win/loss splits
            if (won) {
                s.winGames++;
                s.winKills   += p.kills   || 0;
                s.winDeaths  += p.deaths  || 0;
                s.winAssists += p.assists || 0;
                s.winDmg     += p.totalDamageDealtToChampions || 0;
            } else {
                s.lossGames++;
                s.lossKills   += p.kills   || 0;
                s.lossDeaths  += p.deaths  || 0;
                s.lossAssists += p.assists || 0;
                s.lossDmg     += p.totalDamageDealtToChampions || 0;
            }

            presentDisplays.push({ display, win: won });
        }

        // Synergy pairs
        for (let i = 0; i < presentDisplays.length; i++) {
            for (let j = i + 1; j < presentDisplays.length; j++) {
                const a = presentDisplays[i];
                const b = presentDisplays[j];
                // Only count if both on same team
                // (We don't have teamId here easily, but since we're measuring
                //  shared premade, same win/loss is a good proxy for same team)
                if (a.win !== b.win) continue; // different teams
                const key = pairKey(a.display, b.display);
                if (!synergy[key]) synergy[key] = { games: 0, wins: 0 };
                synergy[key].games++;
                if (a.win) synergy[key].wins++;
            }
        }
    }

    db.close();

    // ── Compute stddev for consistency ──────────────────────────────────────
    function stddev(arr) {
        if (arr.length < 2) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
        return Math.sqrt(variance);
    }

    // ── Build result rows ────────────────────────────────────────────────────
    const results = PLAYERS.map(p => {
        const s = acc[p.display];
        if (s.games === 0) return null;

        const durMin = s.durationSec / 60;
        const kda    = s.deaths === 0 ? s.kills + s.assists : (s.kills + s.assists) / s.deaths;

        // Top 3 champions
        const topChamps = Object.entries(s.champions)
            .sort((a,b) => b[1].games - a[1].games)
            .slice(0, 3)
            .map(([name, d]) => `${name} (${d.games}g ${Math.round(d.wins/d.games*100)}%wr)`);

        // Primary role
        const primaryRole = Object.entries(s.roles).sort((a,b) => b[1]-a[1])[0]?.[0] || '?';

        // Consistency (lower stddev = more consistent)
        const consistency = stddev(s.kdaPerGame);

        // Month trend: last 3 months win rate vs first 3 months
        const months = Object.entries(s.monthStats).sort(([a],[b]) => a.localeCompare(b));
        const earlyWr = months.slice(0, 3).reduce((acc, [,d]) => { acc.g += d.games; acc.w += d.wins; return acc; }, {g:0,w:0});
        const lateWr  = months.slice(-3).reduce((acc, [,d]) => { acc.g += d.games; acc.w += d.wins; return acc; }, {g:0,w:0});
        const trend = earlyWr.g && lateWr.g
            ? (lateWr.w/lateWr.g*100 - earlyWr.w/earlyWr.g*100).toFixed(1)
            : 'N/A';

        // Win vs loss KDA
        const winKDA  = s.winGames  ? ((s.winKills  + s.winAssists)  / Math.max(s.winDeaths,  1)).toFixed(2) : 'N/A';
        const lossKDA = s.lossGames ? ((s.lossKills + s.lossAssists) / Math.max(s.lossDeaths, 1)).toFixed(2) : 'N/A';
        const winDmg  = s.winGames  ? Math.round(s.winDmg  / s.winGames)  : 0;
        const lossDmg = s.lossGames ? Math.round(s.lossDmg / s.lossGames) : 0;
        const dmgDiff = winDmg - lossDmg;

        return {
            display:      p.display,
            games:        s.games,
            winRate:      (s.wins / s.games * 100).toFixed(1),
            kda:          kda.toFixed(2),
            primaryRole,
            topChamps,
            consistency:  consistency.toFixed(2),
            trend:        trend > 0 ? '+' + trend : trend,
            winKDA, lossKDA,
            winDmg, lossDmg, dmgDiff,
            avgVision:    (s.vision / s.games).toFixed(1),
            avgCSmin:     (s.cs / durMin).toFixed(2),
            avgDmg:       Math.round(s.damage / s.games),
            dmgShare:     (s.damage / s.teamDamage * 100).toFixed(1),
        };
    }).filter(Boolean);

    // ── PRINT ─────────────────────────────────────────────────────────────────

    console.log('═'.repeat(100));
    console.log(' GROUP INSIGHTS — ' + included + ' shared ranked matches');
    console.log('═'.repeat(100));

    // 1. ROLES
    console.log('\n🎭  PRIMARY ROLES:\n');
    const roleMap = { TOP: '🛡️  Top', JUNGLE: '🌿 Jungle', MIDDLE: '⚔️  Mid', BOTTOM: '🏹 Bot/ADC', UTILITY: '💎 Support', UNKNOWN: '❓ Unknown' };
    results.forEach(r => {
        const s = acc[PLAYERS.find(p => p.display === r.display).display];
        const rolesSorted = Object.entries(s.roles).sort((a,b) => b[1]-a[1]);
        const rolePcts = rolesSorted.slice(0,3).map(([role, cnt]) =>
            `${roleMap[role] || role} ${Math.round(cnt/r.games*100)}%`
        ).join('  |  ');
        console.log(`  ${r.display.padEnd(24)} ${rolePcts}`);
    });

    // 2. TOP CHAMPION POOLS
    console.log('\n\n🏆  TOP CHAMPION POOLS:\n');
    results.forEach(r => {
        console.log(`  ${r.display.padEnd(24)} ${r.topChamps.join('   ')}`);
    });

    // 3. CONSISTENCY
    console.log('\n\n📐  CONSISTENCY (KDA std-dev — lower = more consistent):\n');
    const byConsistency = [...results].sort((a,b) => parseFloat(a.consistency) - parseFloat(b.consistency));
    byConsistency.forEach((r, i) => {
        const bar = '█'.repeat(Math.max(1, Math.round(10 - parseFloat(r.consistency) * 1.5)));
        console.log(`  #${(i+1)+''.padEnd(2)} ${r.display.padEnd(24)} σ=${r.consistency.padEnd(6)} ${bar}`);
    });

    // 4. WIN/LOSS PERFORMANCE SPLIT
    console.log('\n\n⚖️   KDA IN WINS vs LOSSES:\n');
    console.log('  ' + 'Player'.padEnd(26) + 'Win KDA'.padEnd(12) + 'Loss KDA'.padEnd(12) + 'Dmg in Win'.padEnd(14) + 'Dmg in Loss'.padEnd(14) + 'Diff');
    console.log('  ' + '─'.repeat(80));
    results.forEach(r => {
        const diff = r.dmgDiff >= 0 ? '+' + r.dmgDiff.toLocaleString() : r.dmgDiff.toLocaleString();
        console.log('  ' +
            r.display.padEnd(26) +
            r.winKDA.padEnd(12) +
            r.lossKDA.padEnd(12) +
            r.winDmg.toLocaleString().padEnd(14) +
            r.lossDmg.toLocaleString().padEnd(14) +
            diff
        );
    });

    // 5. WIN RATE TREND
    console.log('\n\n📈  WIN RATE TREND (recent 3 months vs earliest 3 months):\n');
    const byTrend = [...results].filter(r => r.trend !== 'N/A').sort((a,b) => parseFloat(b.trend) - parseFloat(a.trend));
    byTrend.forEach(r => {
        const t = parseFloat(r.trend);
        const arrow = t > 2 ? '↑↑' : t > 0 ? '↑' : t < -2 ? '↓↓' : '↓';
        const indicator = t > 0 ? '🟢' : t < 0 ? '🔴' : '⚪';
        console.log(`  ${indicator} ${r.display.padEnd(26)} ${r.trend}%  ${arrow}  (${r.games} games)`);
    });

    // 6. BEST SYNERGY PAIRS (min 5 shared games)
    console.log('\n\n🤝  BEST DUO SYNERGY (pairs with ≥5 games on same team):\n');
    const synergyList = Object.entries(synergy)
        .filter(([,d]) => d.games >= 5)
        .map(([pair, d]) => ({ pair, games: d.games, wr: (d.wins/d.games*100).toFixed(1) }))
        .sort((a,b) => parseFloat(b.wr) - parseFloat(a.wr));

    console.log('  ' + 'Pair'.padEnd(52) + 'Games'.padEnd(8) + 'Win%');
    console.log('  ' + '─'.repeat(70));
    synergyList.slice(0, 15).forEach(s => {
        const wr = parseFloat(s.wr);
        const bar = '█'.repeat(Math.round(wr / 10));
        console.log('  ' + s.pair.padEnd(52) + String(s.games).padEnd(8) + s.wr + '% ' + bar);
    });

    // 7. VISION IMPACT
    console.log('\n\n👁️   VISION LEADERS:\n');
    const byVision = [...results].sort((a,b) => parseFloat(b.avgVision) - parseFloat(a.avgVision));
    byVision.forEach((r, i) => {
        const bar = '█'.repeat(Math.round(parseFloat(r.avgVision) / 5));
        console.log(`  #${(i+1)+''.padEnd(2)} ${r.display.padEnd(26)} ${r.avgVision.padEnd(8)} ${bar}`);
    });

    // 8. WHO HARD-CARRIES (damage share in wins)
    console.log('\n\n💥  DAMAGE SHARE (avg % of team damage dealt):\n');
    const byDmgShare = [...results].sort((a,b) => parseFloat(b.dmgShare) - parseFloat(a.dmgShare));
    byDmgShare.forEach((r, i) => {
        const share = parseFloat(r.dmgShare);
        const bar = '█'.repeat(Math.round(share / 2));
        console.log(`  #${(i+1)+''.padEnd(2)} ${r.display.padEnd(26)} ${r.dmgShare.padEnd(8)}% ${bar}`);
    });

    // Save JSON
    const out = { results, synergy: synergyList };
    fs.writeFileSync(path.join(__dirname, 'group_insights_output.json'), JSON.stringify(out, null, 2));
    console.log('\n✅  Full data saved to scripts/group_insights_output.json\n');
});
