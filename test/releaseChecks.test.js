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
