/**
 * periodFilter.js — the Analytics period dropdown and the "Win Rate by
 * Patch" card (#6). The rules live in services/patches.js.
 *
 * The dropdown sits with the game-mode filters and narrows every list the
 * filters feed (cards, calendar, time insights, Match History, Champions).
 */

const P = require('../services/patches');
const { wrColor, wrTextColor } = require('./winRateColor');
const { escapeHtml } = require('./dom');

const MAX_PATCH_OPTIONS = 12;
let builtFor = null;   // patch list the options were built from

/** (Re)build the options when the set of patches changes; keeps the pick. */
function updatePeriodDropdown(allMatches) {
    const select = document.getElementById('periodFilter');
    if (!select) return;
    const patches = P.patchList(allMatches);
    const key = patches.map(p => `${p.patch}:${p.games}`).join(',');
    if (key === builtFor) return;
    builtFor = key;

    const current = select.value;
    const opt = (value, text) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`;
    const newest = patches[0] ? ` (${patches[0].patch})` : '';
    select.innerHTML =
        opt('', 'All time') +
        (patches.length ? `<optgroup label="Patches">
            ${opt('patches:1', `Last patch${newest}`)}
            ${patches.length > 1 ? opt('patches:2', 'Last 2 patches') : ''}
            ${patches.length > 2 ? opt('patches:3', 'Last 3 patches') : ''}
            ${patches.slice(0, MAX_PATCH_OPTIONS).map(p => opt(`patch:${p.patch}`, `Patch ${p.patch} (${p.games})`)).join('')}
        </optgroup>` : '') +
        `<optgroup label="Time">${P.WINDOWS.map(([days, label]) => opt(`days:${days}`, label)).join('')}</optgroup>`;
    select.value = [...select.options].some(o => o.value === current) ? current : '';
}

/** The games inside the picked period. */
function applyPeriodFilter(matches) {
    const select = document.getElementById('periodFilter');
    return P.filterByPeriod(matches, select ? select.value : '');
}

/** Bars like "Win Rate by Game Length", one per patch, newest first. */
function renderPatchWinRates(matches) {
    const host = document.getElementById('patchBarChart');
    if (!host) return;
    const rows = P.patchWinRates(matches || [], 6);
    if (!rows.length) {
        host.innerHTML = '<div class="length-bar-row"><span class="length-bar-label">--</span>' +
            '<span class="length-bar-games">Patches show up once games are indexed</span></div>';
        return;
    }
    host.innerHTML = rows.map(r => {
        const pct = Math.round(r.winRate * 100);
        return `
            <div class="length-bar-row">
                <span class="length-bar-label">${escapeHtml(r.patch)}</span>
                <div class="length-bar-track">
                    <div class="length-bar-fill" style="width:${pct}%;background:${wrColor(r.winRate, { games: r.games })};"></div>
                </div>
                <span class="length-bar-pct" style="color:${wrTextColor(r.winRate)}">${pct}%</span>
                <span class="length-bar-games">${r.games}g</span>
            </div>`;
    }).join('');
}

window.updatePeriodDropdown = updatePeriodDropdown;
window.applyPeriodFilter = applyPeriodFilter;
window.renderPatchWinRates = renderPatchWinRates;

module.exports = { updatePeriodDropdown, applyPeriodFilter, renderPatchWinRates };
