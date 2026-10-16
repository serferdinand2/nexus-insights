const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { releaseProblems } = require(path.join(__dirname, '..', 'scripts', 'releaseChecks.js'));

const ok = { branch: 'main', dirty: false, behind: 0, ahead: 0 };

test('a clean main that matches GitHub may publish (#42)', () => {
    assert.deepEqual(releaseProblems(ok), []);
});

test('each problem is reported, with what to do', () => {
    const one = (state, word) => {
        const p = releaseProblems({ ...ok, ...state });
        assert.equal(p.length, 1, JSON.stringify(state));
        assert.match(p[0], word);
    };
    one({ branch: 'feature/allies-columns-sort' }, /feature\/allies-columns-sort.*git switch main/s);
    one({ branch: 'HEAD' }, /not main/);
    one({ dirty: true }, /uncommitted changes/);
    one({ behind: 1 }, /1 commit behind.*git pull/s);
    one({ behind: 3 }, /3 commits behind/);
    one({ ahead: 2 }, /2 commits that aren't on GitHub/);
});

test('several problems at once are all listed', () => {
    const p = releaseProblems({ branch: 'fix/x', dirty: true, behind: 2, ahead: 1 });
    assert.equal(p.length, 4);
});

test('nextVersion: one patch above the newer of package.json and the latest release', () => {
    const { nextVersion } = require(path.join(__dirname, '..', 'scripts', 'releaseChecks.js'));
    assert.equal(nextVersion('1.0.4', 'v1.0.4'), '1.0.5');
    assert.equal(nextVersion('1.0.4', 'v1.0.6'), '1.0.7');      // main's version commit lagged behind
    assert.equal(nextVersion('1.1.0', 'v1.0.9'), '1.1.1');      // bumped by hand in package.json
    assert.equal(nextVersion('1.0.10', 'v1.0.9'), '1.0.11');    // numeric, not text, comparison
    assert.equal(nextVersion('1.0.4', ''), '1.0.5');            // no release yet
    assert.equal(nextVersion('1.0.4', 'nightly'), '1.0.5');     // a tag that isn't a version
    assert.throws(() => nextVersion('', ''));
});
