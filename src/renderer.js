// ============================================================
// IMPORTS — services (browser context, Node via nodeIntegration)
// ============================================================
const { getPuuidByRiotId } = window.require('./services/riotApi');
const {
    getMatches, getStats, getMatchById, getLeagueData,
    saveLpSnapshot, getMatchParticipantRanks,
    loadRawJson, clearJsonCache
} = window.require('./services/matchService');
const {
    renderMatchTable, renderMatchRows, getRankedStats
} = window.require('./components/tableRenderer');
const { loadGameData, getDDragonBase } = window.require('./services/dataDragon');
const { loadConfig, saveConfig, isConfigValid } = window.require('./services/config');

// ============================================================
// IMPORTS — UI component modules (self-register window.* as side-effects)
// ============================================================
window.require('./components/analyticsEngine');
window.require('./components/matchModal');    // registers openMatchModal, closeModal, toggleRowExpand
window.require('./components/syncPanel');     // registers handleSync
window.require('./components/calendarPanel'); // registers initCalendar, renderLpCharts, calculateTimeInsights, toggleCalPicker
window.require('./components/filtersPanel'); // registers applyFilters, toggleAllFilters, clearGameModeFilters
window.require('./components/coachingPanel'); // registers renderCoachingPanel

// Destructure named exports needed inside renderer.js itself
const {
    renderRunes, renderSummonerSpells, timeAgo, formatDamage, getChampionIcon
} = window.require('./components/matchCard');
const { initTooltips }              = window.require('./components/tooltipSystem');
const {
    activeQueueFilters, initializeFilters, updateChampionDropdown
} = window.require('./components/filtersPanel');

// ============================================================
// SHARED GLOBAL STATE  (window.* so component files can read/write them)
// ============================================================
window.matchesData         = [];
window.DDRAGON_BASE        = 'https://ddragon.leagueoflegends.com/cdn/25.S1.1';
window.QUEUE_NAMES         = {
    420: 'Ranked Solo',  440: 'Ranked Flex',
    400: 'Normal Draft', 430: 'Normal Blind',
    480: 'Swiftplay',   490: 'Quickplay',
    700: 'Clash'
};
window.selectedDates       = new Set(); // reserved for future calendar day-selection feature
window.displayedMatchCount = 50;
window.activeAnalyticsTab  = 'Overview';
window.currentFilteredMatches = [];
window.currentPreviousMatches = [];

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(title, message, duration = 3000) {
    const toast        = document.getElementById('toastNotification');
    const toastTitle   = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');
    toastTitle.textContent   = title;
    toastMessage.textContent = message || '';
    toast.classList.add('show');
    setTimeout(hideToast, duration);
}

function hideToast() {
    document.getElementById('toastNotification').classList.remove('show');
}

// Expose so syncPanel.js (and any future module) can call it
window.showToast = showToast;

// ============================================================
// SETUP / CONFIG MODAL
// ============================================================

function showSetupModal(isFirstTime = true) {
    const modal    = document.getElementById('setupModal');
    const title    = modal.querySelector('.setup-title');
    const subtitle = modal.querySelector('.setup-subtitle');
    const saveBtn  = document.getElementById('setupSaveBtn');

    if (isFirstTime) {
        title.textContent    = 'Welcome to Nexus Insights';
        subtitle.textContent = 'Enter your details to get started';
        saveBtn.textContent  = 'Save & Start';
    } else {
        title.textContent    = 'Settings';
        subtitle.textContent = 'Update your configuration';
        saveBtn.textContent  = 'Save Changes';
    }

    const config = loadConfig();
    document.getElementById('setupApiKey').value   = config.apiKey   || '';
    document.getElementById('setupGameName').value = config.gameName || '';
    document.getElementById('setupTagLine').value  = config.tagLine  || '';
    document.getElementById('setupRegion').value   = config.region   || 'europe';
    document.getElementById('setupPlatform').value = config.platform || 'euw1';
    document.getElementById('setupError').style.display = 'none';
    modal.classList.add('visible');
}

