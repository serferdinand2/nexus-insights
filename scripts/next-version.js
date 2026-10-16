/**
 * next-version.js — print the version the next release should use.
 *
 *   node scripts/next-version.js [latestReleaseTag]
 *
 * Used by .github/workflows/release.yml, which passes the newest GitHub
 * release tag (or nothing when there isn't one). See releaseChecks.nextVersion.
 */

const path = require('path');
const { nextVersion } = require('./releaseChecks');

const pkg = require(path.join(__dirname, '..', 'package.json'));
try {
    console.log(nextVersion(pkg.version, process.argv[2] || ''));
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
