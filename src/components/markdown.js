/**
 * markdown.js — a small, safe Markdown renderer for chat answers.
 *
 * Safety first: the WHOLE input is HTML-escaped before any formatting is
 * applied, so nothing the model writes (or echoes back from match data, like
 * a summoner name) can become a real tag. Only the patterns below are turned
 * into markup, and they only ever produce a fixed set of tags with no
 * attributes taken from the text.
 *
 * Supports: paragraphs, line breaks, **bold**, *italic*, `code`, ``` blocks,
 * # headings, - / * / 1. lists, and | pipe | tables.
 */

const { escapeHtml } = require('./dom');

function inline(s) {
    // s is already escaped
    return s
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, '$1<em>$2</em>');
}

const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

function renderMarkdown(text) {
    const lines = escapeHtml(String(text || '')).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // fenced code block
        if (/^\s*```/.test(line)) {
            const body = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
            i++; // closing fence (or end)
            out.push(`<pre><code>${body.join('\n')}</code></pre>`);
            continue;
        }

        // table: header row + separator row
        if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
            const head = cells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
            out.push('<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') +
                     '</tr></thead><tbody>' +
                     rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
                     '</tbody></table>');
            continue;
        }

        // heading
        const h = /^\s*(#{1,4})\s+(.*)$/.exec(line);
        if (h) { out.push(`<h4>${inline(h[2])}</h4>`); i++; continue; }

        // lists
        if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
            const ordered = /^\s*\d+[.)]\s+/.test(line);
            const items = [];
            while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
                i++;
            }
            const tag = ordered ? 'ol' : 'ul';
            out.push(`<${tag}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
            continue;
        }

        // blank line
        if (!line.trim()) { i++; continue; }

        // paragraph: consecutive plain lines, joined with <br>
        const para = [];
        while (i < lines.length && lines[i].trim() &&
               !/^\s*```/.test(lines[i]) &&
               !/^\s*(#{1,4})\s+/.test(lines[i]) &&
               !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) &&
               !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
            para.push(inline(lines[i]));
            i++;
        }
        out.push(`<p>${para.join('<br>')}</p>`);
    }
    return out.join('');
}

module.exports = { renderMarkdown };
