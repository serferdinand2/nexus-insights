/**
 * filtersPanel.js — Queue / champion filter state and trend indicators.
 *
 * Exports `activeQueueFilters` (shared Set) so renderer.js can read it
 * inside renderFilteredMatches without going through window.*.
 * Mutating functions are exposed on window for HTML onclick attributes.
 */

// ---------------------------------------------------------------------------
// FILTER STATE
// ---------------------------------------------------------------------------
const activeQueueFilters = new Set();

function initializeFilters() {
    document.querySelectorAll('.queue-filter').forEach(checkbox => {
        checkbox.dataset.queue.split(',').map(q => parseInt(q)).forEach(q => activeQueueFilters.add(q));
    });
}

window.toggleAllFilters = function () {
    const allCheckbox = document.getElementById('filter-all');
    document.querySelectorAll('.queue-filter').forEach(cb => { cb.checked = allCheckbox.checked; });
    window.applyFilters();
};

window.clearGameModeFilters = function () {
    document.getElementById('filter-all').checked = false;
    document.querySelectorAll('.queue-filter').forEach(cb => { cb.checked = false; });
    window.applyFilters();
};

window.applyFilters = function () {
    const allCheckbox = document.getElementById('filter-all');
    activeQueueFilters.clear();
    let allChecked = true;

    document.querySelectorAll('.queue-filter').forEach(checkbox => {
        if (checkbox.checked) {
            checkbox.dataset.queue.split(',').map(q => parseInt(q)).forEach(q => activeQueueFilters.add(q));
        } else {
            allChecked = false;
        }
    });

    allCheckbox.checked = allChecked;
    window.displayedMatchCount = 50;
    window.renderFilteredMatches();
};

// ---------------------------------------------------------------------------
// CHAMPION DROPDOWN
// ---------------------------------------------------------------------------

function updateChampionDropdown(matches) {
    const select       = document.getElementById('champFilter');
    const currentValue = select.value;
    const champions    = [...new Set(matches.map(m => m.championName).filter(Boolean))].sort();

    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = ''; allOpt.textContent = 'All Champions';
    select.appendChild(allOpt);

    const noneOpt = document.createElement('option');
    noneOpt.value = '__none__'; noneOpt.textContent = 'None (Clear Filter)';
    select.appendChild(noneOpt);

    const sepOpt = document.createElement('option');
    sepOpt.disabled = true; sepOpt.textContent = '──────────';
    select.appendChild(sepOpt);

    champions.forEach(champ => {
        const count = matches.filter(m => m.championName === champ).length;
        const opt   = document.createElement('option');
        opt.value   = champ;
        opt.textContent = `${champ} (${count})`;
        if (champ === currentValue) opt.selected = true;
        select.appendChild(opt);
    });

    if (currentValue && currentValue !== '__none__' && !champions.includes(currentValue)) {
        select.value = '';
    }
}

// ---------------------------------------------------------------------------
// TREND INDICATORS
// ---------------------------------------------------------------------------

function updateTrendIndicators(filteredMatches, baselineStats) {
    const NOISE_THRESHOLD_PCT = 0.03; // 3 % for normalized stats
    const NOISE_THRESHOLD_PP  = 2;    // 2 pp  for percentage-point stats

    const trendIds = [
        'avgCsDiff15Trend', 'avgGoldDiff15Trend', 'avgXpDiff15Trend',
        'firstBloodRateTrend', 'avgDmgGoldRatioTrend', 'avgIsolatedDeathsTrend',
        'avgObjectiveRateTrend'
    ];

    if (filteredMatches.length < 11) {
        trendIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
        return;
    }

    // Last 10 matches, ordered oldest→newest for weighting
    const recentMatches = filteredMatches.slice(0, 10).reverse();

    function weightedAvg(values) {
        if (values.length === 0) return null;
        let wSum = 0, wTotal = 0;
        values.forEach((v, i) => { const w = i + 1; wSum += v * w; wTotal += w; });
        return wSum / wTotal;
    }

    function getRecentValues(matches, field, isBoolField = false) {
        const out = [];
        matches.forEach(m => {
            const val = m[field];
            if (val !== null && val !== undefined) out.push(isBoolField ? val : parseFloat(val));
        });
        return out;
    }

    const trendConfig = [
        { field: 'csDiff15',       baselineKey: 'avgCsDiff15',       trendId: 'avgCsDiff15Trend',       calcType: 'normalizedPct', isInverted: false },
        { field: 'goldDiff15',     baselineKey: 'avgGoldDiff15',     trendId: 'avgGoldDiff15Trend',     calcType: 'normalizedPct', isInverted: false },
        { field: 'xpDiff15',       baselineKey: 'avgXpDiff15',       trendId: 'avgXpDiff15Trend',       calcType: 'normalizedPct', isInverted: false },
        { field: 'firstBlood',     baselineKey: 'firstBloodRate',    trendId: 'firstBloodRateTrend',    calcType: 'delta',         isInverted: false, isBoolField: true },
        { field: 'dmgGoldRatio',   baselineKey: 'avgDmgGoldRatio',   trendId: 'avgDmgGoldRatioTrend',   calcType: 'normalizedPct', isInverted: false },
        { field: 'isolatedDeaths', baselineKey: 'avgIsolatedDeaths', trendId: 'avgIsolatedDeathsTrend', calcType: 'normalizedPct', isInverted: true  },
        { field: 'objectiveRate',  baselineKey: 'avgObjectiveRate',  trendId: 'avgObjectiveRateTrend',  calcType: 'delta',         isInverted: false  }
    ];

    trendConfig.forEach(({ field, baselineKey, trendId, calcType, isInverted, isBoolField }) => {
        const el = document.getElementById(trendId);
        if (!el) return;

        const baselineVal = baselineStats[baselineKey];
        if (baselineVal === null || baselineVal === undefined) {
            el.innerHTML = ''; el.className = 'stat-trend-indicator'; return;
        }

        const recentValues = getRecentValues(recentMatches, field, isBoolField);
        if (recentValues.length === 0) {
            el.innerHTML = ''; el.className = 'stat-trend-indicator'; return;
        }

        // Weighted recent average (R)
        const R = isBoolField ? weightedAvg(recentValues) * 100 : weightedAvg(recentValues);
        const B = parseFloat(baselineVal);

        let trend, displayText;
        if (calcType === 'delta') {
            trend       = R - B;
            displayText = trend === 0 ? '0pp' : (trend > 0 ? `+${trend.toFixed(0)}pp` : `${trend.toFixed(0)}pp`);
        } else {
            trend = B === 0 ? (R === 0 ? 0 : (R > 0 ? 1 : -1)) : (R - B) / Math.abs(B);
            displayText = trend === 0 ? '0%' : (trend > 0 ? `+${(trend * 100).toFixed(0)}%` : `${(trend * 100).toFixed(0)}%`);
        }

        if (isInverted) trend *= -1;

        const threshold = calcType === 'delta' ? NOISE_THRESHOLD_PP : NOISE_THRESHOLD_PCT;
        let state, arrow;
        if (Math.abs(trend) < threshold) {
            state = 'neutral';     arrow = '→'; displayText = calcType === 'delta' ? '0pp' : '0%';
        } else if (trend > 0) {
            state = 'improvement'; arrow = '↑';
        } else {
            state = 'decline';     arrow = '↓';
        }

        el.className = `stat-trend-indicator ${state}`;
        el.innerHTML = `<span class="trend-arrow">${arrow}</span><span class="trend-percent">${displayText}</span>`;
    });
}

module.exports = { activeQueueFilters, initializeFilters, updateChampionDropdown, updateTrendIndicators };
