/**
 * teammatesPanel.js — the Teammates page (#11).
 *
 * Players you've had on your team in at least 3 games (current game-mode
 * filter, remakes excluded): games together, win rate, last played, and the
 * last 30 games as win/loss squares. Teammates come from matchService
 * loadTeammates (stored once per game); the numbers from services/teammates.js.
 */

const { loadTeammates } = require('../services/matchService');
const { teammateTable, MIN_GAMES } = require('../services/teammates');
const { timeAgo } = require('./matchCard');
const { escapeHtml } = require('./dom');
const { wrTextColor, LOW_SAMPLE } = require('./winRateColor');

let teammatesByMatch = null;     // filled on first open, extended for new games
let loading = null;

function pool() {
    if (Array.isArray(window.championPoolMatches)) return window.championPoolMatches;
    const all = window.matchesData || [];
    return typeof window.excludeRemakes === 'function' ? window.excludeRemakes(all) : all;
}

function render() {
    const host = document.getElementById('teammatesList');
    if (!host || !teammatesByMatch) return;
    const games = pool();
    const rows = teammateTable(games, teammatesByMatch);
    if (!rows.length) {
        host.innerHTML = `<div class="tm-empty">Nobody you've played ${MIN_GAMES}+ games with in the games the current filters show.</div>`;
        return;
    }
    host.innerHTML = `
        <table class="tm-table">
            <thead><tr><th>Player</th><th class="num">Games together</th><th class="num">Win rate</th>
                <th class="num">Last played</th><th>Recent games together (oldest → newest)</th></tr></thead>
            <tbody>${rows.map(r => {
                const hash = r.name.lastIndexOf('#');
                const nameHtml = hash > 0
                    ? `${escapeHtml(r.name.slice(0, hash))}<span class="tm-tag">#${escapeHtml(r.name.slice(hash + 1))}</span>`
                    : escapeHtml(r.name);
                return `
                <tr class="${r.games < LOW_SAMPLE ? 'is-low' : ''}">
                    <td class="tm-name">${nameHtml}</td>
                    <td class="num">${r.games}</td>
                    <td class="num"><b style="color:${wrTextColor(r.winRate)}">${Math.round(r.winRate * 100)}%</b>
                        <span class="tm-wl">${r.wins}W ${r.games - r.wins}L</span></td>
                    <td class="num tm-dim">${escapeHtml(timeAgo(r.lastPlayed))}</td>
                    <td><div class="tm-strip">${r.strip.map(w => `<i class="${w ? 'w' : 'l'}" title="${w ? 'Win' : 'Loss'}"></i>`).join('')}</div></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
}

/** Called by switchTopTab('teammates'), and when the filters change. */
async function openTeammatesPanel() {
    const host = document.getElementById('teammatesList');
    if (!host) return;
    if (!teammatesByMatch || teammatesByMatch.size < (window.matchesData || []).length) {
        if (!loading) {
            host.innerHTML = '<div class="tm-empty">Reading your teammates from your games…</div>';
            loading = loadTeammates((done, total) => {
                host.innerHTML = `<div class="tm-empty">Reading your teammates from your games… ${done}/${total}</div>`;
            }).then(map => { teammatesByMatch = map; })
              .catch(e => { console.warn('Teammates unavailable:', e.message); teammatesByMatch = teammatesByMatch || new Map(); })
              .finally(() => { loading = null; });
        }
        await loading;
    }
    render();
}

window.openTeammatesPanel = openTeammatesPanel;

module.exports = { openTeammatesPanel };
