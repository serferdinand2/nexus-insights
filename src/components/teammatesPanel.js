/**
 * teammatesPanel.js — the Teammates page (#11).
 *
 * Players you've had on your team in at least 3 games (current game-mode
 * filter, remakes excluded): games together, win rate, wins, losses, last
 * played, and the last 30 games as win/loss squares. Every column but the
 * last two sorts on click (#30). Teammates come from matchService
 * loadTeammates (stored once per game); the numbers from services/teammates.js.
 */

const { loadTeammates } = require('../services/matchService');
const { teammateTable, sortTeammates, SORT_KEYS, MIN_GAMES } = require('../services/teammates');
const { timeAgo } = require('./matchCard');
const { escapeHtml } = require('./dom');
const { wrTextColor, LOW_SAMPLE } = require('./winRateColor');

let teammatesByMatch = null;     // filled on first open, extended for new games
let loading = null;

// Kept while the app runs, so a filter change doesn't reset it
const sort = { key: 'games', dir: 'desc' };

const COLUMNS = [
    { key: 'name',    label: 'Player' },
    { key: 'games',   label: 'Games together', num: true },
    { key: 'winRate', label: 'Win rate',       num: true },
    { key: 'wins',    label: 'Wins',           num: true },
    { key: 'losses',  label: 'Losses',         num: true },
    { label: 'Last played',                    num: true },
    { label: 'Recent games together (oldest → newest)' },
];

function header() {
    return COLUMNS.map(c => {
        const cls = [c.num ? 'num' : '', c.key ? 'tm-sortable' : '', c.key && sort.key === c.key ? 'sorted' : '']
            .filter(Boolean).join(' ');
        if (!c.key) return `<th${cls ? ` class="${cls}"` : ''}>${c.label}</th>`;
        const on = sort.key === c.key;
        const arrow = on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
        const aria = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        return `<th class="${cls}" data-sort="${c.key}" aria-sort="${aria}" tabindex="0">${c.label}${arrow}</th>`;
    }).join('');
}

function wire(host) {
    if (host.dataset.wired) return;
    host.dataset.wired = '1';
    const pick = (th) => {
        const key = th.dataset.sort;
        if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        else { sort.key = key; sort.dir = SORT_KEYS[key]; }
        render();
    };
    host.addEventListener('click', e => { const th = e.target.closest('th[data-sort]'); if (th) pick(th); });
    host.addEventListener('keydown', e => {
        const th = e.target.closest('th[data-sort]');
        if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(th); }
    });
}

function pool() {
    if (Array.isArray(window.championPoolMatches)) return window.championPoolMatches;
    const all = window.matchesData || [];
    return typeof window.excludeRemakes === 'function' ? window.excludeRemakes(all) : all;
}

function render() {
    const host = document.getElementById('teammatesList');
    if (!host || !teammatesByMatch) return;
    const games = pool();
    wire(host);
    const rows = sortTeammates(teammateTable(games, teammatesByMatch), sort.key, sort.dir, { minGames: LOW_SAMPLE });
    if (!rows.length) {
        host.innerHTML = `<div class="tm-empty">Nobody you've played ${MIN_GAMES}+ games with in the games the current filters show.</div>`;
        return;
    }
    host.innerHTML = `
        <table class="tm-table">
            <thead><tr>${header()}</tr></thead>
            <tbody>${rows.map(r => {
                const hash = r.name.lastIndexOf('#');
                const nameHtml = hash > 0
                    ? `${escapeHtml(r.name.slice(0, hash))}<span class="tm-tag">#${escapeHtml(r.name.slice(hash + 1))}</span>`
                    : escapeHtml(r.name);
                return `
                <tr class="${r.games < LOW_SAMPLE ? 'is-low' : ''}">
                    <td class="tm-name">${nameHtml}</td>
                    <td class="num">${r.games}</td>
                    <td class="num"><b style="color:${wrTextColor(r.winRate)}">${Math.round(r.winRate * 100)}%</b></td>
                    <td class="num">${r.wins}</td>
                    <td class="num">${r.losses}</td>
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
