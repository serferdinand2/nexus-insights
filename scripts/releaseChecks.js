/**
 * releaseChecks.js — may this checkout publish a release? (#42) Pure, tested.
 *
 * A release commits "Release vX" and pushes it on the current branch. From a
 * feature branch, main never got the new version number (v1.0.4 landed on
 * feature/allies-columns-sort, repaired by #33). From a main with local
 * commits, the push would put unreviewed work on main.
 *
 * @param {object} git
 * @param {string}  git.branch   current branch ('HEAD' when detached)
 * @param {boolean} git.dirty    uncommitted changes to tracked or new files
 * @param {number}  git.behind   commits on origin/main this checkout lacks
 * @param {number}  git.ahead    local commits not on origin/main
 * @returns {string[]} what's wrong, with what to do; empty = OK to publish
 */
function releaseProblems({ branch, dirty, behind, ahead }) {
    const out = [];
    if (branch !== 'main') {
        out.push(`You're on "${branch}", not main. Releases are published from main:\n` +
                 `     git switch main && git pull`);
    }
    if (dirty) {
        out.push('There are uncommitted changes. Commit them on a branch (and merge the PR),\n' +
                 '     or stash them, so the release is exactly what\'s on GitHub.');
    }
    if (behind > 0) {
        out.push(`main is ${behind} commit${behind === 1 ? '' : 's'} behind GitHub. Run:  git pull`);
    }
    if (ahead > 0) {
        out.push(`main has ${ahead} commit${ahead === 1 ? '' : 's'} that aren't on GitHub. Put ${ahead === 1 ? 'it' : 'them'} on a branch\n` +
                 '     and merge the PR first; publishing would push them straight to main.');
    }
    return out;
}

module.exports = { releaseProblems };
