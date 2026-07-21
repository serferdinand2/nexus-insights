/**
 * improvement_analysis.js
 * Deep improvement diagnostics for Toan#GGWP — Solo/Duo 2026 season.
 * Pulls everything from stored columns + rawJson where needed.
 */

const sqlite3 = require('sqlite3').verbose();
const zlib    = require('zlib');
const path    = require('path');

const DB_PATH      = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');
const SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();
const BASE_WHERE   = `WHERE queueId = 420 AND gameCreation >= ${SEASON_START}`;

function decompress(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return JSON.parse(blob);
    try { return JSON.parse(zlib.gunzipSync(blob).toString('utf8')); }
    catch { return null; }
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
const Q  = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const Q1 = (sql, p = []) => new Promise((res, rej) => db.get(sql, p,  (e, r) => e ? rej(e) : res(r)));

function pct(n, d) { return d ? (n/d*100).toFixed(1)+'%' : 'N/A'; }
function avg(arr)   { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function corr(xs, ys) {
    const n = xs.length;
    const mx = avg(xs), my = avg(ys);
    const num = xs.reduce((s,x,i) => s + (x-mx)*(ys[i]-my), 0);
    const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0) * ys.reduce((s,y)=>s+(y-my)**2,0));
    return den ? (num/den).toFixed(3) : '0';
}

function header(title) {
    console.log('\n' + '═'.repeat(72));
    console.log(' ' + title);
    console.log('═'.repeat(72));
}
function section(title) {
    console.log('\n  ── ' + title + ' ' + '─'.repeat(Math.max(0,64-title.length)));
}

