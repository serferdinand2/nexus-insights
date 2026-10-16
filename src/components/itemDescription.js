/**
 * itemDescription.js — Data Dragon item description → safe tooltip HTML
 * (#37). Pure, tested.
 *
 * The description is Riot's own markup (<stats>, <passive>, <magicDamage>,
 * <font color='…'>, …). It used to go into innerHTML after a few rewrites,
 * so anything else in it (an <img onerror>, say) would have run in a window
 * with full Node access. Now everything is escaped first, and only the tags
 * below are turned back into markup. Every other tag is dropped, keeping its
 * text; anything that isn't a plain tag stays visible as text.
 */

const { escapeHtml } = require('./dom');

// Riot tag (lower case) → [opening, closing] markup
const KEEP = {
    stats:           ['<div class="item-stats">', '</div>'],
    passive:         ['<span class="item-passive-label">', '</span>'],
    active:          ['<span class="item-active-label">', '</span>'],
    attention:       ['<span class="item-attention">', '</span>'],
    unique:          ['<span class="item-unique">', '</span>'],
    raritymythic:    ['<span class="item-mythic">', '</span>'],
    raritylegendary: ['<span class="item-legendary">', '</span>'],
    b:               ['<b>', '</b>'],
    li:              ['<br>', ''],
    br:              ['<br>', '<br>'],
};

// An escaped tag: &lt;name&gt;, &lt;/name&gt;, &lt;br /&gt;, or with simple
// attributes such as color=&#39;#DD2E2E&#39; (letters, digits, spaces, = # '
// " only, as escaped). Anything else doesn't match and stays as text.
const TAG = /&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+\s*=\s*(?:&#39;|&quot;)[#\w ]*(?:&#39;|&quot;))*)\s*\/?&gt;/g;

function itemDescriptionHtml(raw) {
    let html = escapeHtml(raw || '').replace(TAG, (_m, close, name) => {
        const keep = KEEP[name.toLowerCase()];
        if (!keep) return '';
        return close ? keep[1] : keep[0];
    });
    // Tidy the line breaks around blocks, as before
    html = html.replace(/<\/div>\s*(<br>\s*)+/gi, '</div>');
    html = html.replace(/(<br>\s*)+\s*<div/gi, '<div');
    html = html.replace(/(<br>\s*)+\s*<span class="item-(passive|active)-label">/gi, '<span class="item-$2-label">');
    html = html.replace(/(<br>\s*){2,}/gi, '<br>');
    html = html.replace(/^(\s*<br>)+/gi, '');
    html = html.replace(/(<br>)+\s*$/gi, '');
    return html;
}

module.exports = { itemDescriptionHtml };
