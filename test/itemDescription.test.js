const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SRC } = require('./helpers');

const { itemDescriptionHtml } = require(path.join(SRC, 'components', 'itemDescription.js'));

test('Riot markup becomes the tooltip markup (#37)', () => {
    const raw = '<mainText><stats><attention>80</attention> Ability Power<br><attention>300</attention> Health</stats>' +
                '<br><br><passive>Torment</passive><br>Dealing ability damage burns for <magicDamage>1% max Health</magicDamage>.' +
                '<br><li><b>Note:</b> stacks once.<br><rarityLegendary>Legendary</rarityLegendary></mainText>';
    assert.equal(itemDescriptionHtml(raw),
        '<div class="item-stats"><span class="item-attention">80</span> Ability Power<br>' +
        '<span class="item-attention">300</span> Health</div>' +
        '<span class="item-passive-label">Torment</span><br>Dealing ability damage burns for 1% max Health.' +
        '<br><b>Note:</b> stacks once.<br><span class="item-legendary">Legendary</span>');
});

test('unknown tags are dropped, their text kept, including font colours', () => {
    assert.equal(itemDescriptionHtml("<status>Slow</status> and <font color='#DD2E2E'>red</font> <keywordMajor>x</keywordMajor>"),
        'Slow and red x');
    assert.equal(itemDescriptionHtml("<font color = '#00FF00'>green</font>"), 'green');
});

test('hostile HTML never becomes markup', () => {
    for (const evil of [
        '<img src=x onerror="require(\'child_process\').exec(\'calc\')">',
        '<script>alert(1)</script>',
        '<a href="javascript:alert(1)">x</a>',
        '<stats onmouseover="alert(1)">x</stats>',
        '<svg/onload=alert(1)>',
    ]) {
        const out = itemDescriptionHtml(evil);
        // The only real tags left are our own, and none carries an attribute but class
        const tags = out.match(/<[^>]*>/g) || [];
        for (const t of tags) assert.match(t, /^<\/?(div|span|b|br)( class="item-[a-z-]+")?>$/, `${evil} → ${out}`);
    }
    // A Riot tag carrying a script attribute stays text, not a styled block
    assert.equal(itemDescriptionHtml('<stats onmouseover="alert(1)">x</stats>'),
        '&lt;stats onmouseover=&quot;alert(1)&quot;&gt;x</div>');
});

test('plain text and odd input', () => {
    assert.equal(itemDescriptionHtml('5 < 10 & "quotes"'), '5 &lt; 10 &amp; &quot;quotes&quot;');
    assert.equal(itemDescriptionHtml(''), '');
    assert.equal(itemDescriptionHtml(undefined), '');
    assert.equal(itemDescriptionHtml('<br><br>Text<br><br>'), 'Text');
});