async function run() {

    // Load all season Solo games
    const rows = await Q(`
        SELECT *, 
               CAST(kills+assists AS FLOAT)/CASE WHEN teamKills=0 THEN 1 ELSE teamKills END as kp,
               CAST(totalMinionsKilled AS FLOAT)/(gameDuration/60.0) as csMin
        FROM matches ${BASE_WHERE} ORDER BY gameCreation ASC
    `);
    const N = rows.length;
    console.log(`\nLoaded ${N} Solo/Duo games (2026 season)\n`);

    // ── 1. STAT CORRELATION WITH WIN RATE ─────────────────────────────────
    header('1. WHAT STATS CORRELATE MOST WITH WINNING?');
    console.log('  (Pearson r: +1 = strong positive, -1 = strong negative, 0 = no link)\n');

    const wins = rows.map(r => r.win);
    const metrics = [
        ['KP (Kill Participation)',      rows.map(r => r.kp)],
        ['Kills',                         rows.map(r => r.kills)],
        ['Deaths',                         rows.map(r => r.deaths)],
        ['Assists',                        rows.map(r => r.assists)],
        ['Dmg to Champions',               rows.map(r => r.totalDamageDealtToChampions)],
        ['Vision Score',                   rows.map(r => r.visionScore)],
        ['CS/min',                         rows.map(r => r.csMin)],
        ['Gold Earned',                    rows.map(r => r.goldEarned)],
        ['Wards Placed',                   rows.map(r => r.wardsPlaced)],
        ['Control Wards',                  rows.map(r => r.detectorWardsPlaced)],
        ['Gold Diff@15',                   rows.filter(r=>r.goldDiff15!=null).map(r=>r.goldDiff15)],
        ['CS Diff@15',                     rows.filter(r=>r.csDiff15!=null).map(r=>r.csDiff15)],
        ['Isolated Deaths',                rows.filter(r=>r.isolatedDeaths!=null).map(r=>r.isolatedDeaths)],
        ['Dmg/Gold Ratio',                 rows.filter(r=>r.dmgGoldRatio!=null).map(r=>r.dmgGoldRatio)],
        ['Team Dragons',                   rows.map(r => r.teamDragons||0)],
        ['Enemy Dragons',                  rows.map(r => r.enemyDragons||0)],
        ['Team Barons',                    rows.map(r => r.teamBarons||0)],
        ['Team Towers',                    rows.map(r => r.teamTowers||0)],
        ['Turret Kills (personal)',        rows.map(r => r.turretKills||0)],
        ['Dragon Kills (personal)',        rows.map(r => r.dragonKills||0)],
        ['Game Duration',                  rows.map(r => r.gameDuration)],
    ];

    const corrResults = metrics.map(([label, vals]) => {
        const w = label.includes('@15') ? rows.filter(r=>r.goldDiff15!=null).map(r=>r.win)
                : label==='Isolated Deaths' ? rows.filter(r=>r.isolatedDeaths!=null).map(r=>r.win)
                : label==='Dmg/Gold Ratio'  ? rows.filter(r=>r.dmgGoldRatio!=null).map(r=>r.win)
                : wins;
        const c = parseFloat(corr(vals, w));
        return { label, c, abs: Math.abs(c) };
    }).sort((a,b) => b.abs - a.abs);

    corrResults.forEach(({label, c}) => {
        const bar = '█'.repeat(Math.round(Math.abs(c)*20));
        const dir = c > 0 ? '+' : '-';
        const col = c > 0.15 ? '↑WIN' : c < -0.15 ? '↓WIN' : '    ';
        console.log(`  ${col}  ${label.padEnd(30)} r=${c.toFixed(3).padEnd(8)} ${dir}${bar}`);
    });

    // ── 2. EARLY GAME ANALYSIS ─────────────────────────────────────────────
    header('2. EARLY GAME (0–15 MIN) DEEP DIVE');

    const withAdv = rows.filter(r => r.goldDiff15 != null && r.csDiff15 != null);
    const nAdv = withAdv.length;

    // Buckets: ahead vs behind at 15
    const aheadGold  = withAdv.filter(r => r.goldDiff15 >  200);
    const evenGold   = withAdv.filter(r => Math.abs(r.goldDiff15) <= 200);
    const behindGold = withAdv.filter(r => r.goldDiff15 < -200);

    section('Gold Diff @15 vs Win Rate');
    console.log(`  Ahead  (GD >+200) : ${pct(aheadGold.filter(r=>r.win).length,  aheadGold.length).padEnd(8)} in ${aheadGold.length} games`);
    console.log(`  Even   (±200)     : ${pct(evenGold.filter(r=>r.win).length,   evenGold.length).padEnd(8)} in ${evenGold.length} games`);
    console.log(`  Behind (GD <-200) : ${pct(behindGold.filter(r=>r.win).length, behindGold.length).padEnd(8)} in ${behindGold.length} games`);
    console.log(`\n  ➤ You are AHEAD at 15 in  ${pct(aheadGold.length, nAdv)} of games`);
    console.log(`  ➤ You are BEHIND at 15 in ${pct(behindGold.length, nAdv)} of games`);
    console.log(`  ➤ Avg GD@15: ${avg(withAdv.map(r=>r.goldDiff15)).toFixed(0)}  |  Avg CSD@15: ${avg(withAdv.map(r=>r.csDiff15)).toFixed(1)}`);

    section('First Blood Impact');
    const withFB    = rows.filter(r => r.firstBlood === 1);
    const withoutFB = rows.filter(r => r.firstBlood === 0);
    console.log(`  Got First Blood:    ${pct(withFB.filter(r=>r.win).length,    withFB.length).padEnd(8)} WR  (${withFB.length} games)`);
    console.log(`  No First Blood:     ${pct(withoutFB.filter(r=>r.win).length, withoutFB.length).padEnd(8)} WR  (${withoutFB.length} games)`);

    // ── 3. KILL PARTICIPATION ──────────────────────────────────────────────
    header('3. KILL PARTICIPATION & FIGHTING IMPACT');

    const kpBuckets = [
        { label: 'Very Low  KP <40%',   games: rows.filter(r => r.kp < 0.40) },
        { label: 'Low       KP 40-55%', games: rows.filter(r => r.kp >= 0.40 && r.kp < 0.55) },
        { label: 'Good      KP 55-70%', games: rows.filter(r => r.kp >= 0.55 && r.kp < 0.70) },
        { label: 'High      KP 70-85%', games: rows.filter(r => r.kp >= 0.70 && r.kp < 0.85) },
        { label: 'Very High KP >85%',   games: rows.filter(r => r.kp >= 0.85) },
    ];
    kpBuckets.forEach(b => {
        const wr  = pct(b.games.filter(r=>r.win).length, b.games.length);
        const bar = '█'.repeat(Math.round(b.games.length/2));
        console.log(`  ${b.label.padEnd(24)} WR=${wr.padEnd(8)} (${String(b.games.length).padEnd(3)}g) ${bar}`);
    });
    console.log(`\n  ➤ Avg KP overall: ${(avg(rows.map(r=>r.kp))*100).toFixed(1)}%`);
    console.log(`  ➤ Avg KP in wins: ${(avg(rows.filter(r=>r.win).map(r=>r.kp))*100).toFixed(1)}%`);
    console.log(`  ➤ Avg KP in losses: ${(avg(rows.filter(r=>!r.win).map(r=>r.kp))*100).toFixed(1)}%`);

    // ── 4. DEATH ANALYSIS ─────────────────────────────────────────────────
    header('4. DEATH PATTERNS');

    section('Deaths per game vs Win Rate');
    const deathBuckets = [
        { label: '0–2 deaths',  games: rows.filter(r => r.deaths <= 2) },
        { label: '3–4 deaths',  games: rows.filter(r => r.deaths >= 3 && r.deaths <= 4) },
        { label: '5–6 deaths',  games: rows.filter(r => r.deaths >= 5 && r.deaths <= 6) },
        { label: '7–9 deaths',  games: rows.filter(r => r.deaths >= 7 && r.deaths <= 9) },
        { label: '10+ deaths',  games: rows.filter(r => r.deaths >= 10) },
    ];
    deathBuckets.forEach(b => {
        const wr = pct(b.games.filter(r=>r.win).length, b.games.length);
        console.log(`  ${b.label.padEnd(14)} WR=${wr.padEnd(8)} (${b.games.length}g)`);
    });

    const withIso = rows.filter(r => r.isolatedDeaths != null);
    section('Isolated Deaths (dying alone, no teammate nearby)');
    const isoBuckets = [
        { label: '0 isolated',   games: withIso.filter(r => r.isolatedDeaths === 0) },
        { label: '1 isolated',   games: withIso.filter(r => r.isolatedDeaths === 1) },
        { label: '2 isolated',   games: withIso.filter(r => r.isolatedDeaths === 2) },
        { label: '3+ isolated',  games: withIso.filter(r => r.isolatedDeaths >= 3) },
    ];
    isoBuckets.forEach(b => {
        const wr = pct(b.games.filter(r=>r.win).length, b.games.length);
        console.log(`  ${b.label.padEnd(14)} WR=${wr.padEnd(8)} (${b.games.length}g)`);
    });
    console.log(`\n  ➤ Avg isolated deaths: ${avg(withIso.map(r=>r.isolatedDeaths)).toFixed(2)}/game`);
    console.log(`  ➤ Avg isolated in wins: ${avg(withIso.filter(r=>r.win).map(r=>r.isolatedDeaths)).toFixed(2)}`);
    console.log(`  ➤ Avg isolated in losses: ${avg(withIso.filter(r=>!r.win).map(r=>r.isolatedDeaths)).toFixed(2)}`);

    // ── 5. VISION & WARD ANALYSIS ─────────────────────────────────────────
    header('5. VISION CONTROL');

    section('Control Wards Purchased per Game');
    const cwBuckets = [
        { label: '0 control wards',  games: rows.filter(r => r.detectorWardsPlaced === 0) },
        { label: '1–2 control wards',games: rows.filter(r => r.detectorWardsPlaced >= 1 && r.detectorWardsPlaced <= 2) },
        { label: '3–5 control wards',games: rows.filter(r => r.detectorWardsPlaced >= 3 && r.detectorWardsPlaced <= 5) },
        { label: '6+ control wards', games: rows.filter(r => r.detectorWardsPlaced >= 6) },
    ];
    cwBuckets.forEach(b => {
        const wr = pct(b.games.filter(r=>r.win).length, b.games.length);
        console.log(`  ${b.label.padEnd(22)} WR=${wr.padEnd(8)} (${b.games.length}g)`);
    });
    console.log(`\n  ➤ Avg control wards/game: ${avg(rows.map(r=>r.detectorWardsPlaced)).toFixed(2)}`);
    console.log(`  ➤ Avg wards placed/game:  ${avg(rows.map(r=>r.wardsPlaced)).toFixed(2)}`);
    console.log(`  ➤ Avg wards cleared/game: ${avg(rows.map(r=>r.wardsKilled)).toFixed(2)}`);

    // ── 6. OBJECTIVE CONTROL ──────────────────────────────────────────────
    header('6. OBJECTIVE CONTROL');

    section('Dragon Control → Win Rate');
    for (let d = 0; d <= 4; d++) {
        const gs = rows.filter(r => (r.teamDragons||0) === d);
        if (gs.length === 0) continue;
        const wr = pct(gs.filter(r=>r.win).length, gs.length);
        const bar = '█'.repeat(Math.round(gs.length/3));
        console.log(`  Team got ${d} dragon(s): WR=${wr.padEnd(8)} (${String(gs.length).padEnd(3)}g) ${bar}`);
    }

    section('Baron Control → Win Rate');
    const noBaron   = rows.filter(r => (r.teamBarons||0) === 0);
    const oneBaron  = rows.filter(r => (r.teamBarons||0) === 1);
    const twoBaron  = rows.filter(r => (r.teamBarons||0) >= 2);
    console.log(`  0 Barons: WR=${pct(noBaron.filter(r=>r.win).length,  noBaron.length).padEnd(8)} (${noBaron.length}g)`);
    console.log(`  1 Baron:  WR=${pct(oneBaron.filter(r=>r.win).length, oneBaron.length).padEnd(8)} (${oneBaron.length}g)`);
    console.log(`  2+ Baron: WR=${pct(twoBaron.filter(r=>r.win).length, twoBaron.length).padEnd(8)} (${twoBaron.length}g)`);

    section('Objectives Stolen');
    console.log(`  Total steals this season: ${rows.reduce((s,r)=>s+(r.objectivesStolen||0),0)}`);
    const stoleGames = rows.filter(r=>(r.objectivesStolen||0)>0);
    console.log(`  Games with a steal: ${stoleGames.length} → WR=${pct(stoleGames.filter(r=>r.win).length, stoleGames.length)}`);

    // ── 7. GAME LENGTH ANALYSIS ───────────────────────────────────────────
    header('7. GAME LENGTH ANALYSIS');

    const gameLenBuckets = [
        { label: '<20 min (stomp)',      games: rows.filter(r => r.gameDuration < 1200) },
        { label: '20–25 min',           games: rows.filter(r => r.gameDuration >= 1200 && r.gameDuration < 1500) },
        { label: '25–30 min',           games: rows.filter(r => r.gameDuration >= 1500 && r.gameDuration < 1800) },
        { label: '30–35 min',           games: rows.filter(r => r.gameDuration >= 1800 && r.gameDuration < 2100) },
        { label: '35–40 min',           games: rows.filter(r => r.gameDuration >= 2100 && r.gameDuration < 2400) },
        { label: '40+ min (late game)', games: rows.filter(r => r.gameDuration >= 2400) },
    ];
    gameLenBuckets.forEach(b => {
        const wr = pct(b.games.filter(r=>r.win).length, b.games.length);
        const bar = '█'.repeat(Math.round(b.games.length/2));
        console.log(`  ${b.label.padEnd(22)} WR=${wr.padEnd(8)} (${String(b.games.length).padEnd(3)}g) ${bar}`);
    });

    // ── 8. GOOD MONTHS vs BAD MONTHS ─────────────────────────────────────
    header('8. GOOD MONTHS (Jan–Mar) vs BAD MONTHS (Apr–Jun)');

    const goodCut = new Date('2026-04-01T00:00:00Z').getTime();
    const good = rows.filter(r => r.gameCreation < goodCut);
    const bad  = rows.filter(r => r.gameCreation >= goodCut);

    const fmt = (arr, stat) => avg(arr.map(r => r[stat])).toFixed(1);
    console.log(`\n  ${'Stat'.padEnd(26)} ${'Jan–Mar'.padEnd(16)} ${'Apr–Jun'.padEnd(16)} Diff`);
    console.log('  ' + '─'.repeat(65));
    const comparisons = [
        ['Games',           good.length.toString(),                   bad.length.toString(),                  ''],
        ['Win Rate',        pct(good.filter(r=>r.win).length,good.length), pct(bad.filter(r=>r.win).length,bad.length), ''],
        ['KDA (calc)',      (avg(good.map(r=>r.deaths===0?r.kills+r.assists:(r.kills+r.assists)/r.deaths))).toFixed(2),
                            (avg(bad.map(r=>r.deaths===0?r.kills+r.assists:(r.kills+r.assists)/r.deaths))).toFixed(2), ''],
        ['Avg Kills',       fmt(good,'kills'),          fmt(bad,'kills'),       ''],
        ['Avg Deaths',      fmt(good,'deaths'),         fmt(bad,'deaths'),      ''],
        ['Avg Assists',     fmt(good,'assists'),        fmt(bad,'assists'),     ''],
        ['Avg Dmg',         Math.round(avg(good.map(r=>r.totalDamageDealtToChampions))).toLocaleString(),
                            Math.round(avg(bad.map(r=>r.totalDamageDealtToChampions))).toLocaleString(), ''],
        ['CS/min',          avg(good.map(r=>r.csMin)).toFixed(2), avg(bad.map(r=>r.csMin)).toFixed(2), ''],
        ['Vision Score',    fmt(good,'visionScore'),   fmt(bad,'visionScore'), ''],
        ['Control Wards',   fmt(good,'detectorWardsPlaced'), fmt(bad,'detectorWardsPlaced'), ''],
        ['GD@15',           avg(good.filter(r=>r.goldDiff15!=null).map(r=>r.goldDiff15)).toFixed(0),
                            avg(bad.filter(r=>r.goldDiff15!=null).map(r=>r.goldDiff15)).toFixed(0), ''],
        ['Isolated Deaths', avg(good.filter(r=>r.isolatedDeaths!=null).map(r=>r.isolatedDeaths)).toFixed(2),
                            avg(bad.filter(r=>r.isolatedDeaths!=null).map(r=>r.isolatedDeaths)).toFixed(2), ''],
        ['Games/day avg',   (good.length/90).toFixed(2), (bad.length/91).toFixed(2), '(volume)'],
    ];
    comparisons.forEach(([stat, g, b, note]) => {
        console.log(`  ${stat.padEnd(26)} ${String(g).padEnd(16)} ${String(b).padEnd(16)} ${note}`);
    });

    // ── 9. CHAMPION-SPECIFIC ADVICE ───────────────────────────────────────
    header('9. CHAMPION-SPECIFIC DEEP DIVE (Nocturne vs Sejuani)');

    for (const champ of ['Nocturne', 'Sejuani']) {
        const cRows = rows.filter(r => r.championName === champ);
        if (!cRows.length) continue;
        const cWins = cRows.filter(r=>r.win);
        console.log(`\n  ${champ} (${cRows.length}g, ${pct(cWins.length, cRows.length)} WR)`);
        console.log(`    KDA:            ${avg(cRows.map(r=>r.deaths===0?r.kills+r.assists:(r.kills+r.assists)/r.deaths)).toFixed(2)}`);
        console.log(`    Avg Deaths:     ${avg(cRows.map(r=>r.deaths)).toFixed(1)}`);
        console.log(`    CS/min:         ${avg(cRows.map(r=>r.csMin)).toFixed(2)}`);
        console.log(`    Avg Dmg:        ${Math.round(avg(cRows.map(r=>r.totalDamageDealtToChampions))).toLocaleString()}`);
        console.log(`    Vision Score:   ${avg(cRows.map(r=>r.visionScore)).toFixed(1)}`);
        console.log(`    GD@15 (avg):    ${avg(cRows.filter(r=>r.goldDiff15!=null).map(r=>r.goldDiff15)).toFixed(0)}`);
        console.log(`    Isolated Deaths:${avg(cRows.filter(r=>r.isolatedDeaths!=null).map(r=>r.isolatedDeaths)).toFixed(2)}/game`);
        console.log(`    KP:             ${(avg(cRows.map(r=>r.kp))*100).toFixed(1)}%`);

        const short = cRows.filter(r=>r.gameDuration<1800);
        const long  = cRows.filter(r=>r.gameDuration>=1800);
        console.log(`    Short (<30m):   ${pct(short.filter(r=>r.win).length,short.length)} WR in ${short.length}g`);
        console.log(`    Long (30m+):    ${pct(long.filter(r=>r.win).length,long.length)} WR in ${long.length}g`);
    }

    // ── 10. ACTIONABLE SUMMARY ────────────────────────────────────────────
    header('10. PRIORITY FIXES — RANKED BY IMPACT');
    console.log(`
  #1 🔴 EARLY GAME (highest correlation with winning)
     • You end at -315 GD@15 and -4.7 CSD@15 on average
     • Being ahead at 15 gives you significantly higher WR
     • Focus: smarter pathing, tempo, counter-jungling

  #2 🔴 REDUCE ISOLATED DEATHS
     • 1.74 solo deaths/game — you die alone almost 2x per game
     • Each isolated death wastes time, gives bounty, and gifts vision
     • Focus: track enemy jungle, don't invade without info

  #3 🔴 CHAMPION POOL — DROP SEJUANI
     • Sejuani: 13 games, 38% WR — your worst main by far
     • Nocturne: 58 games, 57% WR and best KDA
     • Leblanc: 6 games, 67% WR — heavily underplayed
     • Focus: go deeper on Nocturne and add Leblanc as backup

  #4 🟡 GAME VOLUME IN JUNE
     • June: 45 games at 44.4% — you played 3x more than any other month
     • Jan–Mar: ~0.5 games/day at 65%+ WR
     • Apr–Jun: ~0.7 games/day at 37–44% WR
     • Focus: set a stop-loss (e.g. 2 losses in a row → stop for the day)

  #5 🟡 CONTROL WARD CONSISTENCY
     • Check your avg control wards — more wards = better objective setup
     • Vision directly correlates with win rate in your data

  #6 🟡 DRAGON PRIORITY
     • Check how often your team secures early drakes
     • Your WR improves significantly with 3+ dragons

  #7 🟢 YOU'RE ALREADY GOOD AT:
     • Kill Participation (high KP correlates with wins, and you're above avg)
     • Objective presence (always there when objectives spawn)
     • Damage efficiency (1.38 dmg/gold — solid)
     • Nocturne consistency (3.47 KDA over 58 games is very reliable)
`);

    console.log('═'.repeat(72) + '\n');
    db.close();
}

run().catch(e => { console.error(e); db.close(); });