function hideSetupModal() {
    document.getElementById('setupModal').classList.remove('visible');
}

function openSettings() {
    showSetupModal(false);
}

window.hideSetupModal = hideSetupModal;
window.openSettings   = openSettings;

window.saveSetup = function () {
    const apiKey   = document.getElementById('setupApiKey').value.trim();
    const gameName = document.getElementById('setupGameName').value.trim();
    const tagLine  = document.getElementById('setupTagLine').value.trim();
    const region   = document.getElementById('setupRegion').value;
    const platform = document.getElementById('setupPlatform').value;
    const errorEl  = document.getElementById('setupError');

    if (!apiKey) {
        errorEl.textContent  = 'API Key is required. Get one from developer.riotgames.com';
        errorEl.style.display = 'block';
        return;
    }
    if (!gameName || !tagLine) {
        errorEl.textContent  = 'Summoner Name and Tag are required';
        errorEl.style.display = 'block';
        return;
    }

    if (saveConfig({ apiKey, gameName, tagLine, region, platform })) {
        hideSetupModal();
        document.getElementById('gameName').value = gameName;
        document.getElementById('tagLine').value  = tagLine;
        window.loadMatchHistory();
    } else {
        errorEl.textContent  = 'Failed to save configuration. Please try again.';
        errorEl.style.display = 'block';
    }
};

function checkConfigOnStartup() {
    const config = loadConfig();
    if (isConfigValid(config)) {
        document.getElementById('gameName').value = config.gameName;
        document.getElementById('tagLine').value  = config.tagLine;
        return true;
    }
    showSetupModal(true);
    return false;
}

// ============================================================
// RANKED STATS DISPLAY (fallback from DB stats if API fails)
// ============================================================
function displayRankedStats(allMatches) {
    const rankedStats = getRankedStats(allMatches);
    const soloStats   = rankedStats.solo;
    const flexStats   = rankedStats.flex;

    if (soloStats.totalMatches > 0) {
        document.getElementById('soloWins').textContent    = soloStats.wins;
        document.getElementById('soloLosses').textContent  = soloStats.losses;
        document.getElementById('soloWinRate').textContent = soloStats.winRate + '%';
    }
    if (flexStats.totalMatches > 0) {
        document.getElementById('flexWins').textContent    = flexStats.wins;
        document.getElementById('flexLosses').textContent  = flexStats.losses;
        document.getElementById('flexWinRate').textContent = flexStats.winRate + '%';
    }
}

