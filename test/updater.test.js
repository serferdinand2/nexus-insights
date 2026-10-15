const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const path = require('path');
const { createUpdater, friendlyError } = require(path.join(__dirname, '..', 'src', 'services', 'updater.js'));

/** Fake electron-updater: `result` decides what a check finds. */
function fakeAutoUpdater({ newVersion = null, failCheck = null, failDownload = null } = {}) {
    const u = new EventEmitter();
    u.calls = { check: 0, download: 0, install: [] };
    u.checkForUpdates = async () => {
        u.calls.check++;
        if (failCheck) { u.emit('error', new Error(failCheck)); throw new Error(failCheck); }
        if (newVersion) u.emit('update-available', { version: newVersion });
        else u.emit('update-not-available', {});
    };
    u.downloadUpdate = async () => {
        u.calls.download++;
        if (failDownload) throw new Error(failDownload);
        u.emit('download-progress', { percent: 42.4 });
        u.emit('update-downloaded', { version: newVersion });
    };
    u.quitAndInstall = (...a) => u.calls.install.push(a);
    return u;
}

function harness(opts, extra = {}) {
    const autoUpdater = fakeAutoUpdater(opts);
    const sent = [];
    const timers = [];
    let restarted = false;
    const up = createUpdater({
        autoUpdater, isPackaged: true, currentVersion: '1.0.0',
        send: s => sent.push(s),
        beforeRestart: () => { restarted = true; },
        setTimeout: fn => timers.push(fn),
        ...extra,
    });
    return { up, autoUpdater, sent, timers, wasRestarted: () => restarted };
}

test('click with a newer release: download, progress, then restart into it', async () => {
    const h = harness({ newVersion: '1.0.1' });
    await h.up.check();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(h.sent.map(s => s.state), ['checking', 'downloading', 'downloading', 'ready']);
    assert.equal(h.sent[2].percent, 42);
    assert.equal(h.sent[3].version, '1.0.1');
    assert.equal(h.autoUpdater.autoDownload, false);
    // restart only after the delay, and close-to-tray is bypassed first
    assert.equal(h.autoUpdater.calls.install.length, 0);
    h.timers.forEach(fn => fn());
    assert.ok(h.wasRestarted());
    assert.deepEqual(h.autoUpdater.calls.install, [[true, true]]);
});

test('click when already up to date says so and downloads nothing', async () => {
    const h = harness({});
    await h.up.check();
    assert.deepEqual(h.sent, [{ state: 'checking', version: '1.0.0' }, { state: 'none', version: '1.0.0' }]);
    assert.equal(h.autoUpdater.calls.download, 0);
});

test('quiet startup check only lights the dot — never downloads or restarts', async () => {
    const h = harness({ newVersion: '1.0.1' });
    await h.up.check({ quiet: true });
    assert.deepEqual(h.sent, [{ state: 'available', version: '1.0.1' }]);
    assert.equal(h.autoUpdater.calls.download, 0);
    // ...and a later click still works
    await h.up.check();
    await new Promise(r => setImmediate(r));
    assert.equal(h.autoUpdater.calls.download, 1);
});

test('quiet check stays silent when up to date or offline', async () => {
    const a = harness({});
    await a.up.check({ quiet: true });
    const b = harness({ failCheck: 'getaddrinfo ENOTFOUND github.com' });
    await b.up.check({ quiet: true });
    assert.deepEqual([...a.sent, ...b.sent], []);
});

test('errors become one readable message and the button is usable again', async () => {
    const h = harness({ failCheck: 'getaddrinfo ENOTFOUND github.com' });
    await h.up.check();
    const errs = h.sent.filter(s => s.state === 'error');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /internet/);
    assert.equal(h.up.getState(), 'idle');

    const d = harness({ newVersion: '1.0.1', failDownload: 'sha512 checksum mismatch' });
    await d.up.check();
    await new Promise(r => setImmediate(r));
    assert.match(d.sent.at(-1).message, /damaged/);
    assert.equal(d.up.getState(), 'idle');
});

test('running from source reports dev instead of trying', async () => {
    const sent = [];
    const up = createUpdater({ autoUpdater: null, isPackaged: false, currentVersion: '1.0.0',
        send: s => sent.push(s), beforeRestart() {} });
    await up.check();
    assert.deepEqual(sent, [{ state: 'dev', version: '1.0.0' }]);
});

test('friendly messages', () => {
    assert.match(friendlyError(new Error('HttpError: 404 ... latest.yml')), /No published release/);
    assert.match(friendlyError(new Error('HttpError: 403 rate limit exceeded')), /limiting/);
});
