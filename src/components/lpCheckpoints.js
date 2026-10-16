/**
 * lpCheckpoints.js — the "Checkpoints" popover on each LP card (#5).
 *
 * A checkpoint is a rank you know you had on a date (lp_history row with
 * manual = 1). The LP estimates for games before tracking are fitted through
 * them, so a few checkpoints turn guesses into a believable history. This
 * replaces the old hard-coded SOLO_LP_SEED; rows it wrote became checkpoints
 * (migration 5) and can be deleted here.
 */

const { addLpCheckpoint, deleteLpCheckpoint, getLpCheckpoints } = require('../services/matchService');
const { escapeHtml } = require('./dom');

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const title = s => s.charAt(0) + s.slice(1).toLowerCase();
const popId = queue => (queue === 'solo' ? 'lpCkptSolo' : 'lpCkptFlex');

async function renderPop(queue) {
    const pop = document.getElementById(popId(queue));
    if (!pop) return;
    let list = [];
    try {
        list = (await getLpCheckpoints()).filter(c => c.queue === queue);
    } catch (e) {
        console.warn('Could not load LP checkpoints:', e.message);
    }
    const today = new Date().toISOString().slice(0, 10);
    pop.innerHTML = `
        <div class="lp-ckpt-title">${queue === 'solo' ? 'Solo/Duo' : 'Flex'} checkpoints
            <button type="button" class="lp-ckpt-close" data-close aria-label="Close">×</button></div>
        <div class="lp-ckpt-help">A rank you had on a date. Games played before LP tracking are estimated from these.</div>
        <ul class="lp-ckpt-list">${list.length ? list.map(c => `
            <li><span>${escapeHtml(c.recorded_date)}</span>
                <span>${escapeHtml(title(c.tier))}${APEX.has(c.tier) ? '' : ' ' + escapeHtml(c.rank)} · ${Number(c.lp)} LP</span>
                <button type="button" data-del="${Number(c.id)}" title="Delete this checkpoint" aria-label="Delete">×</button></li>`).join('')
            : '<li class="lp-ckpt-empty">None yet</li>'}</ul>
        <form class="lp-ckpt-form">
            <input type="date" name="date" required max="${today}" value="${today}" aria-label="Date">
            <select name="tier" aria-label="Tier">${TIERS.map(t => `<option value="${t}"${t === 'GOLD' ? ' selected' : ''}>${title(t)}</option>`).join('')}</select>
            <select name="rank" aria-label="Division">${['IV', 'III', 'II', 'I'].map(r => `<option>${r}</option>`).join('')}</select>
            <input type="number" name="lp" min="0" max="99" value="50" required aria-label="LP">
            <button type="submit">Add</button>
        </form>
        <div class="lp-ckpt-err" role="alert"></div>`;
}

/** Charts and the Match History LP column both follow the new estimates. */
async function afterChange() {
    if (typeof window.renderLpCharts === 'function') await window.renderLpCharts();
    if (typeof window.renderFilteredMatches === 'function') await window.renderFilteredMatches({ listOnly: true });
}

function wire() {
    const root = document.documentElement;
    if (root.dataset.lpCkptWired) return;
    root.dataset.lpCkptWired = '1';

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.lp-ckpt-btn');
        const pop = e.target.closest('.lp-ckpt-pop');
        if (btn) {
            const el = document.getElementById(popId(btn.dataset.queue));
            const opening = el.hidden;
            document.querySelectorAll('.lp-ckpt-pop').forEach(p => { p.hidden = true; });
            if (opening) { await renderPop(btn.dataset.queue); el.hidden = false; }
            return;
        }
        if (!pop) {                                    // click outside closes
            document.querySelectorAll('.lp-ckpt-pop').forEach(p => { p.hidden = true; });
            return;
        }
        const queue = pop.id === 'lpCkptSolo' ? 'solo' : 'flex';
        if (e.target.closest('[data-close]')) { pop.hidden = true; return; }
        const del = e.target.closest('[data-del]');
        if (del) {
            await deleteLpCheckpoint(Number(del.dataset.del));
            await renderPop(queue);
            await afterChange();
        }
    });

    document.addEventListener('change', (e) => {
        // Master and above have no divisions
        if (e.target.name === 'tier' && e.target.closest('.lp-ckpt-form')) {
            const rank = e.target.form.elements.rank;
            rank.disabled = APEX.has(e.target.value);
            e.target.form.elements.lp.max = APEX.has(e.target.value) ? '' : '99';
        }
    });

    document.addEventListener('submit', async (e) => {
        const form = e.target.closest('.lp-ckpt-form');
        if (!form) return;
        e.preventDefault();
        const pop = form.closest('.lp-ckpt-pop');
        const queue = pop.id === 'lpCkptSolo' ? 'solo' : 'flex';
        const f = form.elements;
        try {
            await addLpCheckpoint(queue, f.tier.value, f.rank.value, Number(f.lp.value), f.date.value);
            await renderPop(queue);
            await afterChange();
        } catch (err) {
            pop.querySelector('.lp-ckpt-err').textContent = `Not added: ${err.message}`;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.lp-ckpt-pop').forEach(p => { p.hidden = true; });
    });
}

wire();

module.exports = { renderPop };
