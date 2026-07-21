/**
 * calendarPanel.js — Activity calendar, time-of-day insights, and LP progression charts.
 * Reads window.matchesData at call-time for match data.
 */

const { saveLpSnapshot, seedLpSnapshot, getLpHistory } = require('../services/matchService');

// ---------------------------------------------------------------------------
// CALENDAR NAVIGATION STATE  (module-scoped — only used by this file)
// ---------------------------------------------------------------------------
let calendarYear  = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-11

const CAL_MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];

// ---------------------------------------------------------------------------
// LP PROGRESSION CONSTANTS
// ---------------------------------------------------------------------------

// Historical Solo/Duo snapshots (INSERT OR IGNORE — will never overwrite live data)
const SOLO_LP_SEED = [
    { date: '2026-01-30', tier: 'PLATINUM', rank: 'IV', lp: 86 },
    { date: '2026-02-21', tier: 'PLATINUM', rank: 'II', lp: 76 },
    { date: '2026-03-01', tier: 'PLATINUM', rank: 'II', lp: 76 },
    { date: '2026-03-08', tier: 'PLATINUM', rank: 'II', lp: 76 },
    { date: '2026-03-20', tier: 'PLATINUM', rank: 'I',  lp: 26 },
    { date: '2026-03-22', tier: 'PLATINUM', rank: 'I',  lp: 26 },
    { date: '2026-03-30', tier: 'EMERALD',  rank: 'IV', lp: 1  },
    { date: '2026-04-05', tier: 'EMERALD',  rank: 'IV', lp: 1  },
    { date: '2026-04-15', tier: 'EMERALD',  rank: 'IV', lp: 16 },
    { date: '2026-04-19', tier: 'EMERALD',  rank: 'IV', lp: 3  },
    { date: '2026-04-29', tier: 'EMERALD',  rank: 'IV', lp: 48 },
    { date: '2026-05-08', tier: 'EMERALD',  rank: 'IV', lp: 56 },
    { date: '2026-05-10', tier: 'EMERALD',  rank: 'IV', lp: 56 },
    { date: '2026-05-16', tier: 'EMERALD',  rank: 'IV', lp: 56 },
    { date: '2026-05-17', tier: 'EMERALD',  rank: 'IV', lp: 39 },
    { date: '2026-05-18', tier: 'EMERALD',  rank: 'IV', lp: 45 },
    { date: '2026-05-19', tier: 'EMERALD',  rank: 'IV', lp: 51 },
];

const LP_TIER_NAMES = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND'];
const LP_TIER_SHORT = { IRON:'I', BRONZE:'B', SILVER:'S', GOLD:'G', PLATINUM:'P', EMERALD:'E', DIAMOND:'D', MASTER:'M', GRANDMASTER:'GM', CHALLENGER:'C' };
const LP_RANK_ORDER = { IV:0, III:1, II:2, I:3 };
const LP_RANK_SHORT = { IV:'4', III:'3', II:'2', I:'1' };

function getLpAbsolute(tier, rank, lp) {
    const ti = LP_TIER_NAMES.indexOf((tier || '').toUpperCase());
    if (ti === -1) return lp;
    return ti * 400 + (LP_RANK_ORDER[rank] ?? 0) * 100 + (lp || 0);
}

