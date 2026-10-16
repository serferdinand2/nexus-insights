/**
 * KDA with no deaths is shown as a number, (kills + assists) / 1, like the
 * Analytics cards — not "Perfect", which hid the actual value.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeMatch, SRC } = require('./helpers');

global.window = global.window || {};
const { renderMatchRows } = require(path.join(SRC, 'components', 'tableRenderer.js'));

const row = (m) => renderMatchRows([m], [m], 'https://ddragon', { 420: 'Ranked Solo' }, () => '', () => '', null, null);

test('no deaths: KDA is kills + assists, not "Perfect"', () => {
    const html = row(makeMatch({ kills: 0, deaths: 0, assists: 1 }));
    assert.ok(!/Perfect/.test(html));
    assert.match(html, />1\.00</);
    assert.match(row(makeMatch({ kills: 4, deaths: 0, assists: 5 })), />9\.00</);
});

test('with deaths: unchanged', () => {
    assert.match(row(makeMatch({ kills: 6, deaths: 3, assists: 9 })), />5\.00</);
});
