/**
 * syncPanel.js — Sync button, progress bar, and rate-limit cooldown.
 *
 * Calls window.loadMatchHistory and window.fetchAndDisplayRankData
 * (defined in renderer.js) at runtime so there are no circular deps.
 */

const { getPuuidByRiotId }    = require('../services/riotApi');
const {
    syncMatches,
    backfillTimelines,
    backfillAdvancedStats,
    fetchRanksForNewMatches
} = require('../services/matchService');
const { loadConfig } = require('../services/config');

let syncCooldownInterval = null;
let syncCooldownEnd      = 0;
const SYNC_COOLDOWN_SECONDS = 120; // matches Riot's 2-minute rate-limit window

// ---------------------------------------------------------------------------
// STATUS HELPER (forwards to renderer's showToast)
// ---------------------------------------------------------------------------
function updateStatus(type, title, message) {
    window.showToast(title, message, type === 'error' ? 5000 : 3000);
}

// ---------------------------------------------------------------------------
// BUTTON STATE
// ---------------------------------------------------------------------------
function setButtonLoading(loading) {
    const btn     = document.getElementById('syncBtn');
    const btnText = btn.querySelector('.btn-text');
    const btnIcon = btn.querySelector('.btn-icon');
    btn.disabled  = loading;
    if (loading) {
        btnIcon.innerHTML   = '<div class="spinner"></div>';
        btnText.textContent = 'Syncing...';
    } else {
        btnIcon.innerHTML   = '&#8635;';
        btnText.textContent = 'Sync Matches';
    }
}

function startSyncCooldown() {
    const btn     = document.getElementById('syncBtn');
    const btnText = btn.querySelector('.btn-text');
    const btnIcon = btn.querySelector('.btn-icon');

    syncCooldownEnd    = Date.now() + SYNC_COOLDOWN_SECONDS * 1000;
    btn.disabled       = true;
    btnIcon.innerHTML  = '&#9202;';

    function tick() {
        const remaining = Math.max(0, Math.ceil((syncCooldownEnd - Date.now()) / 1000));
        if (remaining <= 0) {
            clearInterval(syncCooldownInterval);
            syncCooldownInterval = null;
            btn.disabled         = false;
            btnIcon.innerHTML    = '&#8635;';
            btnText.textContent  = 'Sync Matches';
            return;
        }
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        btnText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    tick();
    syncCooldownInterval = setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// PROGRESS BAR
// ---------------------------------------------------------------------------
function updateProgress(current, total, stats) {
    const container = document.getElementById('progressContainer');
    const fill      = document.getElementById('progressFill');
    const count     = document.getElementById('progressCount');
    const details   = document.getElementById('progressDetails');

    container.classList.add('visible');
    fill.style.width  = (total > 0 ? (current / total) * 100 : 0) + '%';
    count.textContent = `${current} / ${total}`;

    if (stats && details) {
        details.style.display = 'block';
        document.getElementById('progressNew').textContent      = stats.new           || 0;
        document.getElementById('progressFiltered').textContent = stats.queueFiltered || 0;
        document.getElementById('progressExisting').textContent = stats.alreadyInDB   || 0;
    }
}

function hideProgress() {
    const container = document.getElementById('progressContainer');
    const fill      = document.getElementById('progressFill');
    const details   = document.getElementById('progressDetails');
    container.classList.remove('visible');
    fill.style.width = '0%';
    if (details) details.style.display = 'none';
}

// ---------------------------------------------------------------------------
// MAIN SYNC HANDLER
// ---------------------------------------------------------------------------
window.handleSync = async function () {
    const name = document.getElementById('gameName').value.trim();
    const tag  = document.getElementById('tagLine').value.trim();

    if (!name || !tag) {
        updateStatus('error', 'Missing Information', 'Please enter both your game name and tag');
        return;
    }
    if (syncCooldownInterval) {
        updateStatus('error', 'Cooldown Active', 'Please wait for the cooldown to finish');
        return;
    }

    setButtonLoading(true);

    try {
        updateStatus('loading', 'Finding Account', `Looking up ${name}#${tag}...`);
        const puuid = await getPuuidByRiotId(name, tag);

        // Fetch rank before heavy API calls to avoid rate-limit issues
        await window.fetchAndDisplayRankData();

        updateStatus('loading', 'Syncing Matches', 'Fetching your recent match history...');
        const result = await syncMatches(puuid, (current, total, status, stats) => {
            updateProgress(current, total, stats);
        });
        hideProgress();

        const backfillResult = await backfillTimelines((current, total) => {
            updateStatus('loading', 'Fetching Timelines', `${current}/${total} match timelines...`);
            updateProgress(current, total);
        });
        hideProgress();

        const advancedResult = await backfillAdvancedStats((current, total) => {
            updateStatus('loading', 'Computing Advanced Stats', `${current}/${total} matches...`);
            updateProgress(current, total);
        });
        hideProgress();

        let rankMsg = '';
        if (result.newMatchIds && result.newMatchIds.length > 0) {
            const rankResult = await fetchRanksForNewMatches(result.newMatchIds, (current, total) => {
                updateStatus('loading', 'Fetching Player Ranks', `${current}/${total} players...`);
                updateProgress(current, total);
            });
            hideProgress();
            rankMsg = rankResult.total > 0 ? `, ${rankResult.fetched} player ranks fetched` : '';
        }

        // Reload match history (skip rank fetch — already done above)
        await window.loadMatchHistory(true);

        const advancedMsg = advancedResult.total  > 0 ? `, ${advancedResult.updated} stats computed`   : '';
        const timelineMsg = backfillResult.total   > 0 ? `, ${backfillResult.updated} timelines added`  : '';
        updateStatus('success', 'Sync Complete', `${result.newMatches} new matches added${timelineMsg}${advancedMsg}${rankMsg}`);

        startSyncCooldown();

    } catch (err) {
        console.error('Sync error:', err);
        hideProgress();

        let errorMessage = err.message;
        if      (err.response?.status === 403) errorMessage = 'Invalid or expired API key';
        else if (err.response?.status === 404) errorMessage = 'Player not found. Check your Riot ID';
        else if (err.response?.status === 429) errorMessage = 'Rate limited. Please wait a moment';

        updateStatus('error', 'Sync Failed', errorMessage);
    } finally {
        if (!syncCooldownInterval) setButtonLoading(false);
    }
};

module.exports = { setButtonLoading, updateProgress, hideProgress };
