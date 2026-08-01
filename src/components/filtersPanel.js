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

module.exports = { activeQueueFilters, initializeFilters, updateChampionDropdown };
