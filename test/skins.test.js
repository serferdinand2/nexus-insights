const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SKINS, getSkin, backgroundFor, applySkin, fileUrl, allSkinVars } = require(path.join(__dirname, '..', 'src', 'components', 'skins.js'));

function fakeDoc() {
    const props = new Map();
    const root = { dataset: {}, style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: k => props.delete(k),
    } };
    return { props, doc: { documentElement: root, body: { style: {} } } };
}

test('every skin variable exists in the stylesheets, so the default can fall back to it', () => {
    const css = ['app.css', 'polish.css'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', f), 'utf8')).join('\n');
    for (const name of allSkinVars()) {
        assert.ok(new RegExp(`${name}\\s*:`).test(css), `${name} is not defined in :root`);
    }
});

test('the app no longer hard-codes the teal accent in the stylesheets', () => {
    for (const f of ['app.css', 'polish.css']) {
        const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', f), 'utf8')
            .replace(/--accent-primary:\s*#00cfbc;/, '').replace(/--accent-rgb:\s*0, 207, 188;/, '');
        assert.ok(!/#00cfbc|rgba\(\s*0\s*,\s*207\s*,\s*188/i.test(css), `${f} still hard-codes the accent`);
    }
});

test('switching skin sets its variables, and switching back clears them', () => {
    const { props, doc } = fakeDoc();
    applySkin('autumn-tide', { doc });
    assert.equal(props.get('--accent-primary'), '#4fe0c8');
    assert.equal(doc.documentElement.dataset.skin, 'autumn-tide');
    assert.match(doc.body.style.backgroundImage, /radial-gradient/);
    applySkin('default', { doc, random: () => 0 });
    assert.equal(props.size, 0);
    assert.match(doc.body.style.backgroundImage, /assets\/backgrounds\/bandle city\.png/);
});

test('unknown skin ids fall back to the default', () => {
    assert.equal(getSkin('nope').id, 'default');
    assert.equal(getSkin(undefined).id, 'default');
});

test('a custom image is used in any skin, under that skin\'s tint', () => {
    const bg = backgroundFor(getSkin('autumn-tide'), { customImage: 'C:\\Users\\anton\\AppData\\Roaming\\nexus-insights\\background-1.png' });
    assert.match(bg, /^linear-gradient\(rgba\(16, 15, 38/);
    assert.match(bg, /url\("file:\/\/\/C:\/Users\/anton\/AppData\/Roaming\/nexus-insights\/background-1\.png"\)/);
});

test('file URLs survive spaces and quotes', () => {
    assert.equal(fileUrl('C:\\My Pics\\a"b.png'), 'url("file:///C:/My%20Pics/a%22b.png")');
});

test('every skin has the fields the Skins page shows', () => {
    for (const s of SKINS) {
        assert.ok(s.id && s.name && s.description && s.swatches.length && s.overlay && s.background, s.id);
    }
});

test('preview colours never borrow from the active skin', () => {
    const { skinVar, getSkin } = require(path.join(__dirname, '..', 'src', 'components', 'skins.js'));
    for (const s of SKINS) {
        for (const n of ['--bg-card', '--border-primary', '--accent-primary', '--on-accent', '--gold-light']) {
            assert.ok(skinVar(s, n) && !/var\(/.test(skinVar(s, n)), `${s.id} ${n}`);
        }
    }
    assert.equal(skinVar(getSkin('default'), '--accent-primary'), '#00cfbc');
});