function getLpPointLabel(tier, rank, lp) {
    const s = LP_TIER_SHORT[(tier || '').toUpperCase()] || tier;
    const r = LP_RANK_SHORT[rank] || rank;
    return `${s}${r} ${lp}LP`;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// CALENDAR HELPERS
// ---------------------------------------------------------------------------

function getDayColor(wins, losses) {
    const total = wins + losses;
    if (total === 0) return 'rgba(255,255,255,0.03)';
    const wr = wins / total;
    if (wr >= 0.55)   { const i = Math.min(total/10,1); return `hsl(168, ${50+i*30}%, ${40-i*15}%)`; }
    if (wr <= 0.45)   { const i = Math.min(total/10,1); return `hsl(0,   ${50+i*30}%, ${40-i*15}%)`; }
    return `rgba(255,255,255,${Math.min(0.2 + total * 0.05, 0.6)})`;
}

function updateCalPickerLabels() {
    const ml = document.getElementById('calMonthLabel');
    const yl = document.getElementById('calYearLabel');
    if (ml) ml.textContent = CAL_MONTHS[calendarMonth];
    if (yl) yl.textContent = calendarYear;
}

// Exposed on window so renderer.js can call it after filter changes
window.renderCalendarMonthView = function renderCalendarMonthView(matchesOverride) {
    const matchesData = matchesOverride || window.matchesData || [];
    const grid        = document.getElementById('calendarMonthGrid');
    if (!grid) return;
    grid.innerHTML = '';
    updateCalPickerLabels();

    // Aggregate wins/losses per date for this month
    const matchesByDate = {};
    let totalWins = 0, totalLosses = 0;

    matchesData.forEach(m => {
        const d = new Date(m.gameCreation);
        if (d.getFullYear() !== calendarYear || d.getMonth() !== calendarMonth) return;
        const dateStr = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!matchesByDate[dateStr]) matchesByDate[dateStr] = { wins: 0, losses: 0, total: 0 };
        matchesByDate[dateStr].total++;
        if (m.win) { matchesByDate[dateStr].wins++; totalWins++; }
        else       { matchesByDate[dateStr].losses++; totalLosses++; }
    });

    const firstDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth    = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const totalCells     = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
        const dayNum = i - firstDayOfWeek + 1;
        const cell   = document.createElement('div');
        cell.className = 'cal-month-cell';

        if (dayNum < 1 || dayNum > daysInMonth) {
            cell.classList.add('cal-month-cell-empty');
        } else {
            const dateStr = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
            const stats   = matchesByDate[dateStr];

            const numEl = document.createElement('span');
            numEl.className   = 'cal-month-cell-num';
            numEl.textContent = dayNum;
            cell.appendChild(numEl);

            if (stats) {
                cell.style.background = getDayColor(stats.wins, stats.losses);
                cell.title = `${dateStr}: ${stats.wins}W ${stats.losses}L (${stats.total} game${stats.total !== 1 ? 's' : ''})`;
                const badge = document.createElement('span');
                badge.className   = 'cal-month-cell-badge';
                badge.textContent = stats.total;
                cell.appendChild(badge);
            } else {
                cell.style.background = 'rgba(255,255,255,0.04)';
            }
        }
        grid.appendChild(cell);
    }

    const summaryEl = document.getElementById('calendarSummary');
    if (summaryEl) {
        const monthName = CAL_MONTHS[calendarMonth];
        summaryEl.textContent = totalWins + totalLosses > 0
            ? `${totalWins + totalLosses} matches in ${monthName} — ${totalWins}W / ${totalLosses}L`
            : `No matches in ${monthName} ${calendarYear}`;
        summaryEl.style.color = 'rgba(255,255,255,0.4)';
    }
}

// ---------------------------------------------------------------------------
// MONTH / YEAR PICKER  (exposed on window for inline onclick)
// ---------------------------------------------------------------------------

window.toggleCalPicker = function (type) {
    const matchesData = window._calendarFilteredMatches || window.matchesData || [];
    const monthDrop   = document.getElementById('calMonthDropdown');
    const yearDrop    = document.getElementById('calYearDropdown');
    if (!monthDrop || !yearDrop) return;

    const targetDrop = type === 'month' ? monthDrop : yearDrop;
    const isOpen     = targetDrop.style.display === 'block';
    monthDrop.style.display = 'none';
    yearDrop.style.display  = 'none';
    if (isOpen) return;

    targetDrop.innerHTML = '';
    if (type === 'month') {
        CAL_MONTHS.forEach((name, i) => {
            const item = document.createElement('div');
            item.className   = 'cal-picker-item' + (i === calendarMonth ? ' active' : '');
            item.textContent = name;
            item.onclick = e => { e.stopPropagation(); calendarMonth = i; renderCalendarMonthView(); targetDrop.style.display = 'none'; };
            targetDrop.appendChild(item);
        });
    } else {
        const years = new Set(matchesData.map(m => new Date(m.gameCreation).getFullYear()));
        years.add(new Date().getFullYear());
        Array.from(years).sort((a, b) => b - a).forEach(y => {
            const item = document.createElement('div');
            item.className   = 'cal-picker-item' + (y === calendarYear ? ' active' : '');
            item.textContent = y;
            item.onclick = e => { e.stopPropagation(); calendarYear = y; renderCalendarMonthView(); targetDrop.style.display = 'none'; };
            targetDrop.appendChild(item);
        });
    }
    targetDrop.style.display = 'block';
};

