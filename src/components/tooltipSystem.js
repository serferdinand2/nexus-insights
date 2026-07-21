/**
 * tooltipSystem.js — Hover tooltip subsystem.
 * Call initTooltips() once after DOMContentLoaded to attach global listeners.
 */

const { getItemData, getRuneData, getSummonerSpellData } = require('../services/dataDragon');

function tooltip() {
    return document.getElementById('gameTooltip');
}

function positionTooltip(x, y) {
    const el     = tooltip();
    const offset = 15;
    let left = x + offset;
    let top  = y + offset;
    if (left + el.offsetWidth  > window.innerWidth)  left = x - el.offsetWidth  - offset;
    if (top  + el.offsetHeight > window.innerHeight) top  = y - el.offsetHeight - offset;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
}

function hideTooltip() {
    tooltip().style.display = 'none';
}

// ---------------------------------------------------------------------------
// TOOLTIP CONTENT BUILDERS
// ---------------------------------------------------------------------------

function showItemTooltip(itemId) {
    const itemData = getItemData(itemId);
    if (!itemData) return;

    const el    = tooltip();
    const title = el.querySelector('.tooltip-title');
    const desc  = el.querySelector('.tooltip-description');

    const totalCost = itemData.gold?.total || 0;
    const baseCost  = itemData.gold?.base  || 0;
    const costText  = baseCost > 0
        ? `<span class="item-cost">Cost: <span class="gold-value">${totalCost}</span> (<span class="gold-value">${baseCost}</span>)</span>`
        : `<span class="item-cost">Cost: <span class="gold-value">${totalCost}</span></span>`;

    let description = itemData.description || '';
    description = description.replace(/<\/?mainText>/gi, '');
    description = description.replace(/<stats>/gi,   '<div class="item-stats">').replace(/<\/stats>/gi,   '</div>');
    description = description.replace(/<passive>/gi, '<span class="item-passive-label">').replace(/<\/passive>/gi, '</span>');
    description = description.replace(/<active>/gi,  '<span class="item-active-label">') .replace(/<\/active>/gi,  '</span>');
    description = description.replace(/<attention>/gi,     '<span class="item-attention">').replace(/<\/attention>/gi,     '</span>');
    description = description.replace(/<unique>/gi,        '<span class="item-unique">').replace(/<\/unique>/gi,        '</span>');
    description = description.replace(/<rarityMythic>/gi,  '<span class="item-mythic">').replace(/<\/rarityMythic>/gi,  '</span>');
    description = description.replace(/<rarityLegendary>/gi,'<span class="item-legendary">').replace(/<\/rarityLegendary>/gi,'</span>');
    description = description.replace(/<\/?[a-zA-Z]+[A-Z][a-zA-Z]*>/g, '');
    description = description.replace(/<\/div>\s*(<br\s*\/?>[\s]*)+ /gi, '</div>');
    description = description.replace(/(<br\s*\/?>[\s]*)+\s*<div/gi, '<div');
    description = description.replace(/(<br\s*\/?>[\s]*)+\s*<span class="item-(passive|active)-label">/gi, '<span class="item-$2-label">');
    description = description.replace(/(<br\s*\/?>[\s]*){2,}/gi, '<br>');
    description = description.replace(/^(\s*<br\s*\/?>)+/gi, '');
    description = description.replace(/(<br\s*\/?>)+\s*$/gi, '');

    title.innerHTML = `${itemData.name || 'Unknown Item'}<br>${costText}`;
    desc.innerHTML  = description;
    el.style.display = 'block';
}

function showRuneTooltip(runeId) {
    const runeData = getRuneData(runeId);
    if (!runeData) return;
    const el = tooltip();
    el.querySelector('.tooltip-title').textContent       = runeData.name || 'Unknown Rune';
    el.querySelector('.tooltip-description').textContent = runeData.shortDesc || runeData.description || 'No description available';
    el.style.display = 'block';
}

function showBadgeTooltip(badgeEl) {
    const el     = tooltip();
    const nameEl = badgeEl.querySelector('.badge-name');
    el.querySelector('.tooltip-title').textContent       = nameEl ? nameEl.textContent : '';
    el.querySelector('.tooltip-description').textContent = badgeEl.dataset.badgeTooltip || '';
    el.style.display = 'block';
}

function showInsightTooltip(labelEl) {
    const description = labelEl.dataset.insightTooltip || '';
    if (!description) return;
    const el = tooltip();
    el.querySelector('.tooltip-title').textContent       = labelEl.textContent;
    el.querySelector('.tooltip-description').textContent = description;
    el.style.display = 'block';
}

function showSummonerSpellTooltip(spellId) {
    const spellData = getSummonerSpellData(spellId);
    if (!spellData) return;
    const el = tooltip();
    el.querySelector('.tooltip-title').textContent       = spellData.name        || 'Unknown Spell';
    el.querySelector('.tooltip-description').textContent = spellData.description || 'No description available';
    el.style.display = 'block';
}

function showColumnTooltip(labelEl) {
    const description = labelEl.dataset.columnTooltip || '';
    if (!description) return;
    const el = tooltip();
    el.querySelector('.tooltip-title').textContent       = labelEl.textContent;
    el.querySelector('.tooltip-description').textContent = description;
    el.style.display = 'block';
}

// ---------------------------------------------------------------------------
// EVENT HANDLERS
// ---------------------------------------------------------------------------

function handleTooltipShow(e) {
    if (e.target.dataset?.itemId)         { showItemTooltip(e.target.dataset.itemId);                      return; }
    if (e.target.dataset?.runeId)         { showRuneTooltip(parseInt(e.target.dataset.runeId));             return; }
    if (e.target.dataset?.spellId)        { showSummonerSpellTooltip(parseInt(e.target.dataset.spellId));   return; }
    const badgeEl = e.target.closest('.badge-pill');
    if (badgeEl?.dataset?.badgeTooltip)   { showBadgeTooltip(badgeEl);                                     return; }
    if (e.target.dataset?.insightTooltip) { showInsightTooltip(e.target);                                  return; }
    if (e.target.dataset?.columnTooltip)  { showColumnTooltip(e.target);                                   return; }
}

function handleTooltipHide(e) {
    const r = e.relatedTarget;
    if (!r || (
        !r.dataset?.itemId &&
        !r.dataset?.runeId &&
        !r.dataset?.spellId &&
        !r.closest?.('.badge-pill') &&
        !r.dataset?.insightTooltip &&
        !r.dataset?.columnTooltip
    )) {
        hideTooltip();
    }
}

function handleTooltipMove(e) {
    if (tooltip().style.display === 'block') positionTooltip(e.clientX, e.clientY);
}

function initTooltips() {
    document.addEventListener('mouseover', handleTooltipShow);
    document.addEventListener('mouseout',  handleTooltipHide);
    document.addEventListener('mousemove', handleTooltipMove);
}

module.exports = { initTooltips, hideTooltip, positionTooltip };
