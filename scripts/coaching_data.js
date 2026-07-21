/**
 * coaching_data.js
 * Pulls death timing, dragon timing, and jungle pathing clues
 * from timeline data to give specific coaching insight.
 */

const sqlite3 = require('sqlite3').verbose();
const zlib    = require('zlib');
const path    = require('path');

const DB_PATH      = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');
const SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();

function decompress(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return JSON.parse(blob);
    try { return JSON.parse(zlib.gunzipSync(blob).toString('utf8')); }
    catch { return null; }
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
const Q  = (sql, p=[]) => new Promise((res,rej) => db.all(sql,p,(e,r)=>e?rej(e):res(r)));

async function run() {
    // Load matches with both rawJson and timelineJson
    const rows = await Q(`
        SELECT matchId, win, championName, teamId, gameCreation, gameDuration,
               rawJson, timelineJson, kills, deaths, isolatedDeaths, goldDiff15
        FROM matches
        WHERE queueId = 420
          AND gameCreation >= ${SEASON_START}
          AND timelineJson IS NOT NULL
        ORDER BY gameCreation ASC
    `);

    console.log(`Analysing ${rows.length} matches with timeline data...\n`);

    // Accumulators
    const deathPhases     = { early:0, mid:0, late:0, total:0 }; // <15, 15-25, 25+
    const dragonPhases    = { pre15:0, p15to25:0, p25plus:0, total:0 };
    const firstDrakeTime  = [];       // minutes of first team drake secured
    const missedDrakes    = [];       // games where we got 0 drakes
    const deathByPhase    = { early:{w:0,g:0}, mid:{w:0,g:0}, late:{w:0,g:0} };
    const invadeDeaths    = [];       // deaths in enemy jungle (approx)
    const preObjectiveDeath = { yes:0, no:0 }; // died within 90s before major objective?

    // Game-phase KP
    const kpPhases = { early:[], mid:[], late:[] };

    for (const row of rows) {
        const match    = decompress(row.rawJson);
        const timeline = decompress(row.timelineJson);
        if (!match || !timeline) continue;

        const parts    = match.info?.participants ?? [];
        const me       = parts.find(p =>
            p.riotIdGameName?.toLowerCase() === 'toan' &&
            p.riotIdTagline?.toLowerCase()  === 'ggwp'
        );
        if (!me) continue;

        const myPId    = me.participantId;
        const myTeamId = me.teamId;
        const frames   = timeline.info?.frames ?? [];
        const allEvents = frames.flatMap(f => f.events || []);
        const gameDurMin = row.gameDuration / 60;

        // ── DEATH TIMING ──────────────────────────────────────────────────
        const myDeaths = allEvents.filter(e => e.type === 'CHAMPION_KILL' && e.victimId === myPId);
        for (const d of myDeaths) {
            const min = d.timestamp / 60000;
            deathPhases.total++;
            if (min < 15)      deathPhases.early++;
            else if (min < 25) deathPhases.mid++;
            else               deathPhases.late++;
        }

        // ── DRAGON TIMING ─────────────────────────────────────────────────
        const drakeEvents = allEvents.filter(e =>
            e.type === 'ELITE_MONSTER_KILL' &&
            e.monsterType === 'DRAGON'
        );
        const teamDrakes  = drakeEvents.filter(e => {
            // killer is on my team
            const killer = parts.find(p => p.participantId === e.killerId);
            return killer && killer.teamId === myTeamId;
        });

        if (teamDrakes.length > 0) {
            const firstMin = teamDrakes[0].timestamp / 60000;
            firstDrakeTime.push(firstMin);
            dragonPhases.total++;
            if (firstMin < 15)      dragonPhases.pre15++;
            else if (firstMin < 25) dragonPhases.p15to25++;
            else                    dragonPhases.p25plus++;
        } else {
            missedDrakes.push(row.win);
        }

        // ── DEATHS NEAR OBJECTIVES ────────────────────────────────────────
        const objectiveEvents = allEvents.filter(e =>
            (e.type === 'ELITE_MONSTER_KILL' || e.type === 'BUILDING_KILL') &&
            ['DRAGON','BARON_NASHOR','RIFTHERALD'].includes(e.monsterType || '')
        );
        for (const d of myDeaths) {
            const nearObj = objectiveEvents.some(obj =>
                Math.abs(obj.timestamp - d.timestamp) <= 90000
            );
            if (nearObj) preObjectiveDeath.yes++;
            else         preObjectiveDeath.no++;
        }

        // ── DEATH LOCATION (enemy jungle proxy) ──────────────────────────
        // Blue side (teamId=100): enemy jungle is x>7000, y>7000 roughly
        // Red side (teamId=200): enemy jungle is x<7000, y<7000 roughly
        for (const d of myDeaths) {
            const pos = d.position;
            if (!pos) continue;
            let inEnemyJungle = false;
            if (myTeamId === 100) inEnemyJungle = pos.x > 8000 || pos.y > 8000;
            else                  inEnemyJungle = pos.x < 6000 || pos.y < 6000;
            invadeDeaths.push(inEnemyJungle);
        }

        // ── KILL PARTICIPATION BY PHASE ───────────────────────────────────
        const allKills = allEvents.filter(e => e.type === 'CHAMPION_KILL');
        const teamKills = allKills.filter(e => {
            const killer = parts.find(p => p.participantId === e.killerId);
            return killer && killer.teamId === myTeamId;
        });

        for (const phase of ['early','mid','late']) {
            const [lo, hi] = phase === 'early' ? [0,15] : phase === 'mid' ? [15,25] : [25,999];
            const phaseTeamKills = teamKills.filter(e => {
                const m = e.timestamp/60000;
                return m >= lo && m < hi;
            });
            const phaseMyKills = allKills.filter(e => {
                const m = e.timestamp/60000;
                return m >= lo && m < hi &&
                    (e.killerId === myPId || (e.assistingParticipantIds||[]).includes(myPId));
            });
            if (phaseTeamKills.length > 0) {
                kpPhases[phase].push(phaseMyKills.length / phaseTeamKills.length);
            }
        }
    }

    // ── PRINT RESULTS ────────────────────────────────────────────────────

    function header(t) { console.log('\n' + '═'.repeat(62) + '\n ' + t + '\n' + '═'.repeat(62)); }

    header('DEATH TIMING BREAKDOWN');
    const dt = deathPhases;
    console.log(`  Total deaths analysed: ${dt.total}`);
    console.log(`  Early game  (<15 min): ${dt.early}  (${(dt.early/dt.total*100).toFixed(1)}%)`);
    console.log(`  Mid game (15–25 min):  ${dt.mid}    (${(dt.mid/dt.total*100).toFixed(1)}%)`);
    console.log(`  Late game  (25+ min):  ${dt.late}   (${(dt.late/dt.total*100).toFixed(1)}%)`);

    header('DEATH NEAR OBJECTIVES');
    const tot = preObjectiveDeath.yes + preObjectiveDeath.no;
    console.log(`  Deaths within 90s of a major objective: ${preObjectiveDeath.yes} (${(preObjectiveDeath.yes/tot*100).toFixed(1)}%)`);
    console.log(`  Deaths unrelated to objectives:         ${preObjectiveDeath.no} (${(preObjectiveDeath.no/tot*100).toFixed(1)}%)`);

    header('DEATH LOCATION (Enemy Jungle Proxy)');
    const inEn = invadeDeaths.filter(Boolean).length;
    const total = invadeDeaths.length;
    console.log(`  Deaths in enemy territory: ${inEn} / ${total} (${(inEn/total*100).toFixed(1)}%)`);
    console.log(`  Deaths in own territory:   ${total-inEn} / ${total} (${((total-inEn)/total*100).toFixed(1)}%)`);

    header('DRAGON SECURING TIMING');
    const dp = dragonPhases;
    const fdt = firstDrakeTime;
    console.log(`  Games where team got ≥1 drake: ${dp.total} / ${rows.length} (${(dp.total/rows.length*100).toFixed(1)}%)`);
    console.log(`  Games where team got 0 drakes: ${missedDrakes.length} → WR=${(missedDrakes.filter(w=>w).length/missedDrakes.length*100).toFixed(1)}%`);
    console.log(`\n  When team secured FIRST drake:`);
    console.log(`    Before 15 min: ${dp.pre15}   (${(dp.pre15/dp.total*100).toFixed(1)}%)`);
    console.log(`    15–25 min:     ${dp.p15to25} (${(dp.p15to25/dp.total*100).toFixed(1)}%)`);
    console.log(`    25+ min:       ${dp.p25plus} (${(dp.p25plus/dp.total*100).toFixed(1)}%)`);
    if (fdt.length) {
        const avg = fdt.reduce((a,b)=>a+b,0)/fdt.length;
        console.log(`    Avg first drake time: ${avg.toFixed(1)} min`);
    }

    header('KILL PARTICIPATION BY PHASE');
    const avgKP = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length*100).toFixed(1) : 'N/A';
    console.log(`  Early game  (<15 min): ${avgKP(kpPhases.early)}% KP`);
    console.log(`  Mid game (15–25 min):  ${avgKP(kpPhases.mid)}% KP`);
    console.log(`  Late game  (25+ min):  ${avgKP(kpPhases.late)}% KP`);

    console.log('');
    db.close();
}

run().catch(e => { console.error(e); db.close(); });
