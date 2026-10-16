/**
 * csvExport.js — match rows → CSV text (issue #15). Pure, tested.
 *
 * One row per match, with the scalar columns getMatches() returns (no JSON
 * blobs) plus a readable `date` first. Opens in Excel / Sheets as is.
 */

// Never exported, even if a row happens to carry them
const SKIP = new Set(['rawJson', 'timelineJson']);

/**
 * Quote a value when needed. Text starting with = + - @ is prefixed with '
 * so a spreadsheet can't run it as a formula; numbers are left alone.
 */
function cell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Local date and time of a game, "2026-10-15 21:04". */
function gameDate(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** CSV text for `rows`, oldest game first. Columns: date, then every column any row has. */
function matchesToCsv(rows) {
    const columns = [];
    const seen = new Set();
    for (const r of rows) {
        for (const k of Object.keys(r)) {
            if (!SKIP.has(k) && !seen.has(k)) { seen.add(k); columns.push(k); }
        }
    }
    const sorted = [...rows].sort((a, b) => (a.gameCreation || 0) - (b.gameCreation || 0));
    const lines = [['date', ...columns].join(',')];
    for (const r of sorted) {
        lines.push([cell(gameDate(r.gameCreation)), ...columns.map(k => cell(r[k]))].join(','));
    }
    return lines.join('\r\n') + '\r\n';
}

module.exports = { matchesToCsv, cell, gameDate };
