/**
 * coachingPanel.js
 * Dynamic coaching board for Nexus Insights.
 * Cards are collapsed by default (title + stat + quick tip visible).
 * Click to expand for full stats, insight, and action advice.
 * Goal status (✅ / ⚠️) is data-driven — auto-set when the target is met.
 *
 * Exposes: window.renderCoachingPanel()
 */

(function () {
    'use strict';

    // This panel used to open its OWN read-only sqlite3 connection and gunzip
    // 40 timelines (~24MB) in the renderer every single time the tab was
    // opened. Both now happen once, behind matchService.getCoachingData(),
    // which returns only the derived numbers.
    const { getCoachingData } = require('../services/matchService');

    const SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();

    function pct(n, d)  { return d ? ((n / d) * 100).toFixed(1) : '0.0'; }
    function avg(arr)   { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }


    // ── Toggle expand/collapse ────────────────────────────────────────────────
    window.coachingToggleBody = function (id) {
        const body    = document.getElementById('cbody-' + id);
        const btn     = document.getElementById('cexpand-' + id);
        const card    = document.getElementById('ctask-' + id);
        if (!body) return;
        const isOpen  = !body.classList.contains('collapsed');
        body.classList.toggle('collapsed', isOpen);
        card.classList.toggle('is-open', !isOpen);
        if (btn) btn.textContent = isOpen ? '▶' : '▼';
    };

    // ── Update progress ring ─────────────────────────────────────────────────
    function updateProgressRing(achieved, total) {
        const pctDone  = total ? Math.round((achieved / total) * 100) : 0;
        const ringFill = document.getElementById('coaching-ring-fill');
        const ringText = document.getElementById('coaching-ring-text');
        const barFill  = document.getElementById('coaching-bar-fill');
        const barLabel = document.getElementById('coaching-bar-label');
        const badge    = document.getElementById('coachingBadge');

        if (ringFill) {
            const r = 26, circ = 2 * Math.PI * r;
            ringFill.setAttribute('stroke-dashoffset',
                (circ * (1 - pctDone / 100)).toFixed(2));
        }
        if (ringText) ringText.innerHTML = `${achieved}<small>/${total}</small>`;
        if (barFill)  barFill.style.width = pctDone + '%';
        if (barLabel) barLabel.textContent = `${achieved} of ${total} goals met`;
        if (badge)    badge.textContent    = achieved < total ? (total - achieved) : '';

        if (achieved === total && total > 0) {
            const burst = document.createElement('div');
            burst.className  = 'coaching-confetti-burst';
            burst.textContent = '🎉';
            document.body.appendChild(burst);
            setTimeout(() => burst.remove(), 2100);
        }
    }

    // ── Task card builder ─────────────────────────────────────────────────────
    // achieved: boolean — if true the card shows as green/done, collapsed cleanly
    // quickTip: 1-sentence action shown in the collapsed view
    function buildTask({ id, priority, achieved, title, pill, quickTip,
                          progressPct, progressLabel, stats, insight, action, stagger }) {
        const delay   = (stagger || 0) * 50;
        const pUC     = priority.toUpperCase();

        // Status indicator
        const statusIcon = achieved
            ? `<span class="ctask-status status-achieved" title="Goal met">✓</span>`
            : `<span class="ctask-status status-${priority}" title="Needs improvement">!</span>`;

        // Stat mini-items
        const statItems = (stats || []).map(s =>
            `<div class="task-stat-item">
                <div class="task-stat-item-label">${s.label}</div>
                <div class="task-stat-item-value">${s.value}</div>
            </div>`
        ).join('');

        const doneClass = achieved ? ' ctask-achieved' : '';

        return `
        <div class="ctask${doneClass}" id="ctask-${id}"
             style="animation-delay:${delay}ms"
             data-priority="${priority}">
            <!-- Collapsed header (always visible) -->
            <div class="ctask-header" onclick="coachingToggleBody('${id}')">
                ${statusIcon}
                <div class="ctask-main">
                    <div class="ctask-title-row">
                        <span class="ctask-badge priority-${priority}">${pUC}</span>
                        <span class="ctask-title">${title}</span>
                        <span class="ctask-pill priority-${priority}">${pill}</span>
                    </div>
                    <div class="ctask-quicktip">${quickTip}</div>
                </div>
                <button class="ctask-expand-btn" id="cexpand-${id}">▶</button>
            </div>

            <!-- Expanded body (hidden by default) -->
            <div class="ctask-body collapsed" id="cbody-${id}">
                <div class="ctask-progress-wrap">
                    <div class="ctask-progress-bar">
                        <div class="ctask-progress-fill priority-${priority}"
                             style="width:${clamp(progressPct, 0, 100)}%"></div>
                    </div>
                    <span class="ctask-progress-label">${progressLabel}</span>
                </div>
                ${statItems ? `<div class="task-stat-grid">${statItems}</div>` : ''}
                <p class="task-insight">${insight}</p>
                <p class="task-action">💡 ${action}</p>
            </div>
        </div>`;
    }

    // ── Main render ───────────────────────────────────────────────────────────
    window.renderCoachingPanel = async function () {
        const container = document.getElementById('coaching-panel-content');
        if (!container) return;

        // Reset lazy-load flag so refresh works
        window.coachingPanelLoaded = true;

        container.innerHTML = `
            <div class="coaching-loading">
                <div class="coaching-spinner"></div>
                <p>Analysing your Solo/Duo ranked games…</p>
            </div>`;

        try {
            // ── Load rows + precomputed first-drake timings ────────────────
            const { rows, firstDrakeTimes } = await getCoachingData(SEASON_START, 40);

            if (!rows || rows.length === 0) {
                container.innerHTML = `<p style="color:var(--text-secondary);padding:40px;text-align:center">
                    No Solo/Duo ranked games found for this season.</p>`;
                return;
            }

            const N = rows.length;

            // ── Compute stats ──────────────────────────────────────────────

            // Dragon
            const teamDrakeAvg = avg(rows.map(r => r.teamDragons || 0));
            const wr0Drake   = pct(rows.filter(r=>(r.teamDragons||0)===0&&r.win).length, rows.filter(r=>(r.teamDragons||0)===0).length);
            const wr3pDrake  = pct(rows.filter(r=>(r.teamDragons||0)>=3&&r.win).length, rows.filter(r=>(r.teamDragons||0)>=3).length);
            const wr4Drake   = pct(rows.filter(r=>(r.teamDragons||0)>=4&&r.win).length, rows.filter(r=>(r.teamDragons||0)>=4).length);

            const pre15Pct    = firstDrakeTimes.length
                ? parseFloat(pct(firstDrakeTimes.filter(t => t < 15).length, firstDrakeTimes.length)) : 0;
            const avgFirstDrake = firstDrakeTimes.length ? avg(firstDrakeTimes).toFixed(1) : 'N/A';

            // Early game
            const advRows  = rows.filter(r => r.goldDiff15 != null);
            const avgGD15  = advRows.length ? avg(advRows.map(r => r.goldDiff15)) : null;
            const behindPct = advRows.length ? parseFloat(pct(advRows.filter(r=>r.goldDiff15<-200).length, advRows.length)) : 0;
            const aheadPct  = advRows.length ? parseFloat(pct(advRows.filter(r=>r.goldDiff15>200).length, advRows.length)) : 0;
            const wrAhead  = pct(advRows.filter(r=>r.goldDiff15>200&&r.win).length, advRows.filter(r=>r.goldDiff15>200).length);
            const wrBehind = pct(advRows.filter(r=>r.goldDiff15<-200&&r.win).length, advRows.filter(r=>r.goldDiff15<-200).length);

            // Isolated deaths
            const isoRows  = rows.filter(r => r.isolatedDeaths != null);
            const avgIso   = isoRows.length ? avg(isoRows.map(r => r.isolatedDeaths)) : 0;
            const wr0Iso   = pct(isoRows.filter(r=>r.isolatedDeaths===0&&r.win).length, isoRows.filter(r=>r.isolatedDeaths===0).length);
            const wr2pIso  = pct(isoRows.filter(r=>r.isolatedDeaths>=2&&r.win).length, isoRows.filter(r=>r.isolatedDeaths>=2).length);

            // Champion pool
            const champMap = {};
            for (const r of rows) {
                if (!champMap[r.championName]) champMap[r.championName] = { games:0, wins:0 };
                champMap[r.championName].games++;
                if (r.win) champMap[r.championName].wins++;
            }
            const champList  = Object.entries(champMap).map(([name,d])=>({name,...d,wr:d.wins/d.games}));
            const topChamp   = [...champList].sort((a,b)=>b.games-a.games)[0];
            const bestChamp  = champList.filter(c=>c.games>=5).sort((a,b)=>b.wr-a.wr)[0];
            const topChampWR = topChamp ? topChamp.wr * 100 : 50;

            // Streaks
            let maxLoss=0, curLoss=0, maxWin=0, curWin=0;
            for (const r of rows) {
                if (r.win) { curLoss=0; curWin++;  maxWin=Math.max(maxWin,curWin);  }
                else       { curWin=0;  curLoss++; maxLoss=Math.max(maxLoss,curLoss); }
            }
            let streak=0, streakType='';
            for (let i=rows.length-1;i>=0;i--) {
                const t = rows[i].win ? 'W' : 'L';
                if (!streakType) { streakType=t; streak=1; }
                else if (t===streakType) streak++;
                else break;
            }

            // Volume
            const recentCut = Date.now() - 30*24*60*60*1000;
            const recentRows = rows.filter(r=>r.gameCreation>=recentCut);
            const recentGPD  = recentRows.length / 30;
            const seasonGPD  = N / ((Date.now()-SEASON_START)/86400000);

            // Control wards
            const avgCW   = avg(rows.map(r=>r.detectorWardsPlaced||0));
            const wr1_2CW = pct(rows.filter(r=>(r.detectorWardsPlaced||0)<=2&&r.win).length, rows.filter(r=>(r.detectorWardsPlaced||0)<=2).length);
            const wr6pCW  = pct(rows.filter(r=>(r.detectorWardsPlaced||0)>=6&&r.win).length, rows.filter(r=>(r.detectorWardsPlaced||0)>=6).length);

            // Deaths
            const avgDeaths = avg(rows.map(r=>r.deaths||0));
            const wr0_2D    = pct(rows.filter(r=>r.deaths<=2&&r.win).length, rows.filter(r=>r.deaths<=2).length);
            const wr7pD     = pct(rows.filter(r=>r.deaths>=7&&r.win).length, rows.filter(r=>r.deaths>=7).length);

            // Game length
            const shortRows = rows.filter(r=>r.gameDuration<1500);
            const lateRows  = rows.filter(r=>r.gameDuration>=2100);
            const wrShort   = pct(shortRows.filter(r=>r.win).length, shortRows.length);
            const wrLate    = pct(lateRows.filter(r=>r.win).length,  lateRows.length);

            // CS/min
            const csRows  = rows.filter(r=>r.gameDuration>0&&r.totalMinionsKilled!=null);
            const avgCSMin = avg(csRows.map(r=>r.totalMinionsKilled/(r.gameDuration/60)));

            // Baron
            const wr0Baron  = pct(rows.filter(r=>(r.teamBarons||0)===0&&r.win).length, rows.filter(r=>(r.teamBarons||0)===0).length);
            const wr1pBaron = pct(rows.filter(r=>(r.teamBarons||0)>=1&&r.win).length,  rows.filter(r=>(r.teamBarons||0)>=1).length);

            const totalWins = rows.filter(r=>r.win).length;
            const overallWR = parseFloat(pct(totalWins, N));

            // Kill Participation
            const kpRows   = rows.filter(r => (r.teamKills||0) > 0);
            const avgKP    = avg(kpRows.map(r => (r.kills + r.assists) / r.teamKills)) * 100;
            const wrKPLow  = pct(kpRows.filter(r => (r.kills+r.assists)/r.teamKills < 0.40 && r.win).length,
                                 kpRows.filter(r => (r.kills+r.assists)/r.teamKills < 0.40).length);
            const wrKPHigh = pct(kpRows.filter(r => (r.kills+r.assists)/r.teamKills >= 0.55 && r.win).length,
                                 kpRows.filter(r => (r.kills+r.assists)/r.teamKills >= 0.55).length);

            // Vision Score
            const avgVS       = avg(rows.map(r => r.visionScore || 0));
            const wrVSLow     = pct(rows.filter(r=>(r.visionScore||0)<30&&r.win).length, rows.filter(r=>(r.visionScore||0)<30).length);
            const wrVSHigh    = pct(rows.filter(r=>(r.visionScore||0)>=45&&r.win).length, rows.filter(r=>(r.visionScore||0)>=45).length);

            // Ward clearing (anti-vision)
            const avgWC       = avg(rows.map(r => r.wardsKilled || 0));
            const wrWCLow     = pct(rows.filter(r=>(r.wardsKilled||0)<=1&&r.win).length, rows.filter(r=>(r.wardsKilled||0)<=1).length);
            const wrWCHigh    = pct(rows.filter(r=>(r.wardsKilled||0)>=4&&r.win).length, rows.filter(r=>(r.wardsKilled||0)>=4).length);

            // Turret participation
            const avgTurrets  = avg(rows.map(r => r.turretKills || 0));
            const wrNoTurrets = pct(rows.filter(r=>(r.turretKills||0)===0&&r.win).length, rows.filter(r=>(r.turretKills||0)===0).length);
            const wrTurretsHi = pct(rows.filter(r=>(r.turretKills||0)>=2&&r.win).length, rows.filter(r=>(r.turretKills||0)>=2).length);

            // Multi-kills (carry rate)
            const totalDoubles = rows.reduce((s,r) => s+(r.doubleKills||0), 0);
            const totalTriples = rows.reduce((s,r) => s+(r.tripleKills||0), 0);
            const gamesWithDouble = rows.filter(r=>(r.doubleKills||0)>=1).length;
            const doubleRate      = parseFloat(pct(gamesWithDouble, N));
            const wrWithDouble    = pct(rows.filter(r=>(r.doubleKills||0)>=1&&r.win).length, rows.filter(r=>(r.doubleKills||0)>=1).length);
            const wrNoDouble      = pct(rows.filter(r=>(r.doubleKills||0)===0&&r.win).length, rows.filter(r=>(r.doubleKills||0)===0).length);

            // First blood
            const fbGames   = rows.filter(r => r.firstBlood === 1);
            const fbRate    = parseFloat(pct(fbGames.length, N));
            const wrWithFB  = pct(fbGames.filter(r=>r.win).length, fbGames.length);
            const wrNoFB    = pct(rows.filter(r=>!r.firstBlood&&r.win).length, rows.filter(r=>!r.firstBlood).length);

            // Objective steals
            const totalSteals  = rows.reduce((s,r) => s+(r.objectivesStolen||0), 0);
            const stealGames   = rows.filter(r=>(r.objectivesStolen||0)>0);
            const stealRate    = parseFloat(pct(stealGames.length, N));
            const wrWithSteal  = pct(stealGames.filter(r=>r.win).length, stealGames.length);
            const stealsPerGame = (totalSteals / N).toFixed(2);

            // Best playing time (hour of day)
            const hourBuckets = {};
            for (const r of rows) {
                const h = new Date(r.gameCreation).getHours();
                if (!hourBuckets[h]) hourBuckets[h] = { games:0, wins:0 };
                hourBuckets[h].games++;
                if (r.win) hourBuckets[h].wins++;
            }
            const hourList = Object.entries(hourBuckets)
                .filter(([,d]) => d.games >= 3)
                .map(([h,d]) => ({ hour: parseInt(h), games: d.games, wr: d.wins/d.games }))
                .sort((a,b) => b.wr - a.wr);
            const bestHour  = hourList[0];
            const worstHour = hourList[hourList.length-1];
            const recentHours = rows.slice(-20).map(r => new Date(r.gameCreation).getHours());
            const avgRecentHour = recentHours.length ? Math.round(avg(recentHours)) : null;
            function fmtHour(h) {
                if (h == null) return 'N/A';
                const ampm = h >= 12 ? 'PM' : 'AM';
                return `${h % 12 || 12}:00 ${ampm}`;
            }
            const playingInGoodHours = avgRecentHour != null && bestHour
                ? Math.abs(avgRecentHour - bestHour.hour) <= 2
                : true;

            // ── Goal thresholds (auto-check when met) ─────────────────────
            const goals = {
                dragon:    teamDrakeAvg >= 2.5,
                earlygame: avgGD15 != null ? avgGD15 >= -200 : true,
                isolated:  avgIso < 1.5,
                champions: topChampWR >= 52,
                stoploss:  maxLoss < 5,
                volume:    recentGPD <= 2.0,
                wards:     avgCW >= 5,
                deaths:    avgDeaths <= 5.5,
                lategame:  parseFloat(wrLate) >= 55,
                csmin:     avgCSMin >= 6.0,
                streak:    streakType === 'W' || streak < 3,
                baron:     parseFloat(wr1pBaron) >= 70,
                // New goals
                kp:        avgKP >= 48,
                vision:    avgVS >= 40,
                wardclear: avgWC >= 3.5,
                turrets:   avgTurrets >= 0.8,
                multikill: doubleRate >= 35,
                firstblood: fbRate >= 12,
                steals:    parseFloat(stealsPerGame) >= 0.1,
                schedule:  playingInGoodHours,
            };

            const achievedCount = Object.values(goals).filter(Boolean).length;
            const totalCount    = Object.keys(goals).length;

            // ── Build tasks ────────────────────────────────────────────────
            const needsList = [], goodList = [];

            function push(task, achieved) {
                (achieved ? goodList : needsList).push(task);
            }

            // 1. Dragon Control
            push(buildTask({
                id:'dragon', priority: goals.dragon ? 'good' : 'critical', achieved: goals.dragon, stagger:0,
                title: 'Dragon Control',
                pill:  `${teamDrakeAvg.toFixed(1)} drakes/game`,
                quickTip: goals.dragon
                    ? `Great drake control. Keep pathing bot-side before every 5:00 spawn.`
                    : `Path bot-side at 4:45 every game and place a control ward in the pit.`,
                progressPct: clamp((teamDrakeAvg/3)*100,0,100),
                progressLabel: `Target: 3+ drakes · you: ${teamDrakeAvg.toFixed(1)}`,
                stats: [
                    {label:'Avg Drakes/game',value:teamDrakeAvg.toFixed(1)},
                    {label:'WR (0 drakes)',  value:wr0Drake+'%'},
                    {label:'WR (3+ drakes)', value:wr3pDrake+'%'},
                    {label:'WR (Soul)',       value:wr4Drake+'%'},
                    {label:'First Drake avg', value:avgFirstDrake+' min'},
                    {label:'Pre-15 Drake',    value:pre15Pct.toFixed(0)+'%'},
                ],
                insight: `Team averages ${teamDrakeAvg.toFixed(1)} drakes/game. WR with 0 drakes: ${wr0Drake}% — nearly unwinnable. WR with 3+ drakes: ${wr3pDrake}%. WR at Soul (4): ${wr4Drake}%. First drake secured pre-15 in ${pre15Pct.toFixed(0)}% of sampled games (avg ${avgFirstDrake} min).`,
                action: `Clear camps bot-side first, arrive at dragon pit at 4:45–5:00. If enemy jungler is spotted top-side, immediately call dragon. Buy a control ward on every back and place it in the pit. Treat 3 drakes as a win condition — group for it even if behind.`,
            }), goals.dragon);

            // 2. Early Game
            const gd15Str = avgGD15 != null ? (avgGD15 >= 0 ? '+' : '') + Math.round(avgGD15) : 'N/A';
            push(buildTask({
                id:'earlygame', priority: goals.earlygame ? 'good' : 'critical', achieved: goals.earlygame, stagger:1,
                title: 'Early Game (GD@15)',
                pill:  `${gd15Str} gold at 15`,
                quickTip: goals.earlygame
                    ? `Early game is solid. Maintain efficient pathing and counter-tracking.`
                    : `Full clear before ganking. Track enemy jungle — only invade when you know where they are.`,
                progressPct: avgGD15 != null ? clamp(50 + avgGD15/20, 0, 100) : 50,
                progressLabel: `Target: ≥ −100 gold · you: ${gd15Str}`,
                stats: [
                    {label:'Avg GD@15',    value:gd15Str},
                    {label:'Ahead at 15',  value:aheadPct.toFixed(0)+'%'},
                    {label:'Behind at 15', value:behindPct.toFixed(0)+'%'},
                    {label:'WR when ahead',value:wrAhead+'%'},
                    {label:'WR when behind',value:wrBehind+'%'},
                ],
                insight: `You average ${gd15Str} gold at 15 min. You start behind (< −200 gold) in ${behindPct.toFixed(0)}% of games and ahead in only ${aheadPct.toFixed(0)}%. When ahead at 15: ${wrAhead}% WR. When behind: ${wrBehind}% WR. Your Apr–Jun GD@15 was −475 vs −81 in Jan–Mar.`,
                action: `Prioritise full camp clears before ganking for efficient XP/gold. At 3:15 check the enemy's opposite buff to track their start. Only invade if you can confirm their location. Avoid desperate early ganks — your Nocturne spike is Level 6, not Level 3.`,
            }), goals.earlygame);

            // 3. Isolated Deaths
            push(buildTask({
                id:'isolated', priority: goals.isolated ? 'good' : 'critical', achieved: goals.isolated, stagger:2,
                title: 'Isolated Deaths',
                pill:  `${avgIso.toFixed(2)}/game`,
                quickTip: goals.isolated
                    ? `Dying alone is under control. Keep warding before entering enemy territory.`
                    : `Never enter enemy jungle without a ward showing their position first.`,
                progressPct: clamp((1-avgIso/3)*100,0,100),
                progressLabel: `Target: < 1.0/game · you: ${avgIso.toFixed(2)}`,
                stats: [
                    {label:'Avg isolated deaths',  value:avgIso.toFixed(2)+'/game'},
                    {label:'WR (0 isolated)',       value:wr0Iso+'%'},
                    {label:'WR (2+ isolated)',      value:wr2pIso+'%'},
                ],
                insight: `You die alone ${avgIso.toFixed(2)}x per game. 61.7% of your deaths are in enemy territory — you're invading without tracking information. WR with 0 isolated deaths: ${wr0Iso}% vs 2+ isolated: ${wr2pIso}%. 64.4% of all deaths happen within 90s of a major objective.`,
                action: `Before crossing the river, place a ward showing the enemy jungler isn't on that side. If your Nocturne ult is on cooldown, don't fight — your kill threat is dramatically reduced. When setting up objectives, send teammates to ward; don't go alone.`,
            }), goals.isolated);

            // 4. Champion Pool
            const champHasBetter = bestChamp && topChamp && bestChamp.name !== topChamp.name && bestChamp.wr > topChamp.wr + 0.08;
            push(buildTask({
                id:'champions', priority: goals.champions ? 'good' : 'warning', achieved: goals.champions, stagger:3,
                title: 'Champion Pool',
                pill:  topChamp ? `${topChamp.name} ${topChampWR.toFixed(0)}%WR` : 'N/A',
                quickTip: champHasBetter
                    ? `Play more ${bestChamp.name} (${(bestChamp.wr*100).toFixed(0)}%WR) — significantly outperforms your main.`
                    : goals.champions
                    ? `Strong win rate on your main. Stay focused on depth over breadth.`
                    : `Narrow pool to 2-3 picks. Avoid champions with <40% WR over 5+ games.`,
                progressPct: clamp(topChampWR*2-50,0,100),
                progressLabel: `Target: 55%+ WR on main · you: ${topChampWR.toFixed(0)}%`,
                stats: champList.sort((a,b)=>b.games-a.games).slice(0,5).map(c=>({
                    label: c.name,
                    value: `${c.games}g · ${(c.wr*100).toFixed(0)}%WR`
                })),
                insight: champHasBetter
                    ? `Most-played: ${topChamp.name} (${topChamp.games}g, ${topChampWR.toFixed(0)}%WR). But ${bestChamp.name} has ${(bestChamp.wr*100).toFixed(0)}%WR over ${bestChamp.games} games — a clear upgrade. Your champion pool data suggests a shift is warranted.`
                    : `Most-played: ${topChamp?.name || 'N/A'} (${topChamp?.games || 0}g, ${topChampWR.toFixed(0)}%WR). ${topChampWR >= 55 ? 'Above 55% — keep spamming.' : 'Below 55% — consider adjusting your pool.'}`,
                action: champHasBetter
                    ? `Prioritise ${bestChamp.name} when the matchup is viable. Keep ${topChamp.name} as the fallback. Champions you consistently lose on (sub-40% WR, 5+ games) should be benched entirely this season.`
                    : `Depth beats breadth in ranked. Pick 2 champions maximum and learn every matchup on them. Avoid first-timing champions in ranked.`,
            }), goals.champions);

            // 5. Stop-Loss
            push(buildTask({
                id:'stoploss', priority: goals.stoploss ? 'good' : 'warning', achieved: goals.stoploss, stagger:4,
                title: 'Stop-Loss Rule',
                pill:  `Max ${maxLoss}-game streak`,
                quickTip: goals.stoploss
                    ? `Good mental discipline. Keep the 2-loss rule in place.`
                    : `After 2 consecutive losses, close the client for the day — no exceptions.`,
                progressPct: clamp((1-maxLoss/10)*100,0,100),
                progressLabel: `Target: ≤ 3 max · you: ${maxLoss}`,
                stats: [
                    {label:'Longest loss streak', value:maxLoss+' games'},
                    {label:'Longest win streak',  value:maxWin+' games'},
                    {label:'Season WR',            value:overallWR.toFixed(1)+'%'},
                    {label:'Jan–Mar WR',           value:'65.2%'},
                    {label:'Apr–Jun WR',           value:'41.8%'},
                ],
                insight: `Your longest loss streak this season is ${maxLoss} games. The Apr–Jun WR collapse (41.8% vs 65.2% in Jan–Mar) correlates directly with increased game volume and unchecked loss streaks. Playing through tilts costs LP and mental bandwidth.`,
                action: `Hard rule: 2 losses in a row = done for the day. Cap yourself at 3 games per session maximum. Before queuing, check your mental state — if you're frustrated from the previous game, take 20 minutes first. Loss streaks rarely reverse mid-session.`,
            }), goals.stoploss);

            // 6. Volume
            push(buildTask({
                id:'volume', priority: goals.volume ? 'good' : 'warning', achieved: goals.volume, stagger:5,
                title: 'Game Volume',
                pill:  `${recentGPD.toFixed(1)}/day (30d)`,
                quickTip: goals.volume
                    ? `Healthy volume. Consistency beats grinding.`
                    : `You're playing too many games per day — quality is dropping with quantity.`,
                progressPct: clamp((2-recentGPD)/2*100,0,100),
                progressLabel: `Target: ≤ 2/day · you: ${recentGPD.toFixed(1)}/day`,
                stats: [
                    {label:'Recent 30d avg',   value:recentGPD.toFixed(2)+'/day'},
                    {label:'Season avg',        value:seasonGPD.toFixed(2)+'/day'},
                    {label:'Games (30d)',        value:recentRows.length+''},
                    {label:'Peak WR months',    value:'0.51/day @ 65%+WR'},
                ],
                insight: `You've played ${recentRows.length} games in the last 30 days (${recentGPD.toFixed(1)}/day). Your highest WR months (Jan–Mar) averaged 0.51 games/day. More games without fixing fundamentals accelerates LP loss, not gain.`,
                action: `3 games per day maximum. On days off from playing, watch 1 replay with a specific focus question: "Where did I die that I shouldn't have?" — one learning per review. Rest days improve your next session more than extra ranked games.`,
            }), goals.volume);

            // 7. Control Wards
            push(buildTask({
                id:'wards', priority: goals.wards ? 'good' : 'warning', achieved: goals.wards, stagger:6,
                title: 'Control Wards',
                pill:  `${avgCW.toFixed(1)} avg/game`,
                quickTip: goals.wards
                    ? `Good ward discipline. Keep placing one in the dragon pit at 4:00.`
                    : `Buy a control ward on every back. Place it in the dragon or baron pit.`,
                progressPct: clamp((avgCW/8)*100,0,100),
                progressLabel: `Target: 6+ /game · you: ${avgCW.toFixed(1)}`,
                stats: [
                    {label:'Avg/game',     value:avgCW.toFixed(1)},
                    {label:'WR (≤2 wards)',value:wr1_2CW+'%'},
                    {label:'WR (6+ wards)',value:wr6pCW+'%'},
                ],
                insight: `You average ${avgCW.toFixed(1)} control wards/game. Games with ≤2: ${wr1_2CW}% WR. Games with 6+: ${wr6pCW}% WR. Control wards deny enemy objective vision and reveal enemy wards — directly impacting dragon and baron fights.`,
                action: `Buy a control ward on every base recall, especially when you have gold left over after item components. Rotate: dragon pit at 4:00 → river brush → baron pit after 20 min. Never buy a ward before your item component — item first, ward second.`,
            }), goals.wards);

            // 8. Deaths
            push(buildTask({
                id:'deaths', priority: goals.deaths ? 'good' : 'warning', achieved: goals.deaths, stagger:7,
                title: 'Deaths Per Game',
                pill:  `${avgDeaths.toFixed(1)} avg`,
                quickTip: goals.deaths
                    ? `Death count is acceptable. Focus on the quality of trades, not just avoiding fights.`
                    : `Before each fight: "Can I win this?" — if unsure, disengage.`,
                progressPct: clamp((7-avgDeaths)/5*100,0,100),
                progressLabel: `Target: < 5.0 · you: ${avgDeaths.toFixed(1)}`,
                stats: [
                    {label:'Avg deaths',      value:avgDeaths.toFixed(1)},
                    {label:'WR (0–2 deaths)', value:wr0_2D+'%'},
                    {label:'WR (7+ deaths)',  value:wr7pD+'%'},
                    {label:'Deaths in wins',  value:avg(rows.filter(r=>r.win).map(r=>r.deaths)).toFixed(1)},
                    {label:'Deaths in losses',value:avg(rows.filter(r=>!r.win).map(r=>r.deaths)).toFixed(1)},
                ],
                insight: `You average ${avgDeaths.toFixed(1)} deaths/game. WR with 0–2 deaths: ${wr0_2D}% vs 7+ deaths: ${wr7pD}%. In wins you die ${avg(rows.filter(r=>r.win).map(r=>r.deaths)).toFixed(1)}x vs ${avg(rows.filter(r=>!r.win).map(r=>r.deaths)).toFixed(1)}x in losses. Each death in jungle = lost camp timers, lost pathing, and a bounty given.`,
                action: `Trade efficiency over trade frequency. As a jungler, your death resets enemy camp timers in their favour. When losing lane pressure, don't force ganks — farm your jungle and look for counter-jungle instead. A low-death game with 60% KP beats a high-kill game with 8 deaths.`,
            }), goals.deaths);

            // 9. Late Game
            push(buildTask({
                id:'lategame', priority: goals.lategame ? 'good' : 'info', achieved: goals.lategame, stagger:8,
                title: 'Late Game Strength',
                pill:  `${wrLate}% WR (35m+)`,
                quickTip: goals.lategame
                    ? `You're a strong late-game player. Avoid forcing early — let the game come to you.`
                    : `Your WR improves the longer the game goes. Survive early, scale up.`,
                progressPct: clamp(parseFloat(wrLate)*2-50,0,100),
                progressLabel: `Target: 60%+ WR at 35m · you: ${wrLate}%`,
                stats: [
                    {label:'WR (<25 min)',  value:wrShort+'%'},
                    {label:'WR (35+ min)',  value:wrLate+'%'},
                    {label:'Avg game len',  value:avg(rows.map(r=>r.gameDuration/60)).toFixed(0)+' min'},
                    {label:'Long games',    value:lateRows.length+''},
                ],
                insight: `Short games (<25 min): ${wrShort}% WR. Long games (35+ min): ${wrLate}% WR. Your champion pool (Nocturne, Leblanc) scales well into mid-to-late game. Trying to close games early is working against your natural strengths.`,
                action: `Stop chasing early kills — farm efficiently and group around objectives at 20 minutes. When ahead, take inhib towers over chasing kills. Nocturne's power at 3 items is significantly higher than at 1 — trust the scale. When behind, stall by split-pushing and wait for baron/dragon rotations.`,
            }), goals.lategame);

            // 10. CS/min
            push(buildTask({
                id:'csmin', priority: goals.csmin ? 'good' : 'warning', achieved: goals.csmin, stagger:9,
                title: 'CS / Minute',
                pill:  `${avgCSMin.toFixed(2)} CS/min`,
                quickTip: goals.csmin
                    ? `CS rate is solid. Keep clearing camps on your way between objectives.`
                    : `After every gank (successful or not), immediately clear the nearest camp.`,
                progressPct: clamp((avgCSMin/7.5)*100,0,100),
                progressLabel: `Target: 6.5+ CS/min · you: ${avgCSMin.toFixed(2)}`,
                stats: [
                    {label:'Avg CS/min',    value:avgCSMin.toFixed(2)},
                    {label:'In wins',       value:avg(csRows.filter(r=>r.win).map(r=>r.totalMinionsKilled/(r.gameDuration/60))).toFixed(2)},
                    {label:'In losses',     value:avg(csRows.filter(r=>!r.win).map(r=>r.totalMinionsKilled/(r.gameDuration/60))).toFixed(2)},
                    {label:'Best months',   value:'6.7+ CS/min'},
                ],
                insight: `Current ${avgCSMin.toFixed(2)} CS/min vs 6.7+ in Jan–Mar. Jungle CS includes monster camps — low CS/min means you're leaving gold on the table either through missed camps or inefficient pathing routes between ganks.`,
                action: `After every gank attempt, return to clear the nearest camp — never leave camps alive near your path. Track your camp reset timer: most reset every 2 minutes. A clean full clear before 3:30 sets a strong tempo for the first dragon and early ganks.`,
            }), goals.csmin);

            // 11. Streak momentum
            const streakEmoji = streakType === 'W' ? '🔥' : streak >= 3 ? '❄️' : '⚠️';
            push(buildTask({
                id:'streak', priority: goals.streak ? 'good' : (streak>=3?'critical':'warning'), achieved: goals.streak, stagger:10,
                title: `${streakEmoji} Current Momentum`,
                pill:  `${streak}${streakType} in a row`,
                quickTip: streakType === 'W'
                    ? `Win streak active — keep your routine, don't change what's working.`
                    : streak >= 3
                    ? `${streak}-game loss streak. Stop for today — come back tomorrow.`
                    : `Minor slump. Take a 20-min break before your next game.`,
                progressPct: streakType === 'W' ? clamp(streak/5*100,0,100) : clamp((5-streak)/5*100,0,100),
                progressLabel: streakType === 'W' ? `${streak} wins — keep it going` : `${streak} losses — consider stopping`,
                stats: [
                    {label:'Current streak',      value:streak+streakType},
                    {label:'Longest win streak',  value:maxWin+'W'},
                    {label:'Longest loss streak', value:maxLoss+'L'},
                    {label:'Season WR',            value:overallWR.toFixed(1)+'%'},
                ],
                insight: streakType === 'W'
                    ? `You're on a ${streak}-game win streak. Momentum is real in ranked — your decision-making improves when confident. Protect this by not experimenting with off-picks.`
                    : `${streak} consecutive losses. This is exactly when the stop-loss rule kicks in. Continuing to play through a slump almost always extends it.`,
                action: streakType === 'W'
                    ? `Protect the streak: play your 2 best champions only, stick to your routine, cap at 3 games today regardless of result.`
                    : streak >= 3
                    ? `Close the client now. Return tomorrow with fresh focus. Review 1 game VOD during the break — not to tilt further, but to identify one clear pattern.`
                    : `Take 20–30 minutes off, get water, reset. Then decide: am I calm enough to play well? If yes, play 1 more max.`,
            }), goals.streak);

            // 12. Baron
            push(buildTask({
                id:'baron', priority: goals.baron ? 'good' : 'info', achieved: goals.baron, stagger:11,
                title: 'Baron Control',
                pill:  `${wr1pBaron}% WR w/ Baron`,
                quickTip: goals.baron
                    ? `Baron conversion rate is excellent. Maintain smite priority as jungler.`
                    : `Group at 19:30 with vision set before attempting baron.`,
                progressPct: clamp(parseFloat(wr1pBaron)*2-50,0,100),
                progressLabel: `Target: 80%+ WR · you: ${wr1pBaron}%`,
                stats: [
                    {label:'WR (0 Barons)', value:wr0Baron+'%'},
                    {label:'WR (1+ Baron)', value:wr1pBaron+'%'},
                ],
                insight: `WR with Baron: ${wr1pBaron}% vs without: ${wr0Baron}%. Baron is the single biggest mid-to-late win condition. Missing baron or trading it gives opponents a free power play that can flip a winning game.`,
                action: `When baron spawns at 20 min, group at 19:30. Clear vision around the pit (sweeper + plant 2 wards). As jungler, smite is YOUR call — hover it from 50% baron HP. Never attempt baron without seeing at least 3 enemies.`,
            }), goals.baron);

            // 13. Kill Participation
            push(buildTask({
                id:'kp', priority: goals.kp ? 'good' : 'warning', achieved: goals.kp, stagger:12,
                title: 'Kill Participation',
                pill: `${avgKP.toFixed(0)}% KP avg`,
                quickTip: goals.kp
                    ? `Good fight presence. Keep rotating between camps and skirmishes.`
                    : `After clearing a camp, immediately check for nearby fight opportunities before farming the next one.`,
                progressPct: clamp((avgKP/60)*100, 0, 100),
                progressLabel: `Target: 48%+ KP · you: ${avgKP.toFixed(0)}%`,
                stats: [
                    {label:'Avg KP',          value: avgKP.toFixed(0)+'%'},
                    {label:'WR (KP <40%)',     value: wrKPLow+'%'},
                    {label:'WR (KP 55%+)',     value: wrKPHigh+'%'},
                    {label:'KP in wins',       value: (avg(kpRows.filter(r=>r.win).map(r=>(r.kills+r.assists)/r.teamKills))*100).toFixed(0)+'%'},
                    {label:'KP in losses',     value: (avg(kpRows.filter(r=>!r.win).map(r=>(r.kills+r.assists)/r.teamKills))*100).toFixed(0)+'%'},
                ],
                insight: `Your average KP is ${avgKP.toFixed(0)}%. Games with KP below 40%: ${wrKPLow}% WR. Games with 55%+ KP: ${wrKPHigh}% WR. As a jungler a low KP means you're farming between camps while your team fights — missing fight impact and snowball opportunities.`,
                action: `After each camp clear, glance at the minimap. If a lane is showing a fight (pings, low HP icons), path there immediately. Nocturne with ult should always be in range for a game-changing flank. Prioritize being in the right place at the right time over optimally farming every camp.`,
            }), goals.kp);

            // 14. Vision Score
            push(buildTask({
                id:'vision', priority: goals.vision ? 'good' : 'warning', achieved: goals.vision, stagger:13,
                title: 'Vision Score',
                pill: `${avgVS.toFixed(0)} avg vision`,
                quickTip: goals.vision
                    ? `Strong vision game. Keep sweeping objectives before contesting them.`
                    : `Place wards on every back rotation — river, enemy jungle entrance, dragon/baron pit.`,
                progressPct: clamp((avgVS/55)*100, 0, 100),
                progressLabel: `Target: 40+ vision score · you: ${avgVS.toFixed(0)}`,
                stats: [
                    {label:'Avg vision score',  value: avgVS.toFixed(0)},
                    {label:'WR (VS <30)',        value: wrVSLow+'%'},
                    {label:'WR (VS 45+)',        value: wrVSHigh+'%'},
                    {label:'Wards placed/game', value: avg(rows.map(r=>r.wardsPlaced||0)).toFixed(1)},
                    {label:'Wards cleared/game',value: avgWC.toFixed(1)},
                ],
                insight: `Your average vision score is ${avgVS.toFixed(0)}. WR with vision score below 30: ${wrVSLow}%. WR with 45+: ${wrVSHigh}%. Vision score captures ward placement, ward denial, and trinket usage — it's a composite metric that directly reflects how much map information you're generating.`,
                action: `On every base recall, buy a control ward and use your trinket before walking back to lane. Place wards in high-traffic corridors: river bushes, jungle entrances, tri-bush. As jungler, sweep baron and dragon pit before every objective attempt — one hidden ward can cost you a game.`,
            }), goals.vision);

            // 15. Ward Clearing (Anti-Vision)
            push(buildTask({
                id:'wardclear', priority: goals.wardclear ? 'good' : 'warning', achieved: goals.wardclear, stagger:14,
                title: 'Enemy Ward Clearing',
                pill: `${avgWC.toFixed(1)} cleared/game`,
                quickTip: goals.wardclear
                    ? `Good at denying enemy vision. Keep sweeping objective areas.`
                    : `Use your sweeper before every dragon/baron — one uncleaned ward costs objectives.`,
                progressPct: clamp((avgWC/6)*100, 0, 100),
                progressLabel: `Target: 3.5+ cleared/game · you: ${avgWC.toFixed(1)}`,
                stats: [
                    {label:'Avg cleared/game',  value: avgWC.toFixed(1)},
                    {label:'WR (≤1 cleared)',    value: wrWCLow+'%'},
                    {label:'WR (4+ cleared)',    value: wrWCHigh+'%'},
                ],
                insight: `You clear ${avgWC.toFixed(1)} enemy wards per game. WR when clearing ≤1: ${wrWCLow}% vs 4+: ${wrWCHigh}%. Enemy wards in your jungle tip off your pathing, warn them of gank approaches, and let them safely contest objectives. Clearing them is free information denial.`,
                action: `Upgrade to Oracle Lens (sweeper) at level 9 or after first item. Before every dragon and baron attempt: activate sweeper and walk through the area. Make it a ritual — sweeper → plant control ward → take objective. Path through river brushes regularly to clear wards passively.`,
            }), goals.wardclear);

            // 16. Turret Participation
            push(buildTask({
                id:'turrets', priority: goals.turrets ? 'good' : 'info', achieved: goals.turrets, stagger:15,
                title: 'Turret Participation',
                pill: `${avgTurrets.toFixed(2)} towers/game`,
                quickTip: goals.turrets
                    ? `Good tower conversion. Keep grouping after winning objectives.`
                    : `After winning a teamfight or securing an objective, immediately push the nearest lane.`,
                progressPct: clamp((avgTurrets/1.5)*100, 0, 100),
                progressLabel: `Target: 0.8+ towers/game · you: ${avgTurrets.toFixed(2)}`,
                stats: [
                    {label:'Avg towers/game',   value: avgTurrets.toFixed(2)},
                    {label:'WR (0 towers)',      value: wrNoTurrets+'%'},
                    {label:'WR (2+ towers)',     value: wrTurretsHi+'%'},
                    {label:'Total this season',  value: rows.reduce((s,r)=>s+(r.turretKills||0),0)+''},
                ],
                insight: `You average ${avgTurrets.toFixed(2)} tower kills per game. WR with 0 personal tower kills: ${wrNoTurrets}% vs 2+: ${wrTurretsHi}%. Tower damage represents macro pressure — being present when towers fall means you're converting advantages into permanent map control rather than reset farming.`,
                action: `After any won teamfight, don't reset immediately — push the closest tower first. After dragon, rotate to the nearest exposed turret. Nocturne's post-ult all-in pressure forces enemies to defend or die, which creates free tower time. Treat towers as objective checkpoints, not bonuses.`,
            }), goals.turrets);

            // 17. Multi-kill Carry Rate
            push(buildTask({
                id:'multikill', priority: goals.multikill ? 'good' : 'warning', achieved: goals.multikill, stagger:16,
                title: 'Multi-kill Carry Rate',
                pill: `${doubleRate.toFixed(0)}% games w/ double+`,
                quickTip: goals.multikill
                    ? `Good carry output — you're converting fights into multiple kills regularly.`
                    : `After getting first kill in a fight, immediately look for the follow-up — don't reset.`,
                progressPct: clamp((doubleRate/50)*100, 0, 100),
                progressLabel: `Target: 35%+ games with double kill · you: ${doubleRate.toFixed(0)}%`,
                stats: [
                    {label:'Games w/ double+',  value: gamesWithDouble+' ('+doubleRate.toFixed(0)+'%)'},
                    {label:'Total doubles',      value: totalDoubles+''},
                    {label:'Total triples',      value: totalTriples+''},
                    {label:'WR w/ double kill',  value: wrWithDouble+'%'},
                    {label:'WR w/o double kill', value: wrNoDouble+'%'},
                ],
                insight: `You get a double kill or better in ${doubleRate.toFixed(0)}% of games (${gamesWithDouble} games). WR in games with a double kill: ${wrWithDouble}% vs without: ${wrNoDouble}%. Multi-kills are the clearest sign you're carrying your team, not just participating.`,
                action: `After securing a kill, instead of backing, look for the nearest enemy to chain the kill — are they low? Are they running to you? Nocturne's post-ult damage is highest immediately after landing. Stay in fights longer when you're ahead. If you have Kraken Slayer, your next auto after a kill resets your burst window.`,
            }), goals.multikill);

            // 18. First Blood Priority
            push(buildTask({
                id:'firstblood', priority: goals.firstblood ? 'good' : 'info', achieved: goals.firstblood, stagger:17,
                title: 'First Blood Priority',
                pill: `${fbRate.toFixed(0)}% first blood rate`,
                quickTip: goals.firstblood
                    ? `You're getting first blood at a healthy rate — keep early aggression up.`
                    : `Invade level 1 or look for a level 3 gank on the weakest early lane.`,
                progressPct: clamp((fbRate/20)*100, 0, 100),
                progressLabel: `Target: 12%+ first blood rate · you: ${fbRate.toFixed(0)}%`,
                stats: [
                    {label:'Games w/ first blood', value: fbGames.length+' ('+fbRate.toFixed(0)+'%)'},
                    {label:'WR with first blood',   value: wrWithFB+'%'},
                    {label:'WR without',            value: wrNoFB+'%'},
                ],
                insight: `You secure first blood in ${fbRate.toFixed(0)}% of games. When you do: ${wrWithFB}% WR. Without: ${wrNoFB}% WR. First blood triggers a snowball — the killer gets gold, the victim gets a death timer. For a jungler, it usually means a successful Level 2-3 invade or early gank that converts.`,
                action: `At champion select, identify which enemy laner is gankable at level 2-3 (no escape, pushed up, your jungler can path there). Start on the side of the map closest to that lane. If the enemy jungler starts at their bot buff, their top side is exposed — consider a level 2 invade with your laners' help.`,
            }), goals.firstblood);

            // 19. Objective Steals
            push(buildTask({
                id:'steals', priority: goals.steals ? 'good' : 'info', achieved: goals.steals, stagger:18,
                title: 'Objective Steals',
                pill: `${stealsPerGame}/game avg`,
                quickTip: goals.steals
                    ? `You're actively contesting smite fights — great jungler skill.`
                    : `Practice smite timing: use it when the objective drops below your smite damage.`,
                progressPct: clamp((parseFloat(stealsPerGame)/0.2)*100, 0, 100),
                progressLabel: `Target: 0.1+ steals/game · you: ${stealsPerGame}`,
                stats: [
                    {label:'Total steals',      value: totalSteals+''},
                    {label:'Games with steal',   value: stealGames.length+' ('+stealRate.toFixed(0)+'%)'},
                    {label:'WR after steal',     value: wrWithSteal+'%'},
                    {label:'Steals/game avg',    value: stealsPerGame},
                ],
                insight: `You've stolen ${totalSteals} objectives this season across ${stealGames.length} games (WR: ${wrWithSteal}%). Objective steals are the ultimate high-risk, high-reward jungler skill — converting a losing objective fight into a win with a single smite.`,
                action: `Know your smite damage at all times (check in shop or item tooltip). When the enemy is taking baron/dragon, don't disengage — wait nearby with smite ready. Hover the objective. Time your smite to land at or just below your smite damage. If you die stealing it, it's often still worth it.`,
            }), goals.steals);

            // 20. Playing Schedule (Time of Day)
            push(buildTask({
                id:'schedule', priority: goals.schedule ? 'good' : 'warning', achieved: goals.schedule, stagger:19,
                title: 'Playing Schedule',
                pill: bestHour ? `Best: ${fmtHour(bestHour.hour)}` : 'Analysing...',
                quickTip: goals.schedule
                    ? `You're playing at your peak hours. Keep your sessions in this window.`
                    : `Your recent games are outside your best-performance window — shift your session time.`,
                progressPct: goals.schedule ? 85 : 30,
                progressLabel: bestHour ? `Peak: ${fmtHour(bestHour.hour)} (${(bestHour.wr*100).toFixed(0)}% WR)` : 'Need more data',
                stats: [
                    {label:'Best hour',          value: bestHour ? fmtHour(bestHour.hour)+' — '+(bestHour.wr*100).toFixed(0)+'%WR' : 'N/A'},
                    {label:'Worst hour',         value: worstHour ? fmtHour(worstHour.hour)+' — '+(worstHour.wr*100).toFixed(0)+'%WR' : 'N/A'},
                    {label:'Recent avg time',    value: fmtHour(avgRecentHour)},
                    {label:'Hours analysed',     value: hourList.length+''},
                ],
                insight: `Your best-performing time slot is ${bestHour ? fmtHour(bestHour.hour) : 'N/A'} (${bestHour ? (bestHour.wr*100).toFixed(0)+'%' : 'N/A'} WR over ${bestHour ? bestHour.games : 0} games). Your worst is ${worstHour ? fmtHour(worstHour.hour) : 'N/A'} (${worstHour ? (worstHour.wr*100).toFixed(0)+'%' : 'N/A'} WR). You've recently been playing around ${fmtHour(avgRecentHour)}.`,
                action: `Schedule your ranked sessions around your peak performance window. Avoid grinding late at night if your data shows worse results then — fatigue is a real performance factor. Play 1-2 games in your best slot rather than a full session in a suboptimal one.`,
            }), goals.schedule);

            // ── Build final HTML ──────────────────────────────────────────
            const total = needsList.length + goodList.length;
            const r     = 26, circ = (2 * Math.PI * r).toFixed(2);
            const offset = (circ * (1 - achievedCount / total)).toFixed(2);

            const html = `
            <div class="coaching-header">
                <div class="coaching-header-left">
                    <h2>🎯 Solo/Duo Coaching Board</h2>
                    <p>${N} games analysed · Season 2026 · Queue 420 only</p>
                </div>
                <button class="coaching-refresh-btn" onclick="window.renderCoachingPanel()">↻ Refresh</button>
            </div>

            <div class="coaching-overall-progress">
                <div class="coaching-progress-ring">
                    <svg width="64" height="64" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="${r}" fill="none"
                            stroke="rgba(255,255,255,0.08)" stroke-width="5"/>
                        <circle cx="32" cy="32" r="${r}" fill="none"
                            stroke="var(--accent-primary)" stroke-width="5"
                            stroke-linecap="round"
                            stroke-dasharray="${circ}"
                            stroke-dashoffset="${offset}"
                            id="coaching-ring-fill"
                            style="transition:stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)"/>
                    </svg>
                    <div class="coaching-progress-ring-text" id="coaching-ring-text">
                        ${achievedCount}<small>/${total}</small>
                    </div>
                </div>
                <div class="coaching-overall-info">
                    <h3>Goals Met This Season</h3>
                    <div class="coaching-overall-bar">
                        <div class="coaching-overall-bar-fill" id="coaching-bar-fill"
                            style="width:${total ? Math.round(achievedCount/total*100) : 0}%"></div>
                    </div>
                    <div class="coaching-overall-label" id="coaching-bar-label">
                        ${achievedCount} of ${total} targets reached — refresh after syncing new matches
                    </div>
                </div>
            </div>

            ${needsList.length ? `
            <div class="coaching-section-title">🔴 Needs Work — ${needsList.length} item${needsList.length!==1?'s':''}</div>
            ${needsList.join('')}` : ''}

            ${goodList.length ? `
            <div class="coaching-section-title">✅ Doing Well</div>
            ${goodList.join('')}` : ''}
            `;

            container.innerHTML = html;

            // Trigger confetti if all achieved
            if (achievedCount === total && total > 0) {
                setTimeout(() => {
                    const burst = document.createElement('div');
                    burst.className  = 'coaching-confetti-burst';
                    burst.textContent = '🏆';
                    document.body.appendChild(burst);
                    setTimeout(() => burst.remove(), 2100);
                }, 400);
            }

        } catch (err) {
            container.innerHTML = `<p style="color:var(--error);padding:40px;text-align:center">
                Error: ${err.message}</p>`;
            console.error('[CoachingPanel]', err);
        }
    };

    window.refreshCoachingPanel = window.renderCoachingPanel;

})();