// ============================================================
// RANK DATA — fetch from Riot API and update rank cards
// ============================================================
window.fetchAndDisplayRankData = async function () {
    try {
        const config = loadConfig();
        const name   = document.getElementById('gameName').value.trim() || config.gameName;
        const tag    = document.getElementById('tagLine').value.trim()  || config.tagLine;
        if (!name || !tag) return;

        const puuid      = await getPuuidByRiotId(name, tag);
        const leagueData = await getLeagueData(puuid);

        if (leagueData.solo) {
            const solo   = leagueData.solo;
            const soloWr = Math.round((solo.wins / (solo.wins + solo.losses)) * 100);
            document.getElementById('soloRankText').textContent = `${solo.tier} ${solo.rank} (${solo.leaguePoints} LP)`;
            document.getElementById('soloWins').textContent     = solo.wins;
            document.getElementById('soloLosses').textContent   = solo.losses;
            document.getElementById('soloWinRate').textContent  = soloWr + '%';
            document.getElementById('soloRankIcon').src         = `assets/ranks/emblem-${solo.tier.toLowerCase()}.png`;
            document.getElementById('rankedSoloCard').classList.remove('no-data');
            saveLpSnapshot('solo', solo.tier, solo.rank, solo.leaguePoints).catch(e => console.warn('LP save failed:', e));
        } else {
            document.getElementById('rankedSoloCard').classList.add('no-data');
        }

        if (leagueData.flex) {
            const flex   = leagueData.flex;
            const flexWr = Math.round((flex.wins / (flex.wins + flex.losses)) * 100);
            document.getElementById('flexRankText').textContent = `${flex.tier} ${flex.rank} (${flex.leaguePoints} LP)`;
            document.getElementById('flexWins').textContent     = flex.wins;
            document.getElementById('flexLosses').textContent   = flex.losses;
            document.getElementById('flexWinRate').textContent  = flexWr + '%';
            document.getElementById('flexRankIcon').src         = `assets/ranks/emblem-${flex.tier.toLowerCase()}.png`;
            document.getElementById('rankedFlexCard').classList.remove('no-data');
            saveLpSnapshot('flex', flex.tier, flex.rank, flex.leaguePoints).catch(e => console.warn('LP save failed:', e));
        } else {
            document.getElementById('rankedFlexCard').classList.add('no-data');
        }

        // Refresh LP charts after persisting new data
        if (typeof window.renderLpCharts === 'function') window.renderLpCharts();
    } catch (err) {
        console.error('Failed to fetch rank data:', err.message);
    }
};

// ============================================================
// MAIN FILTER COORDINATOR — renderFilteredMatches
// ============================================================
// Signature of the last set of filter inputs we rendered derived views for.
// Pagination doesn't change it, so growing the page no longer re-runs the
// analytics engine, the calendar and the time-insight pass.
let lastFilterSignature = null;

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.listOnly] - only touch the match list (pagination)
 * @param {boolean} [opts.append]   - append the new page instead of rebuilding
 */
