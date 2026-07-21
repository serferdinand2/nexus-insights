/**
 * dom.js — small DOM/string helpers shared by the render modules.
 */

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Escape a value for safe interpolation into an innerHTML template literal.
 *
 * Every string that originates outside this app — summoner names, Riot IDs,
 * champion names, anything out of the Match-V5 payload — must go through this
 * before being concatenated into markup. The renderer is sandboxed now, but an
 * injected <img onerror> would still let a crafted name rewrite the UI.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/**
 * Escape a value for use inside a quoted HTML attribute, including URLs.
 * Blocks javascript:/data: schemes outright.
 */
function escapeAttr(value) {
    const str = escapeHtml(value);
    if (/^\s*(javascript|data|vbscript):/i.test(String(value))) return '';
    return str;
}

module.exports = { escapeHtml, escapeAttr };
