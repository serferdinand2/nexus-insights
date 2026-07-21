/**
 * my_stats.js
 * Deep personal analytics for Toan#GGWP — Solo/Duo (queue 420) only.
 * Uses the matches table directly (no rawJson decompression needed for most stats).
 */

const sqlite3 = require('sqlite3').verbose();
const zlib    = require('zlib');
const path    = require('path');
const fs      = require('fs');

const DB_PATH = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');

function decompress(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return JSON.parse(blob);
    try { return JSON.parse(zlib.gunzipSync(blob).toString('utf8')); }
    catch { return null; }
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => {
    if (err) { console.error('DB:', err.message); process.exit(1); }
});

const Q = (sql, params = []) => new Promise((res, rej) =>
    db.all(sql, params, (e, rows) => e ? rej(e) : res(rows))
);
const Q1 = (sql, params = []) => new Promise((res, rej) =>
    db.get(sql, params, (e, row) => e ? rej(e) : res(row))
);

async function run() {
    // Jan 1 2026 00:00:00 UTC in milliseconds
    const SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();
    const BASE = `FROM matches WHERE queueId = 420 AND gameCreation >= ${SEASON_START}`;

    // ── 1. OVERALL SUMMARY ────────────────────────────────────────────────────
    const overall = await Q1(`
        SELECT
            COUNT(*) as games,
            SUM(win) as wins,
            AVG(kills) as avgK,
            AVG(deaths) as avgD,
            AVG(assists) as avgA,
            SUM(kills) as totalK,
            SUM(deaths) as totalD,
            SUM(assists) as totalA,
            AVG(totalDamageDealtToChampions) as avgDmg,
            AVG(goldEarned) as avgGold,
            AVG(totalMinionsKilled) as avgCS,
            AVG(visionScore) as avgVision,
            AVG(gameDuration)/60.0 as avgGameMin,
            SUM(pentaKills) as pentas,
            SUM(quadraKills) as quadras,
            SUM(tripleKills) as triples,
            SUM(doubleKills) as doubles,
            SUM(firstBlood) as firstBloods,
            AVG(wardsPlaced) as avgWardsPlaced,
            AVG(wardsKilled) as avgWardsKilled,
            AVG(detectorWardsPlaced) as avgControlWards,
            SUM(turretKills) as turretKills,
            SUM(baronKills) as baronKills,
            SUM(dragonKills) as dragonKills,
            SUM(objectivesStolen) as objStolen,
            AVG(CAST(totalMinionsKilled AS FLOAT) / (gameDuration/60.0)) as csPerMin,
            MIN(gameCreation) as firstGame,
            MAX(gameCreation) as lastGame
        ${BASE}
    `);

    const kda = overall.totalD === 0
        ? (overall.totalK + overall.totalA).toFixed(2)
        : ((overall.totalK + overall.totalA) / overall.totalD).toFixed(2);
    const wr = (overall.wins / overall.games * 100).toFixed(1);

    console.log('\n' + '═'.repeat(70));
    console.log(' TOAN#GGWP — SOLO/DUO PERSONAL STATS');
    console.log('═'.repeat(70));
    console.log(`  Period:    ${new Date(overall.firstGame).toISOString().slice(0,10)} → ${new Date(overall.lastGame).toISOString().slice(0,10)}`);
    console.log(`  Games:     ${overall.games}   (${overall.wins}W / ${overall.games - overall.wins}L)`);
    console.log(`  Win Rate:  ${wr}%`);
    console.log(`  KDA:       ${kda}  (${overall.avgK.toFixed(1)} / ${overall.avgD.toFixed(1)} / ${overall.avgA.toFixed(1)})`);
    console.log(`  Avg Dmg:   ${Math.round(overall.avgDmg).toLocaleString()}`);
    console.log(`  Avg Gold:  ${Math.round(overall.avgGold).toLocaleString()}`);
    console.log(`  CS/min:    ${overall.csPerMin.toFixed(2)}`);
    console.log(`  Vision:    ${overall.avgVision.toFixed(1)}`);
    console.log(`  Avg Game:  ${overall.avgGameMin.toFixed(1)} min`);
    console.log(`  Wards:     ${overall.avgWardsPlaced.toFixed(1)} placed / ${overall.avgWardsKilled.toFixed(1)} cleared / ${overall.avgControlWards.toFixed(1)} control`);

    // ── 2. CHAMPION BREAKDOWN ─────────────────────────────────────────────────
    const champs = await Q(`
        SELECT
            championName,
            COUNT(*) as games,
            SUM(win) as wins,
            AVG(kills) as avgK,
            AVG(deaths) as avgD,
            AVG(assists) as avgA,
            AVG(totalDamageDealtToChampions) as avgDmg,
            AVG(CAST(totalMinionsKilled AS FLOAT) / (gameDuration/60.0)) as csMin,
            SUM(pentaKills) as pentas,
            SUM(quadraKills) as quadras,
            SUM(tripleKills) as triples,
            SUM(doubleKills) as doubles,
            AVG(visionScore) as avgVision
        ${BASE}
        GROUP BY championName
        ORDER BY games DESC
    `);

    console.log('\n' + '─'.repeat(70));
    console.log(' CHAMPION BREAKDOWN (≥2 games)');
    console.log('─'.repeat(70));
    console.log(
        'Champion'.padEnd(18) +
        'G'.padEnd(5) +
        'WR%'.padEnd(8) +
        'KDA'.padEnd(8) +
        'K'.padEnd(5) +
        'D'.padEnd(5) +
        'A'.padEnd(5) +
        'Dmg'.padEnd(10) +
        'CS/m'.padEnd(7) +
        'Multi-kills'
    );
    console.log('─'.repeat(70));

    for (const c of champs.filter(c => c.games >= 2)) {
        const cKda = c.avgD === 0
            ? (c.avgK + c.avgA).toFixed(2)
            : ((c.avgK + c.avgA) / c.avgD).toFixed(2);
        const cWr  = (c.wins / c.games * 100).toFixed(0);
        const multi = [
            c.pentas  ? `${c.pentas}x Penta`  : '',
            c.quadras ? `${c.quadras}x Quadra` : '',
            c.triples ? `${c.triples}x Triple` : '',
            c.doubles ? `${c.doubles}x Double` : '',
        ].filter(Boolean).join(', ') || '-';

        console.log(
            c.championName.padEnd(18) +
            String(c.games).padEnd(5) +
            (cWr + '%').padEnd(8) +
            cKda.padEnd(8) +
            c.avgK.toFixed(1).padEnd(5) +
            c.avgD.toFixed(1).padEnd(5) +
            c.avgA.toFixed(1).padEnd(5) +
            Math.round(c.avgDmg).toLocaleString().padEnd(10) +
            c.csMin.toFixed(2).padEnd(7) +
            multi
        );
    }

    // ── 3. ROLE / POSITION BREAKDOWN ──────────────────────────────────────────
    const roles = await Q(`
        SELECT
            teamPosition,
            COUNT(*) as games,
            SUM(win) as wins,
            AVG(kills) as avgK, AVG(deaths) as avgD, AVG(assists) as avgA,
            AVG(totalDamageDealtToChampions) as avgDmg,
            AVG(CAST(totalMinionsKilled AS FLOAT) / (gameDuration/60.0)) as csMin
        ${BASE}
        GROUP BY teamPosition ORDER BY games DESC
    `);

    const roleLabel = { TOP:'Top', JUNGLE:'Jungle', MIDDLE:'Mid', BOTTOM:'ADC', UTILITY:'Support', '':'Unknown' };
    console.log('\n' + '─'.repeat(70));
    console.log(' ROLE BREAKDOWN');
    console.log('─'.repeat(70));
    for (const r of roles) {
        const rKda = r.avgD === 0 ? (r.avgK + r.avgA).toFixed(2) : ((r.avgK + r.avgA) / r.avgD).toFixed(2);
        const rWr  = (r.wins / r.games * 100).toFixed(1);
        const label = roleLabel[r.teamPosition] || r.teamPosition || 'Unknown';
        console.log(`  ${label.padEnd(10)} ${String(r.games).padEnd(5)}g  WR=${rWr}%  KDA=${rKda}  Dmg=${Math.round(r.avgDmg).toLocaleString()}  CS/m=${r.csMin.toFixed(2)}`);
    }

    // ── 4. MONTHLY TREND ──────────────────────────────────────────────────────
    const monthly = await Q(`
        SELECT
            strftime('%Y-%m', datetime(gameCreation/1000, 'unixepoch')) as month,
            COUNT(*) as games,
            SUM(win) as wins,
            AVG(kills) as avgK, AVG(deaths) as avgD, AVG(assists) as avgA,
            AVG(totalDamageDealtToChampions) as avgDmg,
            AVG(CAST(totalMinionsKilled AS FLOAT) / (gameDuration/60.0)) as csMin
        ${BASE}
        GROUP BY month ORDER BY month ASC
    `);

    console.log('\n' + '─'.repeat(70));
    console.log(' MONTHLY PERFORMANCE');
    console.log('─'.repeat(70));
    console.log('  Month     Games  WR%     KDA    Dmg      CS/m  Bar');
    for (const m of monthly) {
        const mWr  = (m.wins / m.games * 100).toFixed(1);
        const mKda = m.avgD === 0 ? (m.avgK + m.avgA).toFixed(2) : ((m.avgK + m.avgA) / m.avgD).toFixed(2);
        const bar  = (parseFloat(mWr) >= 50 ? '🟢' : '🔴').repeat(Math.ceil(m.games / 5));
        console.log(`  ${m.month}  ${String(m.games).padEnd(7)}${(mWr+'%').padEnd(8)}${mKda.padEnd(7)}${Math.round(m.avgDmg).toLocaleString().padEnd(9)}${m.csMin.toFixed(2).padEnd(6)}${bar}`);
    }

    // ── 5. ADVANCED STATS ─────────────────────────────────────────────────────
    const adv = await Q1(`
        SELECT
            AVG(csDiff15) as avgCSD15,
            AVG(goldDiff15) as avgGD15,
            AVG(xpDiff15) as avgXPD15,
            AVG(dmgGoldRatio) as avgDmgGold,
            AVG(isolatedDeaths) as avgIsolated,
            AVG(objectiveRate) as avgObjRate,
            SUM(firstBlood) as firstBloods,
            COUNT(CASE WHEN csDiff15 IS NOT NULL THEN 1 END) as advCount
        ${BASE}
    `);

    console.log('\n' + '─'.repeat(70));
    console.log(` ADVANCED STATS (from ${adv.advCount} matches with timeline data)`);
    console.log('─'.repeat(70));
    console.log(`  CSD@15:          ${adv.avgCSD15 != null ? adv.avgCSD15.toFixed(1) : 'N/A'}  (CS diff vs lane opponent at 15 min)`);
    console.log(`  GD@15:           ${adv.avgGD15  != null ? adv.avgGD15.toFixed(0)  : 'N/A'}  (Gold diff at 15 min)`);
    console.log(`  XPD@15:          ${adv.avgXPD15 != null ? adv.avgXPD15.toFixed(0) : 'N/A'}  (XP diff at 15 min)`);
    console.log(`  Dmg/Gold Ratio:  ${adv.avgDmgGold != null ? adv.avgDmgGold.toFixed(3) : 'N/A'}  (damage efficiency per gold)`);
    console.log(`  Isolated Deaths: ${adv.avgIsolated != null ? adv.avgIsolated.toFixed(2) : 'N/A'} avg/game  (deaths without nearby teammates)`);
    console.log(`  Objective Rate:  ${adv.avgObjRate != null ? adv.avgObjRate.toFixed(1) + '%' : 'N/A'}  (% of objectives secured while alive)`);
    console.log(`  First Bloods:    ${adv.firstBloods} total  (${(adv.firstBloods/overall.games*100).toFixed(1)}% of games)`);

    // ── 6. WIN vs LOSS SPLITS ─────────────────────────────────────────────────
    const [wins, losses] = await Promise.all([
        Q1(`SELECT AVG(kills) as k, AVG(deaths) as d, AVG(assists) as a,
                   AVG(totalDamageDealtToChampions) as dmg,
                   AVG(CAST(totalMinionsKilled AS FLOAT)/(gameDuration/60.0)) as cs,
                   AVG(visionScore) as vis, AVG(goldEarned) as gold
            ${BASE} AND win = 1`),
        Q1(`SELECT AVG(kills) as k, AVG(deaths) as d, AVG(assists) as a,
                   AVG(totalDamageDealtToChampions) as dmg,
                   AVG(CAST(totalMinionsKilled AS FLOAT)/(gameDuration/60.0)) as cs,
                   AVG(visionScore) as vis, AVG(goldEarned) as gold
            ${BASE} AND win = 0`),
    ]);

    console.log('\n' + '─'.repeat(70));
    console.log(' PERFORMANCE: WINS vs LOSSES');
    console.log('─'.repeat(70));
    const wKda = wins.d  === 0 ? (wins.k  + wins.a).toFixed(2)  : ((wins.k  + wins.a)  / wins.d).toFixed(2);
    const lKda = losses.d === 0 ? (losses.k + losses.a).toFixed(2) : ((losses.k + losses.a) / losses.d).toFixed(2);
    console.log('  ' + 'Stat'.padEnd(16) + 'Wins'.padEnd(14) + 'Losses'.padEnd(14) + 'Diff');
    console.log('  ' + '─'.repeat(56));
    const rows2 = [
        ['KDA',     wKda,                         lKda,                          (parseFloat(wKda)-parseFloat(lKda)).toFixed(2)],
        ['Kills',   wins.k.toFixed(1),            losses.k.toFixed(1),           (wins.k-losses.k).toFixed(1)],
        ['Deaths',  wins.d.toFixed(1),            losses.d.toFixed(1),           (wins.d-losses.d).toFixed(1)],
        ['Assists', wins.a.toFixed(1),            losses.a.toFixed(1),           (wins.a-losses.a).toFixed(1)],
        ['Dmg',     Math.round(wins.dmg).toLocaleString(), Math.round(losses.dmg).toLocaleString(), '+'+Math.round(wins.dmg-losses.dmg).toLocaleString()],
        ['Gold',    Math.round(wins.gold).toLocaleString(), Math.round(losses.gold).toLocaleString(), '+'+Math.round(wins.gold-losses.gold).toLocaleString()],
        ['CS/min',  wins.cs.toFixed(2),           losses.cs.toFixed(2),          (wins.cs-losses.cs).toFixed(2)],
        ['Vision',  wins.vis.toFixed(1),          losses.vis.toFixed(1),         (wins.vis-losses.vis).toFixed(1)],
    ];
    for (const [stat, w, l, diff] of rows2) {
        console.log('  ' + stat.padEnd(16) + String(w).padEnd(14) + String(l).padEnd(14) + diff);
    }

    // ── 7. LONGEST STREAKS ────────────────────────────────────────────────────
    const allGames = await Q(`SELECT win, gameCreation FROM matches WHERE queueId = 420 ORDER BY gameCreation ASC`);
    let curW = 0, curL = 0, maxW = 0, maxL = 0;
    for (const g of allGames) {
        if (g.win) { curW++; curL = 0; maxW = Math.max(maxW, curW); }
        else        { curL++; curW = 0; maxL = Math.max(maxL, curL); }
    }
    // Current streak
    let curStreak = 0, curType = '';
    for (let i = allGames.length - 1; i >= 0; i--) {
        const type = allGames[i].win ? 'W' : 'L';
        if (i === allGames.length - 1) { curType = type; curStreak = 1; }
        else if (type === curType) curStreak++;
        else break;
    }

    console.log('\n' + '─'.repeat(70));
    console.log(' STREAKS');
    console.log('─'.repeat(70));
    console.log(`  Longest Win Streak:   ${maxW} games`);
    console.log(`  Longest Loss Streak:  ${maxL} games`);
    console.log(`  Current Streak:       ${curStreak}${curType} (${curType === 'W' ? '🟢' : '🔴'})`);

    // ── 8. BEST & WORST CHAMPIONS (min 3 games) ───────────────────────────────
    const qualified = champs.filter(c => c.games >= 3);
    const bestWR    = [...qualified].sort((a,b) => (b.wins/b.games) - (a.wins/a.games));
    const worstWR   = [...qualified].sort((a,b) => (a.wins/a.games) - (b.wins/b.games));
    const bestKDA   = [...qualified].sort((a,b) => {
        const ka = a.avgD === 0 ? a.avgK+a.avgA : (a.avgK+a.avgA)/a.avgD;
        const kb = b.avgD === 0 ? b.avgK+b.avgA : (b.avgK+b.avgA)/b.avgD;
        return kb - ka;
    });

    console.log('\n' + '─'.repeat(70));
    console.log(' BEST & WORST CHAMPIONS (min 3 games)');
    console.log('─'.repeat(70));
    console.log('  🟢 Best Win Rate:');
    bestWR.slice(0,3).forEach((c,i) => console.log(`      #${i+1} ${c.championName} — ${(c.wins/c.games*100).toFixed(0)}%WR in ${c.games}g`));
    console.log('  🔴 Worst Win Rate:');
    worstWR.slice(0,3).forEach((c,i) => console.log(`      #${i+1} ${c.championName} — ${(c.wins/c.games*100).toFixed(0)}%WR in ${c.games}g`));
    console.log('  ⚔️  Best KDA:');
    bestKDA.slice(0,3).forEach((c,i) => {
        const k = c.avgD === 0 ? (c.avgK+c.avgA).toFixed(2) : ((c.avgK+c.avgA)/c.avgD).toFixed(2);
        console.log(`      #${i+1} ${c.championName} — ${k} KDA in ${c.games}g`);
    });

    // ── 9. OBJECTIVE SUMMARY ──────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log(' OBJECTIVE & MACRO STATS (totals)');
    console.log('─'.repeat(70));
    console.log(`  Turret Kills:        ${overall.turretKills} total (${(overall.turretKills/overall.games).toFixed(2)}/game)`);
    console.log(`  Dragon Kills:        ${overall.dragonKills} total (${(overall.dragonKills/overall.games).toFixed(2)}/game)`);
    console.log(`  Baron Kills:         ${overall.baronKills} total (${(overall.baronKills/overall.games).toFixed(2)}/game)`);
    console.log(`  Objectives Stolen:   ${overall.objStolen} total`);

    // ── 10. MULTI-KILL SUMMARY ────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log(' HIGHLIGHT PLAYS');
    console.log('─'.repeat(70));
    console.log(`  Penta Kills:   ${overall.pentas}`);
    console.log(`  Quadra Kills:  ${overall.quadras}`);
    console.log(`  Triple Kills:  ${overall.triples}`);
    console.log(`  Double Kills:  ${overall.doubles}`);
    console.log(`  First Bloods:  ${overall.firstBloods} (${(overall.firstBloods/overall.games*100).toFixed(1)}% of games)`);

    console.log('\n' + '═'.repeat(70) + '\n');

    db.close();
}

run().catch(e => { console.error(e); db.close(); });