window.renderFilteredMatches = async function (opts = {}) {
    const { listOnly = false, append = false } = opts;
    const matchList   = document.getElementById('matchList');
    const matchesData = window.matchesData || [];

    if (!matchesData || matchesData.length === 0) return;

    // Collect all queue IDs explicitly defined in filter checkboxes
    const allDefinedQueues = new Set();
    document.querySelectorAll('.queue-filter').forEach(cb => {
        cb.dataset.queue.split(',').map(q => parseInt(q)).forEach(q => allDefinedQueues.add(q));
    });

    // When "Other" (Special Modes) is checked, also include unknown queue IDs
    const otherCheckbox  = document.querySelector('.queue-filter[data-queue*="1020"]');
    const includeUnknown = otherCheckbox && otherCheckbox.checked;

    const queueFiltered = matchesData.filter(match =>
        activeQueueFilters.has(match.queueId) ||
        (includeUnknown && !allDefinedQueues.has(match.queueId))
    );

    const selectedChamp   = document.getElementById('champFilter').value;
    const filteredMatches = (selectedChamp && selectedChamp !== '__none__')
        ? queueFiltered.filter(match => match.championName === selectedChamp)
        : queueFiltered;

    // Calendar date filter (selectedDates is populated by future calendar-selection feature)
    const selectedDates      = window.selectedDates;
    const calFilteredMatches = selectedDates.size > 0
        ? filteredMatches.filter(m => {
            const d       = new Date(m.gameCreation);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            return selectedDates.has(dateStr);
          })
        : filteredMatches;

    // Compute previous period for trend comparison (calendar date ranges only)
    let previousMatches = [];
    if (selectedDates.size > 0) {
        const dates    = Array.from(selectedDates).map(d => new Date(d));
        const minDate  = new Date(Math.min(...dates));
        const maxDate  = new Date(Math.max(...dates));
        const rangeMs  = maxDate.getTime() - minDate.getTime() + (24 * 60 * 60 * 1000);
        const prevMaxDate = new Date(minDate.getTime() - 1);
        const prevMinDate = new Date(prevMaxDate.getTime() - rangeMs + 1);
        previousMatches = matchesData
            .filter(m => { const d = new Date(m.gameCreation); return d >= prevMinDate && d <= prevMaxDate; })
            .filter(match =>
                (activeQueueFilters.has(match.queueId) || (includeUnknown && !allDefinedQueues.has(match.queueId))) &&
                (!selectedChamp || selectedChamp === '__none__' || match.championName === selectedChamp)
            );
    }

    // Everything below the match list only depends on the FILTER inputs, not on
    // how many rows are currently paged in. Skip it when nothing filter-shaped
    // changed — this is what makes "Load 20 more" cheap.
    const signature = JSON.stringify({
        queues: [...activeQueueFilters].sort(),
        includeUnknown,
        champ: selectedChamp,
        dates: [...selectedDates].sort(),
        size: matchesData.length,
    });
    const filtersChanged = signature !== lastFilterSignature;

    if (!listOnly && filtersChanged) {
        lastFilterSignature = signature;

        updateChampionDropdown(queueFiltered);

        // Analytics always uses queue+champion filter — calendar selection is display-only
        window.renderAnalyticsTab(filteredMatches, []);

        // Keep Time Analytics (calendar, time-of-day, best day, stamina, streaks) in sync
        window._calendarFilteredMatches = filteredMatches;
        if (typeof window.renderCalendarMonthView === 'function') window.renderCalendarMonthView(filteredMatches);
        if (typeof window.calculateTimeInsights   === 'function') window.calculateTimeInsights(filteredMatches);

        document.getElementById('matchCountBadge').textContent =
            `${filteredMatches.length} ${filteredMatches.length === 1 ? 'match' : 'matches'}`;
    }

    const displayedMatchCount = window.displayedMatchCount;
    const pagedMatches = filteredMatches.slice(0, displayedMatchCount);
    const remaining    = filteredMatches.length - pagedMatches.length;

    // Only the rows we are about to draw need their rawJson (summoner spells)
    const tbody     = matchList.querySelector('.match-table tbody');
    const canAppend = append && tbody && tbody.children.length > 0 && tbody.children.length < pagedMatches.length;
    const newRows   = canAppend ? pagedMatches.slice(tbody.children.length) : pagedMatches;

    try {
        await loadRawJson(newRows.map(m => m.matchId));
    } catch (e) {
        console.warn('Could not preload match JSON for visible page:', e);
    }

    const rowArgs = [
        matchesData,
        window.DDRAGON_BASE,
        window.QUEUE_NAMES,
        getChampionIcon,
        timeAgo,
        formatDamage,
        renderRunes,
        renderSummonerSpells,
    ];

    if (canAppend) {
        // Growing the page — append only the new rows instead of rebuilding
        // (and destroying) every row already on screen.
        tbody.insertAdjacentHTML('beforeend', renderMatchRows(newRows, ...rowArgs));
    } else {
        matchList.innerHTML = renderMatchTable(pagedMatches, ...rowArgs);
    }

    const loadMoreBar  = document.getElementById('loadMoreBar');
    const loadMoreInfo = document.getElementById('loadMoreInfo');
    if (loadMoreBar) {
        if (remaining > 0) {
            loadMoreBar.style.display = 'flex';
            if (loadMoreInfo) loadMoreInfo.textContent = `Showing ${pagedMatches.length} of ${filteredMatches.length} matches`;
        } else {
            loadMoreBar.style.display = 'none';
        }
    }
};