// Close pickers when clicking outside
document.addEventListener('click', e => {
    if (!e.target.closest('#calMonthPicker') && !e.target.closest('#calYearPicker')) {
        const md = document.getElementById('calMonthDropdown');
        const yd = document.getElementById('calYearDropdown');
        if (md) md.style.display = 'none';
        if (yd) yd.style.display = 'none';
    }
});

// ---------------------------------------------------------------------------
// INIT (called by renderer.js after matches load)
// ---------------------------------------------------------------------------

window.initCalendar = function (matchesOverride) {
    const matchesData = matchesOverride || window.matchesData || [];
    // Store so toggleCalPicker (year/month dropdown) uses the same filtered set
    window._calendarFilteredMatches = matchesData;
    const allDates    = matchesData.map(m => new Date(m.gameCreation));
    if (allDates.length > 0) {
        const mostRecent = new Date(Math.max(...allDates));
        calendarYear  = mostRecent.getFullYear();
        calendarMonth = mostRecent.getMonth();
    } else {
        calendarYear  = new Date().getFullYear();
        calendarMonth = new Date().getMonth();
    }
    const wrapper = document.getElementById('calendarWrapper');
    // .ta-panel is a block container (title stacked above .ta-body).
    // Setting 'flex' here turned it into a flex ROW, which pulled the panel
    // title into its own sidebar column and squeezed the body.
    if (wrapper) wrapper.style.display = 'block';
    window.renderCalendarMonthView(matchesData);
    if (matchesData.length > 0) window.calculateTimeInsights(matchesData);
    window.renderLpCharts().catch(e => console.warn('LP chart render failed:', e));
};

// ---------------------------------------------------------------------------
// LP PROGRESSION CHARTS
// ---------------------------------------------------------------------------

/**
 * Seed historical LP snapshots. These are INSERT OR IGNORE, so re-running is
 * harmless — but it used to run on EVERY chart render (18 sequential DB
 * round-trips each time the calendar redrew, which is every filter change).
 * Now it runs at most once per session and every later call reuses the promise.
 */
let lpSeedPromise = null;

function seedLpHistoryOnce() {
    if (lpSeedPromise) return lpSeedPromise;

    lpSeedPromise = (async () => {
        await Promise.all(
            SOLO_LP_SEED.map(pt => seedLpSnapshot('solo', pt.tier, pt.rank, pt.lp, pt.date))
        );
        const flexHist = await getLpHistory('flex');
        if (flexHist.length === 0) {
            await seedLpSnapshot('flex', 'GOLD', 'I', 78, new Date().toISOString().slice(0, 10));
        }
    })().catch(e => {
        console.warn('LP seed failed:', e);
        lpSeedPromise = null; // allow a retry on the next render
    });

    return lpSeedPromise;
}

window.renderLpCharts = async function () {
    await seedLpHistoryOnce();
    await Promise.all([
        drawLpChart('lpChartSolo', 'solo', '#4fc3f7'),
        drawLpChart('lpChartFlex', 'flex', '#a78bfa'),
    ]);
};

