const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const { matchesToCsv, cell, gameDate } = require(path.join(SRC, 'services', 'csvExport.js'));

test('cells: quoting, empties, numbers', () => {
    assert.equal(cell(null), '');
    assert.equal(cell(undefined), '');
    assert.equal(cell(-350), '-350');           // negative numbers stay numbers
    assert.equal(cell(NaN), '');
    assert.equal(cell('Kai\'Sa'), 'Kai\'Sa');
    assert.equal(cell('a,b'), '"a,b"');
    assert.equal(cell('say "hi"'), '"say ""hi"""');
    assert.equal(cell('two\nlines'), '"two\nlines"');
});

test('cells: text a spreadsheet would run as a formula is defused', () => {
    assert.equal(cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(cell('+1'), "'+1");
    assert.equal(cell('-cmd'), "'-cmd");
    assert.equal(cell('@SUM(A1)'), "'@SUM(A1)");
});

test('one row per match, oldest first, date column first, no blobs', () => {
    const t1 = new Date(2026, 9, 14, 20, 5).getTime();
    const t2 = new Date(2026, 9, 15, 9, 0).getTime();
    const csv = matchesToCsv([
        { matchId: 'EUW1_2', gameCreation: t2, championName: 'Ahri', win: 1, csDiff15: -4.5, rawJson: 'x' },
        { matchId: 'EUW1_1', gameCreation: t1, championName: 'Zed', win: 0, csDiff15: null, timelineJson: 'y' },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(lines[0], 'date,matchId,gameCreation,championName,win,csDiff15');
    assert.equal(lines[1], `2026-10-14 20:05,EUW1_1,${t1},Zed,0,`);
    assert.equal(lines[2], `2026-10-15 09:00,EUW1_2,${t2},Ahri,1,-4.5`);
    assert.equal(lines.length, 3);
});

test('empty list gives just a header', () => {
    assert.equal(matchesToCsv([]), 'date\r\n');
    assert.equal(gameDate(undefined), '');
});