// ============================================================
// LOAD MATCH HISTORY  (called on startup and after sync)
// ============================================================
window.loadMatchHistory = async function (skipRankFetch = false) {
    try {
        // Rows may have been rewritten by a sync/backfill — drop stale blobs
        // and force the next render to recompute every derived view.
        clearJsonCache();
        lastFilterSignature = null;

        const [matches, stats] = await Promise.all([getMatches(), getStats()]);

        window.matchesData = matches;

        if (activeQueueFilters.size === 0) initializeFilters();

        const config = loadConfig();
        if (!document.getElementById('gameName').value && config.gameName) {
            document.getElementById('gameName').value = config.gameName;
            document.getElementById('tagLine').value  = config.tagLine;
        }

        if (!skipRankFetch) await window.fetchAndDisplayRankData();

        if (matches.length > 0) {
            document.getElementById('unifiedStatsSection').style.display = 'block';
            document.getElementById('matchHistory').style.display        = 'block';
            if (typeof window.initCalendar === 'function') window.initCalendar();
            await window.renderFilteredMatches();
            showToast('Welcome Back', `${stats.totalMatches} matches loaded`);
        } else {
            showToast('Welcome', `Ready to sync matches for ${config.gameName || 'your account'}`);
        }
    } catch (err) {
        console.error('Failed to load matches:', err);
        showToast('Error', 'Failed to load match history: ' + err.message);
    }
};

// ============================================================
// ANALYTICS TAB RENDERER
// ============================================================
window.renderAnalyticsTab = async function (matches, previousMatches) {
    if (matches) {
        window.currentFilteredMatches = matches;
        window.currentPreviousMatches = previousMatches || [];
    } else {
        matches         = window.currentFilteredMatches || [];
        previousMatches = window.currentPreviousMatches || [];
    }

    const container = document.getElementById('analyticsCardsContainer');
    if (!container) return;

    const tabName = window.activeAnalyticsTab;

    // Pull in rawJson/timelineJson only if this tab actually needs them.
    // Done BEFORE any DOM mutation so the grid never flashes empty.
    if (typeof window.prefetchTabJson === 'function') {
        try {
            await window.prefetchTabJson(tabName, matches, previousMatches);
        } catch (e) {
            console.warn('Match JSON prefetch failed; stats may be partial:', e);
        }
        // A newer render started while we awaited — let that one win
        if (window.currentFilteredMatches !== matches || window.activeAnalyticsTab !== tabName) return;
    }

    const soloCard            = document.getElementById('rankedSoloCard');
    const flexCard            = document.getElementById('rankedFlexCard');
    const persistentContainer = document.getElementById('persistentRankCards');

    container.innerHTML = '';

    if (tabName === 'Overview') {
        if (soloCard) { soloCard.style.display = 'flex'; container.appendChild(soloCard); }
        if (flexCard) { flexCard.style.display = 'flex'; container.appendChild(flexCard); }
    } else {
        if (soloCard && persistentContainer) persistentContainer.appendChild(soloCard);
        if (flexCard && persistentContainer) persistentContainer.appendChild(flexCard);
    }

    const cards = window.computeTabStats(tabName, matches, previousMatches);

    cards.forEach(card => {
        const div     = document.createElement('div');
        div.className = 'unified-stat-card';
        const isRanked = card.benchmarkable && card.color && card.benchmarkRank !== 'unrated';

        if (isRanked) {
            div.style.borderTop  = `3px solid ${card.color}`;
            div.style.background = `linear-gradient(135deg, ${card.color}12 0%, ${card.color}06 100%), rgba(255,255,255,0.03)`;
            div.style.boxShadow  = `0 0 18px ${card.color}18`;
        } else if (card.benchmarkable) {
            div.style.borderTop = '3px solid rgba(255,255,255,0.12)';
        } else {
            div.style.borderTop = '3px solid rgba(255,255,255,0.06)';
        }

        const valueColor = isRanked ? ` style="color:${card.color}"` : '';
        const badgeLabel = card.benchmarkRank
            ? card.benchmarkRank.charAt(0).toUpperCase() + card.benchmarkRank.slice(1)
            : '';

        let html = `
            <div class="std-stat-header">
                <div class="std-stat-label" title="${card.label}">${card.label}</div>
                <div class="std-stat-type">${card.aggregationType}</div>
            </div>
            <div class="std-stat-value"${valueColor}>${card.displayValue}</div>`;

        if (card.benchmarkable && card.benchmarkRank) {
            const badgeBg = isRanked ? card.color : 'rgba(255,255,255,0.08)';
            html += `<div class="std-stat-badge" style="background:${badgeBg}">${badgeLabel}</div>`;
        }

        if (card.trend !== null) {
            let trendClass = 'std-trend-neutral', arrow = '−';
            if (card.isImproving === true)       { trendClass = 'std-trend-positive'; arrow = '▲'; }
            else if (card.isImproving === false)  { trendClass = 'std-trend-negative'; arrow = '▼'; }
            html += `
                <div class="std-stat-footer">
                    <span class="std-trend-val ${trendClass}"><span class="trend-arrow">${arrow}</span>${card.trend}</span>
                    <span class="std-trend-label">${card.trendLabel}</span>
                </div>`;
        }

        div.innerHTML = html;
        container.appendChild(div);
    });
};