async function drawLpChart(canvasId, queue, lineColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let history = [];
    try { history = await getLpHistory(queue); } catch (e) { return; }

    // Show only the most recent 10 snapshots
    history = history.slice(-10);

    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width, H = rect.height;
    const PAD = { top: 20, right: 16, bottom: 28, left: 34 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    if (history.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font      = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet', W / 2, H / 2 + 4);
        return;
    }

    const absLps = history.map(r => getLpAbsolute(r.tier, r.rank, r.lp));
    const minAbs = Math.max(0, Math.min(...absLps) - 30);
    const maxAbs = Math.max(...absLps) + 30;
    const range  = maxAbs - minAbs || 100;
    const n      = history.length;
    const toX    = i => PAD.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
    const toY    = v => PAD.top  + cH - ((v - minAbs) / range) * cH;

    // Tier / division grid lines
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    LP_TIER_NAMES.forEach((tier, ti) => {
        [0,1,2,3].forEach(ri => {
            const absLp = ti * 400 + ri * 100;
            if (absLp < minAbs || absLp > maxAbs) return;
            const y   = toY(absLp);
            const lbl = `${LP_TIER_SHORT[tier]}${4 - ri}`;
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.font      = '9px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(lbl, PAD.left - 4, y + 3.5);
        });
    });
    ctx.setLineDash([]);

    // Gradient fill under line
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, hexToRgba(lineColor, 0.20));
    grad.addColorStop(1, hexToRgba(lineColor, 0.0));

    if (n > 1) {
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(absLps[0]));
        for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(absLps[i]));
        ctx.lineTo(toX(n-1), PAD.top + cH);
        ctx.lineTo(toX(0),   PAD.top + cH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth   = 2;
        ctx.lineJoin    = 'round';
        ctx.moveTo(toX(0), toY(absLps[0]));
        for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(absLps[i]));
        ctx.stroke();
    }

    // Dots + point labels on first, last, and tier/rank changes
    history.forEach((r, i) => {
        const x = toX(i), y = toY(absLps[i]);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();

        const prev        = history[i - 1];
        const tierChanged = !prev || prev.tier !== r.tier || prev.rank !== r.rank;
        if (i === 0 || i === n - 1 || tierChanged) {
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.font      = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(getLpPointLabel(r.tier, r.rank, r.lp), x, y - 7);
        }
    });

    // X-axis date labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(cW / 50))));
    history.forEach((r, i) => {
        if (i === 0 || i === n - 1 || i % step === 0) {
            ctx.fillText(r.recorded_date.slice(5), toX(i), H - PAD.bottom + 11);
        }
    });
}

// ---------------------------------------------------------------------------
// TIME INSIGHTS
// ---------------------------------------------------------------------------

