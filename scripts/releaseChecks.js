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

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * The version to release next: one patch above the higher of package.json
 * and the newest GitHub release. When releases are published automatically,
 * the "Release vX" commit back to main can lag behind (two merges close
 * together), so the releases are the source of truth, not package.json.
 * @param {string} pkgVersion   e.g. '1.0.4'
 * @param {string} [latestTag]  e.g. 'v1.0.6'; empty when there's no release
 */
function nextVersion(pkgVersion, latestTag) {
    const parse = v => { const m = SEMVER.exec(String(v || '').trim()); return m ? m.slice(1).map(Number) : null; };
    const a = parse(pkgVersion), b = parse(latestTag);
    if (!a && !b) throw new Error(`No usable version in "${pkgVersion}" or "${latestTag}"`);
    const newer = !b ? a : !a ? b : (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0 ? a : b;
    return `${newer[0]}.${newer[1]}.${newer[2] + 1}`;
}

module.exports = { releaseProblems, nextVersion };