// ============================================================
// PAGINATION
// ============================================================
window.loadMoreMatches = function () {
    window.displayedMatchCount += 50;
    // listOnly: the filter set is unchanged, so analytics/calendar/insights
    // don't need recomputing. append: keep the rows already rendered.
    window.renderFilteredMatches({ listOnly: true, append: true });
};

window.loadAllMatches = function () {
    window.displayedMatchCount = Infinity;
    window.renderFilteredMatches({ listOnly: true, append: true });
};

// ============================================================
// TOP-LEVEL TAB NAVIGATION (Analytics / Coaching)
// ============================================================
let coachingPanelLoaded = false;

window.switchTopTab = function (tab) {
    const analyticsTab = document.getElementById('analytics-tab');
    const coachingTab  = document.getElementById('coaching-tab');
    const navAnalytics = document.getElementById('navAnalytics');
    const navCoaching  = document.getElementById('navCoaching');

    if (tab === 'analytics') {
        analyticsTab.style.display = 'block';
        coachingTab.style.display  = 'none';
        navAnalytics.classList.add('active');
        navCoaching.classList.remove('active');
    } else {
        analyticsTab.style.display = 'none';
        coachingTab.style.display  = 'block';
        navAnalytics.classList.remove('active');
        navCoaching.classList.add('active');
        // Lazy-load coaching panel on first open
        if (!coachingPanelLoaded) {
            coachingPanelLoaded = true;
            if (typeof window.renderCoachingPanel === 'function') {
                window.renderCoachingPanel();
            }
        }
    }
};


document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeModal();
});

document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') window.handleSync();
});

// ============================================================
// ANALYTICS TAB CLICK LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.analytical-tab').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.analytical-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            window.activeAnalyticsTab = e.target.dataset.tab;
            window.renderAnalyticsTab();
        });
    });
});

// ============================================================
// STARTUP
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Random background
    const backgrounds = [
        'bandle city.png', 'bilgewater.png', 'demacia.png', 'freljord.png',
        'ionia.png', 'ixtal.png', 'noxus.png',
        'piltover.png', 'shadow isles.png', 'shurima.png', 'targon.png',
        'the void.png', 'zaun.png'
    ];
    const randomBg = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    const bgPath   = `./assets/backgrounds/${randomBg}`;
    document.body.style.backgroundImage    = `linear-gradient(rgba(15,15,18,0.85), rgba(15,15,18,0.85)), url('${bgPath}')`;
    document.body.style.backgroundRepeat   = 'no-repeat';
    document.body.style.backgroundPosition = 'center center';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundSize    = 'cover';

    const configValid = checkConfigOnStartup();

    try {
        await loadGameData();
        window.DDRAGON_BASE = getDDragonBase();
    } catch (err) {
        console.warn('Failed to load game data, tooltips will not work:', err);
    }

    initTooltips();

    if (configValid) await window.loadMatchHistory();
});
