const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { wrColor, wrTextColor, wrPosition } = require(path.join(__dirname, '..', 'src', 'components', 'winRateColor.js'));

test('50% is neutral, the scale saturates at ±12 points', () => {
    assert.equal(wrPosition(0.5), 0);
    assert.equal(wrPosition(0.38), -1);
    assert.equal(wrPosition(0.30), -1);
    assert.equal(wrPosition(0.62), 1);
    assert.equal(wrColor(0.5), 'rgba(112,117,126,0.85)');
});

test('a 48% day is close to neutral — not "worst day" red', () => {
    const [r, g, b] = wrColor(0.48).match(/\d+/g).map(Number);
    assert.ok(r - b < 40, wrColor(0.48));
});

test('49% and 50% look almost the same (no hard colour jump)', () => {
    const a = wrTextColor(0.49).match(/\d+/g).map(Number);
    const b = wrTextColor(0.50).match(/\d+/g).map(Number);
    assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 15), `${a} vs ${b}`);
});

test('small samples are faded, missing data is a placeholder', () => {
    assert.match(wrColor(0.7, { games: 2 }), /0\.38\)$/);
    assert.equal(wrColor(null), 'rgba(255,255,255,0.05)');
});