window.calculateTimeInsights = function (matches) {
    if (!matches || matches.length === 0) return;

    // ── Time-of-day buckets (4 broad slots) ──────────────────────────────────
    const timeBuckets = {
        'Morning':   { label: '6a – 12p', wins: 0, total: 0 },
        'Afternoon': { label: '12p – 5p', wins: 0, total: 0 },
        'Evening':   { label: '5p – 10p', wins: 0, total: 0 },
        'Night':     { label: '10p – 6a', wins: 0, total: 0 }
    };

    // ── Day-of-week ───────────────────────────────────────────────────────────
    const dayOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dayFull  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const dayMap   = {};
    dayOrder.forEach(d => { dayMap[d] = { wins: 0, total: 0 }; });

    // ── Game length buckets ───────────────────────────────────────────────────
    const lengthBuckets = [
        { label: '< 20m',  test: m => m.gameDuration < 1200,                                    wins: 0, total: 0 },
        { label: '20–25m', test: m => m.gameDuration >= 1200 && m.gameDuration < 1500,           wins: 0, total: 0 },
        { label: '25–30m', test: m => m.gameDuration >= 1500 && m.gameDuration < 1800,           wins: 0, total: 0 },
        { label: '30–35m', test: m => m.gameDuration >= 1800 && m.gameDuration < 2100,           wins: 0, total: 0 },
        { label: '35–40m', test: m => m.gameDuration >= 2100 && m.gameDuration < 2400,           wins: 0, total: 0 },
        { label: '> 40m',  test: m => m.gameDuration >= 2400,                                    wins: 0, total: 0 },
    ];

    // ── Session stamina ───────────────────────────────────────────────────────
    const chronMatches   = [...matches].reverse();
    let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
    let currentSession   = [];
    const sessions       = [];

    chronMatches.forEach(m => {
        if (m.win) { curWin++; curLoss = 0; if (curWin  > maxWin)  maxWin  = curWin;  }
        else       { curLoss++; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }

        const d    = new Date(m.gameCreation);
        const hour = d.getHours();

        // Time bucket
        let slot = 'Night';
        if      (hour >= 6  && hour < 12) slot = 'Morning';
        else if (hour >= 12 && hour < 17) slot = 'Afternoon';
        else if (hour >= 17 && hour < 22) slot = 'Evening';
        timeBuckets[slot].total++;
        if (m.win) timeBuckets[slot].wins++;

        // Day of week (Mon=0 … Sun=6 in dayOrder)
        const jsDay   = d.getDay(); // 0=Sun
        const dayIdx  = jsDay === 0 ? 6 : jsDay - 1; // remap to Mon-first
        const dayKey  = dayOrder[dayIdx];
        dayMap[dayKey].total++;
        if (m.win) dayMap[dayKey].wins++;

        // Game length
        lengthBuckets.forEach(b => { if (b.test(m)) { b.total++; if (m.win) b.wins++; } });

        // Session grouping
        if (currentSession.length === 0) {
            currentSession.push(m);
        } else {
            const last    = currentSession[currentSession.length - 1];
            const lastEnd = last.gameCreation + last.gameDuration * 1000;
            if (m.gameCreation - lastEnd <= 2 * 60 * 60 * 1000) { currentSession.push(m); }
            else { sessions.push(currentSession); currentSession = [m]; }
        }
    });
    if (currentSession.length > 0) sessions.push(currentSession);

    // Stamina buckets
    let fresh = {w:0,t:0}, warm = {w:0,t:0}, fat = {w:0,t:0};
    sessions.forEach(sess => {
        sess.forEach((m, i) => {
            const idx = i + 1;
            if      (idx <= 3) { fresh.t++; if (m.win) fresh.w++; }
            else if (idx <= 6) { warm.t++;  if (m.win) warm.w++;  }
            else               { fat.t++;   if (m.win) fat.w++;   }
        });
    });

    // ── Determine best / worst time slot (min 5 games) ───────────────────────
    let bestSlot = null, worstSlot = null, bestWR = -1, worstWR = 2;
    for (const [key, v] of Object.entries(timeBuckets)) {
        if (v.total < 5) continue;
        const wr = v.wins / v.total;
        if (wr > bestWR)  { bestWR  = wr; bestSlot  = key; }
        if (wr < worstWR) { worstWR = wr; worstSlot = key; }
    }

    // ── Populate Time of Day (dual best/worst) ────────────────────────────────
    const el = id => document.getElementById(id);
    if (el('bestTimeOfDay')) {
        el('bestTimeOfDay').textContent  = bestSlot  || 'N/A';
        el('bestTimeOfDaySub').textContent  = bestSlot
            ? `${Math.round(bestWR  * 100)}% WR · ${timeBuckets[bestSlot].label}`
            : 'Not enough data';
        el('worstTimeOfDay').textContent = worstSlot || 'N/A';
        el('worstTimeOfDaySub').textContent = worstSlot
            ? `${Math.round(worstWR * 100)}% WR · ${timeBuckets[worstSlot].label}`
            : 'Not enough data';
    }

    // ── Populate Day-of-Week bar chart ────────────────────────────────────────
    const dayChart = el('dayBarChart');
    if (dayChart) {
        const wrValues = dayOrder.map(d => dayMap[d].total > 0 ? dayMap[d].wins / dayMap[d].total : null);
        const validWRs = wrValues.filter(v => v !== null);
        const maxDayWR = validWRs.length ? Math.max(...validWRs) : 1;
        const minDayWR = validWRs.length ? Math.min(...validWRs) : 0;

        dayChart.innerHTML = dayOrder.map((day, i) => {
            const v   = dayMap[day];
            const wr  = v.total > 0 ? v.wins / v.total : null;
            const pct = wr !== null ? Math.round(wr * 100) : null;
            const barH = wr !== null ? Math.max(8, Math.round((wr / (maxDayWR || 1)) * 100)) : 0;

            // Colour: green for best, red for worst, gradient otherwise
            const isBest  = wr !== null && wr === maxDayWR && v.total >= 3;
            const isWorst = wr !== null && wr === minDayWR && v.total >= 3;
            let fillColor;
            if (isBest)       fillColor = 'rgba(74,222,128,0.75)';
            else if (isWorst) fillColor = 'rgba(248,113,113,0.75)';
            else if (wr !== null) {
                // Interpolate between red and green through teal
                const norm = maxDayWR > minDayWR ? (wr - minDayWR) / (maxDayWR - minDayWR) : 0.5;
                const h    = Math.round(norm * 140); // 0=red, 140=green
                fillColor  = `hsla(${h}, 65%, 52%, 0.7)`;
            } else {
                fillColor = 'rgba(255,255,255,0.05)';
            }

            const extraClass = isBest ? ' day-best' : isWorst ? ' day-worst' : '';
            return `
                <div class="day-bar-col${extraClass}">
                    <div class="day-bar-wr">${pct !== null ? pct + '%' : ''}</div>
                    <div class="day-bar-fill-wrap">
                        <div class="day-bar-fill" style="height:${barH}%;background:${fillColor};"></div>
                    </div>
                    <div class="day-bar-label">${day}</div>
                </div>`;
        }).join('');
    }

    // ── Populate Game Length bar chart ────────────────────────────────────────
    const lenChart = el('lengthBarChart');
    if (lenChart) {
        lenChart.innerHTML = lengthBuckets.map(b => {
            const wr     = b.total > 0 ? b.wins / b.total : null;
            const pct    = wr !== null ? Math.round(wr * 100) : null;
            const barW   = pct !== null ? pct : 0;
            // Colour by WR threshold
            let color;
            if (pct === null)   color = 'rgba(255,255,255,0.15)';
            else if (pct >= 60) color = 'rgba(74,222,128,0.75)';
            else if (pct >= 50) color = 'rgba(96,165,250,0.75)';
            else if (pct >= 40) color = 'rgba(251,191,36,0.75)';
            else                color = 'rgba(248,113,113,0.75)';

            const pctStr = pct !== null ? pct + '%' : '--';
            const pctColor = pct === null ? 'rgba(255,255,255,0.3)'
                           : pct >= 60    ? '#4ade80'
                           : pct >= 50    ? '#60a5fa'
                           : pct >= 40    ? '#fbbf24'
                           :                '#f87171';
            return `
                <div class="length-bar-row">
                    <span class="length-bar-label">${b.label}</span>
                    <div class="length-bar-track">
                        <div class="length-bar-fill" style="width:${barW}%;background:${color};"></div>
                    </div>
                    <span class="length-bar-pct" style="color:${pctColor}">${pctStr}</span>
                    <span class="length-bar-games">${b.total}g</span>
                </div>`;
        }).join('');
    }

    // ── Stamina + Streaks ─────────────────────────────────────────────────────
    if (el('staminaFresh')) {
        el('staminaFresh').textContent    = fresh.t > 0 ? `${Math.round((fresh.w/fresh.t)*100)}% WR` : '--';
        el('staminaWarm').textContent     = warm.t  > 0 ? `${Math.round((warm.w/warm.t)*100)}% WR`  : '--';
        el('staminaFatigued').textContent = fat.t   > 0 ? `${Math.round((fat.w/fat.t)*100)}% WR`   : '--';
        el('longestWinStreak').textContent  = maxWin  > 0 ? maxWin  : '--';
        el('longestLossStreak').textContent = maxLoss > 0 ? maxLoss : '--';
    }
};

module.exports = {};

