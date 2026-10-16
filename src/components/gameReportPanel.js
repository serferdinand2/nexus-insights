/**
 * gameReportPanel.js — "Game report" in an expanded match row (#9).
 *
 * Went well / went wrong / blunders, and a table of 9 stats against your
 * season, this patch and the 7 days before, in the same queue and role.
 * Numbers from services/gameReport.js (pure, tested), which runs every
 * value through computeTabStats.
 */

const R = require('../services/gameReport');
const { escapeHtml } = require('./dom');
// The match table scrolls sideways; keep the report to its visible width
const { fitWidth } = require('./matchTimelineChart');

const ROLE = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };

function cell(c) {
    if (!c) return '<td class="num gr-none">–</td>';
    return `<td class="num gr-${c.verdict || 'even'}">${escapeHtml(c.display)}</td>`;
}

/**
 * @param {HTMLElement} host
 * @param {object} game       the light match row (window.matchesData)
 * @param {object} fullMatch  getMatchById row with rawJson / timelineJson parsed
 */
function renderGameReport(host, game, fullMatch) {
    if (!host || !game || typeof window.computeTabStats !== 'function') return;
    const isRemake = typeof window.isRemake === 'function' ? window.isRemake(game) : (game.gameDuration || 0) < 300;
    if (isRemake) { host.remove(); return; }

    const all = typeof window.excludeRemakes === 'function' ? window.excludeRemakes(window.matchesData || []) : (window.matchesData || []);
    const { rows, games } = R.compareGame(game, all, window.computeTabStats);
    const h = R.highlights(rows);

    let mistakes = [];
    try {
        const raw = typeof fullMatch.rawJson === 'string' ? JSON.parse(fullMatch.rawJson) : fullMatch.rawJson;
        const tl = typeof fullMatch.timelineJson === 'string' ? JSON.parse(fullMatch.timelineJson) : fullMatch.timelineJson;
        const ps = (raw && raw.info && raw.info.participants) || [];
        const i = ps.findIndex(p => p.championName === game.championName && p.teamId === game.teamId);
        if (i >= 0 && tl) mistakes = R.blunders(raw, tl, ps[i].participantId || i + 1, game.teamId);
    } catch (e) {
        console.warn('Blunders unavailable:', e.message);
    }

    const list = (items, empty) => (items.length
        ? `<ul>${items.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
        : `<div class="gr-empty">${empty}</div>`);
    const role = ROLE[game.teamPosition] || 'any role';
    const head = (label, n) => `<th class="num" title="${n} game${n === 1 ? '' : 's'}">${label}<span>${n}</span></th>`;

    host.innerHTML = `
        <div class="gr-head">Game report <span>compared with your other games as ${escapeHtml(role)} in this queue · ±10% is coloured</span></div>
        <div class="gr-body">
            <div class="gr-notes">
                <div class="gr-sec gr-sec--good"><b>Went well</b>${list(h.good, games.season >= R.MIN_POOL ? 'Nothing stood out above your usual.' : 'Not enough games to compare with yet.')}</div>
                <div class="gr-sec gr-sec--bad"><b>Went wrong</b>${list(h.bad, games.season >= R.MIN_POOL ? 'Nothing stood out below your usual.' : 'Not enough games to compare with yet.')}</div>
                <div class="gr-sec gr-sec--blunder"><b>Blunders</b>${list(mistakes, fullMatch && fullMatch.timelineJson ? 'None found.' : 'No timeline stored for this game.')}</div>
            </div>
            <table class="gr-table">
                <thead><tr><th>Stat</th><th class="num">This game</th>${head('Season', games.season)}${head('Patch', games.patch)}${head('Last 7 days', games.week)}</tr></thead>
                <tbody>${rows.map(r => `
                    <tr><td>${escapeHtml(r.label)}</td><td class="num gr-this">${escapeHtml(r.game.display)}</td>${cell(r.season)}${cell(r.patch)}${cell(r.week)}</tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div class="gr-legend">Green / red: this game was at least 10% better / worse than that average. Number next to each heading: games compared.</div>`;
    fitWidth(host);
}

window.addEventListener('resize', () => {
    document.querySelectorAll('.expanded-row .game-report').forEach(h => fitWidth(h));
});

window.renderGameReport = renderGameReport;

module.exports = { renderGameReport };
