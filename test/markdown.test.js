const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { renderMarkdown } = require(path.join(__dirname, '..', 'src', 'components', 'markdown.js'));

test('nothing in the model output can become a real tag', () => {
    const evil = [
        '<img src=x onerror=alert(1)>',
        '<script>alert(1)</script>',
        '**<b onmouseover=alert(1)>hi</b>**',
        '| a | <svg onload=alert(1)> |\n|---|---|\n| 1 | 2 |',
        '- <iframe src="javascript:alert(1)">',
        '```\n</code></pre><img src=x onerror=alert(1)>\n```',
    ];
    for (const s of evil) {
        const html = renderMarkdown(s);
        assert.ok(!/<(img|script|svg|iframe|b)\b/i.test(html), `raw tag survived: ${html}`);
        assert.ok(!/\son\w+=/i.test(html.replace(/&[a-z]+;/g, '')) || html.includes('&lt;'), html);
    }
});

test('bold, italic, code', () => {
    assert.equal(renderMarkdown('Your **win rate** is *52%* in `Solo`'),
        '<p>Your <strong>win rate</strong> is <em>52%</em> in <code>Solo</code></p>');
});

test('lists, ordered and unordered', () => {
    assert.equal(renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
    assert.equal(renderMarkdown('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
});

test('pipe tables', () => {
    const html = renderMarkdown('| Champ | WR |\n|---|---|\n| Ahri | 55% |\n| Lux | 48% |');
    assert.equal(html, '<table><thead><tr><th>Champ</th><th>WR</th></tr></thead><tbody>' +
        '<tr><td>Ahri</td><td>55%</td></tr><tr><td>Lux</td><td>48%</td></tr></tbody></table>');
});

test('paragraphs and line breaks', () => {
    assert.equal(renderMarkdown('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
});

test('headings become small headers', () => {
    assert.equal(renderMarkdown('## Summary\ntext'), '<h4>Summary</h4><p>text</p>');
});

test('KDA-style text with slashes and asterisk multiplication is left alone', () => {
    assert.equal(renderMarkdown('KDA 7/3/9 over 3 * 2 games'), '<p>KDA 7/3/9 over 3 * 2 games</p>');
});
