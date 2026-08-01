/**
 * coaching-report.js — what the new coaching engine actually says about you.
 *
 *   npm run coaching
 *
 * Read-only. Runs the same analysis the Coaching tab does, but prints the full
 * ranking instead of just the focus, so you can judge whether the ordering is
 * sensible before trusting the UI. Needs Node 22.5+.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const Engine = require('../src/components/coachingEngine');

function userDataPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'nexus-insights');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-insights');
  }
  return path.join(os.homedir(), '.config', 'nexus-insights');
}

const dbPath = process.argv[2] || path.join(userDataPath(), 'nexus_data.sqlite');
if (!fs.existsSync(dbPath)) { console.error(`No database at ${dbPath}`); process.exit(1); }

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch { console.error('Needs Node 22.5+. Yours: ' + process.version); process.exit(1); }

const SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();
const db = new DatabaseSync(dbPath, { readOnly: true });

const rows = db.prepare(`
  SELECT matchId, win, championName, teamPosition, kills, deaths, assists,
         gameDuration, gameCreation, visionScore, detectorWardsPlaced,
         isolatedDeaths, goldDiff15, deathsBefore10, cs10,
         teamDragons, teamBarons, teamKills, turretKills, firstBlood
  FROM matches
  WHERE queueId = 420 AND gameCreation >= ?
    AND COALESCE(isRemake, CASE WHEN gameDuration < 300 THEN 1 ELSE 0 END) = 0
  ORDER BY gameCreation ASC
`).all(SEASON_START);
db.close();

if (!rows.length) { console.log('No ranked Solo/Duo games this season.'); process.exit(0); }

const out = Engine.analyse(rows);
const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);

console.log(`\n${out.sampleSize} ranked Solo/Duo games  ·  primary role ${out.roleLabel} (${Math.round(out.roleShare * 100)}%)\n`);

console.log('COACHABLE INPUTS, ranked by associated win rate');
console.log('─'.repeat(96));
console.log('  metric                        now      target   WR met   WR miss    gap   fails   assoc  confident');
for (const m of out.allInputs) {
  console.log(
    '  ' + m.label.padEnd(30) +
    f(m.current, m.decimals).padStart(6) +
    f(m.target, m.decimals).padStart(10) +
    (m.wrMet === null ? '—' : Math.round(m.wrMet) + '%').padStart(9) +
    (m.wrMissed === null ? '—' : Math.round(m.wrMissed) + '%').padStart(10) +
    (f(m.gap, 0) + 'pt').padStart(8) +
    (Math.round(m.failureRate) + '%').padStart(8) +
    (f(m.recoverable, 1) + '%').padStart(8) +
    (m.confident ? '  yes' : '   no').padStart(11) +
    (m.circular ? '   [circular — never the focus]' : '')
  );
}

console.log('\nFOCUS: ' + (out.focus ? out.focus.label : 'none'));
if (out.focus) {
  console.log('  rule: ' + out.focus.rule);
  console.log(`  ${out.focus.metGames} games met it, ${out.focus.failedGames} missed;` +
              ` standard error ${f(out.focus.standardError, 1)}pt`);
  if (!out.focus.confident) console.log('  NOTE: gap is inside the margin of error — weak evidence.');
}

console.log('\nWATCHING');
for (const w of out.watch) {
  // improving is tri-state: true / false / null (flat). A plain ternary would
  // report every unchanged metric as worsening.
  const dir = !w.trend ? ''
    : w.trend.improving === true  ? '(improving)'
    : w.trend.improving === false ? '(worsening)'
    : '(steady)';
  // Binary metrics are rates; at 0 decimals a real change prints as "0 -> 0".
  const show = v => w.binary ? Math.round(v * 100) + '%' : f(v, w.decimals);
  const t = w.trend ? `${show(w.trend.before)} -> ${show(w.trend.after)} ${dir}` : '';
  console.log('  ' + w.label.padEnd(30) + show(w.current).padStart(7) + '   ' + t);
}

if (out.tilt) {
  console.log('\nTILT (behavioural, not win-rate based)');
  console.log(`  ${out.tilt.games} games played after two losses (${Math.round(out.tilt.share)}% of total)`);
  const cmp = (name, o, d = 1) => o && console.log(`  ${name.padEnd(20)} normal ${f(o.normal, d)}  ->  tilted ${f(o.tilted, d)}`);
  cmp('early deaths', out.tilt.earlyDeaths);
  cmp('isolated deaths', out.tilt.isolatedDeaths);
  cmp('CS at 10', out.tilt.csAt10, 0);
  console.log('  verdict: ' + (out.tilt.degraded
    ? 'inputs degrade — this is real tilt'
    : 'inputs hold up — looks like variance, not tilt'));
}

console.log('\nEVIDENCE (outcomes — reported, never coached on)');
for (const r of out.reference) {
  console.log('  ' + r.label.padEnd(30) + f(r.current, r.decimals).padStart(7) + (r.unit || ''));
}
console.log('');
