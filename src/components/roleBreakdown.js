/**
 * roleBreakdown.js — the Roles table under the Overview cards (#10).
 *
 * One row per role you played with the current game-mode and champion
 * filters (all roles, even when the role filter has picked one, so you can
 * compare). Clicking a row filters Analytics to that role; clicking the
 * selected row again shows all roles.
 */

const { roleTable } = require('../services/championStats');
const { wrTextColor, LOW_SAMPLE } = require('./winRateColor');
const { escapeHtml } = require('./dom');

const ICONS = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'middle', BOTTOM: 'bottom', UTILITY: 'utility' };
const icon = role => (ICONS[role]
    ? `<img class="rb-icon" alt="" src="https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champ-select/global/default/svg/position-${ICONS[role]}.svg">`
    : '<span class="rb-icon"></span>');

const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
const num = (v, d = 1) => (v == null ? '–' : v.toFixed(d));

/**
 * @param {Array|null} matches  remakes excluded; null hides the table
 * @param {string|null} selectedRole
 */
function renderRoleBreakdown(matches, selectedRole) {
    const host = document.getElementById('roleBreakdown');
    if (!host) return;
    if (!matches || !matches.length) {
        host.innerHTML = '';
        host.hidden = true;
        return;
    }
    wire(host);
    host.hidden = false;

    const rows = roleTable(matches);
    const selected = rows.find(r => r.role === selectedRole);
    const sub = selected
        ? `Analytics is showing ${escapeHtml(selected.label)} games only. Click it again for all roles.`
        : 'Click a role to see Analytics for that role only.';

    host.innerHTML = `
        <div class="rb-head"><span class="rb-title">Roles</span><span class="rb-sub">${sub}</span></div>
        <table class="rb-table">
            <thead><tr><th>Role</th><th class="num">Games</th><th class="num">Played</th><th class="num">Win rate</th>
                <th class="num">KDA</th><th class="num">CS/min</th><th class="num">DMG/min</th><th class="num">KP</th></tr></thead>
            <tbody>${rows.map(r => `
                <tr class="${r.role === selectedRole ? 'selected' : ''}${r.role ? ' rb-pickable' : ''}${r.games < LOW_SAMPLE ? ' is-low' : ''}"
                    ${r.role ? `data-role="${escapeHtml(r.role)}"` : 'title="Games with no assigned position can\'t be filtered"'}>
                    <td><div class="rb-role">${icon(r.role)}<span>${escapeHtml(r.label)}</span></div></td>
                    <td class="num">${r.games}</td>
                    <td class="num">${pct(r.playRate)}</td>
                    <td class="num"><b style="color:${wrTextColor(r.winRate)}">${pct(r.winRate)}</b></td>
                    <td class="num">${num(r.kda, 2)}</td>
                    <td class="num">${num(r.csPerMin)}</td>
                    <td class="num">${r.dmgPerMin == null ? '–' : Math.round(r.dmgPerMin).toLocaleString('en-US')}</td>
                    <td class="num">${pct(r.kp)}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

function wire(host) {
    if (host.dataset.wired) return;
    host.dataset.wired = '1';
    host.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-role]');
        const select = document.getElementById('roleFilter');
        if (!tr || !select) return;
        const role = tr.dataset.role;
        select.value = select.value === role ? '' : role;
        if (typeof window.applyFilters === 'function') window.applyFilters();
    });
}

window.renderRoleBreakdown = renderRoleBreakdown;

module.exports = { renderRoleBreakdown };
