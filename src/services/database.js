const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { compressJson } = require('./compression');
const { userDataPath } = require('./paths');

const dbPath = path.join(userDataPath, 'nexus_data.sqlite');
const db = new sqlite3.Database(dbPath);

// Promisify db methods for migration
function dbRunAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGetAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAllAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Run database migrations (called after schema setup).
 * Migration 1: Compress rawJson/timelineJson TEXT → gzip BLOB
 */
async function runMigrations() {
  // Create schema_version table if it doesn't exist
  await dbRunAsync(`
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )
    `);

  // Each migration is independent and self-skipping. Migration 1 used to
  // `return` when already applied, which silently prevented every later
  // migration from ever running.
  await migrateCompressJson();
  await migrateLpResolution();
}

/**
 * Migration 3 — let LP history hold more than one reading per day.
 *
 * The original table had a UNIQUE index on (queue, recorded_date) and wrote
 * with ON CONFLICT DO UPDATE, so a second reading on the same day overwrote
 * the first. That capped the LP chart at one point per day and made per-match
 * LP impossible. This drops the constraint and adds the matchId link.
 */
async function migrateLpResolution() {
  const done = await dbGetAsync('SELECT version FROM schema_version WHERE version = 3');
  if (done) return;

  console.log('Running migration 3: per-reading LP history...');

  await dbRunAsync('DROP INDEX IF EXISTS idx_lp_queue_date');

  const cols = await dbAllAsync('PRAGMA table_info(lp_history)');
  if (!cols.some(c => c.name === 'matchId')) {
    await dbRunAsync('ALTER TABLE lp_history ADD COLUMN matchId TEXT');
  }

  await dbRunAsync('CREATE INDEX IF NOT EXISTS idx_lp_queue_time ON lp_history(queue, recorded_at)');
  await dbRunAsync('CREATE INDEX IF NOT EXISTS idx_lp_match ON lp_history(matchId)');

  await dbRunAsync(
    'INSERT INTO schema_version (version, applied_at) VALUES (3, ?)',
    [Date.now()]
  );
  console.log('Migration 3 complete — LP history can now hold intra-day readings.');
}

async function migrateCompressJson() {
  // Check if migration 1 (compression) has already been applied
  const migrationDone = await dbGetAsync(
    'SELECT version FROM schema_version WHERE version = 1'
  );

  if (migrationDone) {
    console.log('Migration 1 (JSON compression) already applied.');
    return;
  }

  console.log('Running migration 1: Compressing rawJson/timelineJson...');

  // Backup the database file before migration
  const backupPath = dbPath.replace('.sqlite', '.backup.sqlite');
  try {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`Database backup created at: ${backupPath}`);
  } catch (err) {
    console.error('Failed to create backup, aborting migration:', err.message);
    return;
  }

  // Row-by-row, ids first. The previous version selected every blob in one
  // query — >130MB of JSON strings in memory at once — which is what kept
  // this migration from ever completing on a real database. Only rows whose
  // blobs are still legacy TEXT are touched, so an interrupted run resumes
  // where it stopped.
  const ids = await dbAllAsync(`
    SELECT matchId FROM matches
    WHERE typeof(rawJson) = 'text' OR typeof(timelineJson) = 'text'
  `);

  let compressed = 0, failed = 0;
  for (const { matchId } of ids) {
    try {
      const row = await dbGetAsync(
        'SELECT rawJson, timelineJson FROM matches WHERE matchId = ?',
        [matchId]
      );
      const rawBuf = typeof row.rawJson === 'string' ? compressJson(row.rawJson) : row.rawJson;
      const tlBuf  = typeof row.timelineJson === 'string' ? compressJson(row.timelineJson) : row.timelineJson;

      await dbRunAsync(
        'UPDATE matches SET rawJson = ?, timelineJson = ? WHERE matchId = ?',
        [rawBuf, tlBuf, matchId]
      );
      compressed++;

      if (compressed % 50 === 0) {
        console.log(`  Compressed ${compressed}/${ids.length} matches...`);
      }
    } catch (err) {
      failed++;
      console.warn(`  Failed to compress match ${matchId}:`, err.message);
    }
  }

  console.log(`Compressed ${compressed}/${ids.length} matches (${failed} failed).`);

  // Only mark done when nothing was left behind — a partial run retries next
  // launch and skips the rows it already converted.
  if (failed > 0) {
    console.warn('Migration 1 incomplete — will retry the failed rows on next launch.');
    return;
  }

  await dbRunAsync(
    'INSERT INTO schema_version (version, applied_at) VALUES (1, ?)',
    [Date.now()]
  );

  // VACUUM to reclaim space
  console.log('Running VACUUM to reclaim disk space...');
  await dbRunAsync('VACUUM');
  console.log('Migration 1 complete!');
}

function initDatabase() {
  db.serialize(() => {
    // We use matchId as a UNIQUE primary key to prevent duplicates automatically
    db.run(`
      CREATE TABLE IF NOT EXISTS matches (
        matchId TEXT PRIMARY KEY,
        queueId INTEGER,
        gameCreation INTEGER,
        gameDuration INTEGER,
        championName TEXT,
        champLevel INTEGER,
        kills INTEGER,
        deaths INTEGER,
        assists INTEGER,
        win BOOLEAN,
        goldEarned INTEGER,
        totalMinionsKilled INTEGER,
        totalDamageDealtToChampions INTEGER,
        visionScore INTEGER,
        doubleKills INTEGER,
        tripleKills INTEGER,
        quadraKills INTEGER,
        pentaKills INTEGER,
        -- Objectives (player individual)
        turretKills INTEGER,
        inhibitorKills INTEGER,
        dragonKills INTEGER,
        baronKills INTEGER,
        objectivesStolen INTEGER,
        -- Detailed Vision
        wardsPlaced INTEGER,
        wardsKilled INTEGER,
        detectorWardsPlaced INTEGER,
        -- Position/Role
        teamPosition TEXT,
        lane TEXT,
        -- Items (final build)
        item0 INTEGER,
        item1 INTEGER,
        item2 INTEGER,
        item3 INTEGER,
        item4 INTEGER,
        item5 INTEGER,
        item6 INTEGER,
        -- Team objectives
        teamDragons INTEGER,
        enemyDragons INTEGER,
        teamBarons INTEGER,
        enemyBarons INTEGER,
        teamRiftHeralds INTEGER,
        enemyRiftHeralds INTEGER,
        teamTowers INTEGER,
        enemyTowers INTEGER,
        teamInhibitors INTEGER,
        enemyInhibitors INTEGER,
        teamId INTEGER,
        teamKills INTEGER,
        rawJson TEXT,
        timelineJson TEXT,
        -- Advanced stats (computed from rawJson/timelineJson)
        csDiff15 INTEGER,
        goldDiff15 INTEGER,
        xpDiff15 INTEGER,
        firstBlood INTEGER,
        dmgGoldRatio REAL,
        isolatedDeaths INTEGER,
        objectiveRate REAL,
        -- Precomputed per-match values for the analytics tabs (see
        -- computeAdvancedStatsForMatch). Stored so the tabs never have to
        -- re-parse rawJson/timelineJson at render time.
        cs10 INTEGER,
        cs15 INTEGER,
        cs20 INTEGER,
        deathsBefore10 INTEGER,
        platesTaken INTEGER,
        platesLost INTEGER,
        soloKillDiff INTEGER,
        dmgShare REAL,
        killParticipation REAL,
        dmgTakenPerDeath REAL,
        multikills INTEGER,
        shutdownsClaimed INTEGER,
        shutdownsGiven INTEGER,
        shutdownBountyGiven INTEGER,
        enemyTeamKills INTEGER,
        visionAdvantage REAL,
        goldShare REAL,
        -- Set whenever the precomputed values above are written. Used as
        -- the "has this row been indexed?" marker: any individual stat can
        -- legitimately be NULL (a 2-minute remake has no damage share), so
        -- none of them is safe to test on its own.
        statsComputedAt INTEGER,
        -- 1 when the game ended in an early surrender (a remake). Riot's
        -- own gameEndedInEarlySurrender flag, with a duration fallback.
        isRemake INTEGER
      )
    `);

    // Player ranks cache table
    db.run(`
      CREATE TABLE IF NOT EXISTS player_ranks (
        puuid TEXT PRIMARY KEY,
        soloTier TEXT,
        soloRank TEXT,
        soloLP INTEGER,
        flexTier TEXT,
        flexRank TEXT,
        flexLP INTEGER,
        fetchedAt INTEGER NOT NULL
      )
    `);

    // LP progression history — one row per *observed change*, not per day.
    // Riot only ever reports current LP, so a reading is a point-in-time
    // observation; the finer the readings, the closer we get to per-match LP.
    // `matchId` links a reading to the game that caused it once that game has
    // been synced (see attachLpReadingsToMatches).
    db.run(`
      CREATE TABLE IF NOT EXISTS lp_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue TEXT NOT NULL,
        tier TEXT,
        rank TEXT,
        lp INTEGER NOT NULL,
        recorded_date TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        matchId TEXT
      )
    `);
    // NOTE: deliberately NOT unique on (queue, recorded_date) any more — that
    // constraint is exactly what limited the chart to one point per day.
    // Migration 3 drops it for existing databases.
    //
    // Only index columns that are guaranteed to exist here. On a database
    // created before migration 3, CREATE TABLE IF NOT EXISTS is a no-op, so
    // `matchId` isn't there yet — indexing it at this point throws
    // "no such column: matchId" and, with no callback to absorb it, takes the
    // main process down. idx_lp_match is created by migration 3 instead,
    // immediately after the ALTER that adds the column.
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_lp_queue_time
      ON lp_history(queue, recorded_at)
    `, err => {
      if (err) console.warn('idx_lp_queue_time not created:', err.message);
    });

    // Add indexes for performance
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_gameCreation 
      ON matches(gameCreation DESC)
    `, () => {
      console.log('Index idx_gameCreation ensured');
    });

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_championName
      ON matches(championName)
    `, () => {
      console.log('Index idx_championName ensured');
    });

    // Coaching + queue-scoped queries filter on (queueId, gameCreation)
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_queue_time
      ON matches(queueId, gameCreation)
    `, () => {
      console.log('Index idx_queue_time ensured');
    });

    // Add new columns for existing databases (will silently fail if already exists)
    const newColumns = [
      'gameDuration INTEGER',
      'champLevel INTEGER',
      'totalDamageDealtToChampions INTEGER',
      'visionScore INTEGER',
      'doubleKills INTEGER',
      'tripleKills INTEGER',
      'quadraKills INTEGER',
      'pentaKills INTEGER',
      // Objectives
      'turretKills INTEGER',
      'inhibitorKills INTEGER',
      'dragonKills INTEGER',
      'baronKills INTEGER',
      'objectivesStolen INTEGER',
      // Detailed Vision
      'wardsPlaced INTEGER',
      'wardsKilled INTEGER',
      'detectorWardsPlaced INTEGER',
      // Position/Role
      'teamPosition TEXT',
      'lane TEXT',
      // Items
      'item0 INTEGER',
      'item1 INTEGER',
      'item2 INTEGER',
      'item3 INTEGER',
      'item4 INTEGER',
      'item5 INTEGER',
      'item6 INTEGER',
      // Team objectives
      'teamDragons INTEGER',
      'enemyDragons INTEGER',
      'teamBarons INTEGER',
      'enemyBarons INTEGER',
      'teamRiftHeralds INTEGER',
      'enemyRiftHeralds INTEGER',
      'teamTowers INTEGER',
      'enemyTowers INTEGER',
      'teamInhibitors INTEGER',
      'enemyInhibitors INTEGER',
      'teamId INTEGER',
      'teamKills INTEGER',
      // Runes
      'primaryRune INTEGER',
      'secondaryRuneStyle INTEGER',
      // Timeline
      'timelineJson TEXT',
      // Advanced stats
      'csDiff15 INTEGER',
      'goldDiff15 INTEGER',
      'xpDiff15 INTEGER',
      'firstBlood INTEGER',
      'dmgGoldRatio REAL',
      'isolatedDeaths INTEGER',
      'objectiveRate REAL',
      // Precomputed analytics values
      'cs10 INTEGER',
      'cs15 INTEGER',
      'cs20 INTEGER',
      'deathsBefore10 INTEGER',
      'platesTaken INTEGER',
      'platesLost INTEGER',
      'soloKillDiff INTEGER',
      'dmgShare REAL',
      'killParticipation REAL',
      'dmgTakenPerDeath REAL',
      'multikills INTEGER',
      'shutdownsClaimed INTEGER',
      'shutdownsGiven INTEGER',
      'shutdownBountyGiven INTEGER',
      'enemyTeamKills INTEGER',
      'visionAdvantage REAL',
      'goldShare REAL',
      'statsComputedAt INTEGER',
      'isRemake INTEGER'
    ];
    // Only ALTER for columns that are actually missing — the old code fired
    // ~60 failing ALTERs on every launch. This also acts as the completion
    // sentinel: it runs after everything queued above, so migrations are
    // guaranteed to see the final schema (no timer race).
    db.all('PRAGMA table_info(matches)', (err, cols) => {
      const startMigrations = () => {
        console.log('Database initialized at:', dbPath);
        runMigrations().catch(e => console.error('Migration error:', e));
      };
      if (err) { console.error('PRAGMA table_info failed:', err); return startMigrations(); }

      const existing = new Set(cols.map(c => c.name));
      const missing  = newColumns.filter(def => !existing.has(def.split(' ')[0]));
      if (missing.length === 0) return startMigrations();

      let remaining = missing.length;
      for (const col of missing) {
        db.run(`ALTER TABLE matches ADD COLUMN ${col}`, alterErr => {
          if (alterErr) console.warn(`ALTER failed for ${col}:`, alterErr.message);
          if (--remaining === 0) startMigrations();
        });
      }
    });
  });
}

/**
 * Save (or overwrite) today's LP snapshot for a given queue.
 */
function saveLpSnapshot(queue, tier, rank, lp) {
  return recordLpReading(queue, tier, rank, lp);
}

/**
 * Record an LP observation, but only when it actually differs from the last
 * one we saw. The background watcher polls every few minutes; without this
 * guard an idle evening would write hundreds of identical rows.
 *
 * Resolves to { changed, delta, previous } so the caller can react to a real
 * LP movement (refresh the chart, attribute it to a match) without re-querying.
 */
function recordLpReading(queue, tier, rank, lp, matchId = null) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, tier, rank, lp, recorded_at FROM lp_history
       WHERE queue = ? ORDER BY recorded_at DESC LIMIT 1`,
      [queue],
      (err, prev) => {
        if (err) return reject(err);

        if (prev && prev.tier === tier && prev.rank === rank && prev.lp === lp) {
          return resolve({ changed: false, delta: 0, previous: prev });
        }

        const now   = Date.now();
        const today = new Date().toISOString().slice(0, 10);
        db.run(
          `INSERT INTO lp_history (queue, tier, rank, lp, recorded_date, recorded_at, matchId)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [queue, tier, rank, lp, today, now, matchId],
          function (insErr) {
            if (insErr) return reject(insErr);
            const delta = prev
              ? absoluteLp(tier, rank, lp) - absoluteLp(prev.tier, prev.rank, prev.lp)
              : 0;
            resolve({ changed: true, delta, previous: prev || null, id: this.lastID });
          }
        );
      }
    );
  });
}

/**
 * Collapse tier + division + LP into one continuous number so a delta stays
 * correct across a promotion (Gold I 98 → Platinum IV 8 is +10, not −90).
 */
const LP_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const LP_DIVS  = { IV: 0, III: 1, II: 2, I: 3 };

function absoluteLp(tier, rank, lp) {
  const t = String(tier || '').toUpperCase();
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].indexOf(t);
  if (apex >= 0) return LP_TIERS.length * 400 + lp;
  const ti = LP_TIERS.indexOf(t);
  if (ti < 0) return lp;
  return ti * 400 + (LP_DIVS[String(rank || 'IV').toUpperCase()] ?? 0) * 100 + lp;
}

/**
 * Seed a historical LP snapshot — skips the day if anything is already logged
 * for it. (The old INSERT OR IGNORE relied on the unique index that migration
 * 3 removes, so the emptiness check now has to be explicit.)
 */
function seedLpSnapshot(queue, tier, rank, lp, date) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT 1 AS hit FROM lp_history WHERE queue = ? AND recorded_date = ? LIMIT 1',
      [queue, date],
      (err, row) => {
        if (err) return reject(err);
        if (row) return resolve({ seeded: false });
        db.run(
          `INSERT INTO lp_history (queue, tier, rank, lp, recorded_date, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [queue, tier, rank, lp, date, new Date(date + 'T12:00:00Z').getTime()],
          function (insErr) { if (insErr) reject(insErr); else resolve({ seeded: true }); }
        );
      }
    );
  });
}

/**
 * Daily LP history for a queue, oldest first — the last reading of each day.
 * Keeps the LP progression chart on one point per day now that the table can
 * hold several.
 */
function getLpHistory(queue) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT recorded_date, tier, rank, lp FROM lp_history
       WHERE queue = ? AND recorded_at = (
         SELECT MAX(inner.recorded_at) FROM lp_history AS inner
         WHERE inner.queue = lp_history.queue
           AND inner.recorded_date = lp_history.recorded_date
       )
       ORDER BY recorded_date ASC`,
      [queue],
      (err, rows) => { if (err) reject(err); else resolve(rows || []); }
    );
  });
}

/**
 * Every individual reading for a queue, oldest first — the fine-grained series
 * behind per-match LP.
 */
function getLpReadings(queue) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, recorded_date, recorded_at, tier, rank, lp, matchId
       FROM lp_history WHERE queue = ? ORDER BY recorded_at ASC`,
      [queue],
      (err, rows) => { if (err) reject(err); else resolve(rows || []); }
    );
  });
}

/**
 * Link unattributed LP readings to the ranked game that caused them.
 *
 * A reading taken at time T belongs to the most recent ranked match that had
 * already finished by T. The 3-hour window stops a reading taken after a long
 * break from being blamed on a game from yesterday.
 */
function attachLpReadingsToMatches() {
  const QUEUE_IDS = { solo: 420, flex: 440 };
  const WINDOW_MS = 3 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, queue, recorded_at FROM lp_history
       WHERE matchId IS NULL AND recorded_at IS NOT NULL`,
      async (err, rows) => {
        if (err) return reject(err);
        let linked = 0;
        try {
          for (const row of rows) {
            const queueId = QUEUE_IDS[row.queue];
            if (!queueId) continue;
            const match = await new Promise((res, rej) => {
              db.get(
                `SELECT matchId FROM matches
                 WHERE queueId = ?
                   AND (gameCreation + gameDuration * 1000) <= ?
                   AND (gameCreation + gameDuration * 1000) >= ?
                 ORDER BY gameCreation DESC LIMIT 1`,
                [queueId, row.recorded_at, row.recorded_at - WINDOW_MS],
                (e, m) => (e ? rej(e) : res(m))
              );
            });
            if (!match) continue;
            await new Promise((res, rej) => {
              db.run(
                'UPDATE lp_history SET matchId = ? WHERE id = ?',
                [match.matchId, row.id],
                e => (e ? rej(e) : res())
              );
            });
            linked++;
          }
          resolve({ linked, considered: rows.length });
        } catch (e) { reject(e); }
      }
    );
  });
}

/**
 * Per-match LP change: { matchId: delta }. Only covers matches that had a
 * reading taken after them AND a prior reading to measure from, so games
 * played before the watcher existed are simply absent.
 */
async function getLpDeltasByMatch() {
  const out = {};
  for (const queue of ['solo', 'flex']) {
    const readings = await getLpReadings(queue);
    for (let i = 1; i < readings.length; i++) {
      const cur = readings[i];
      if (!cur.matchId) continue;
      const prev = readings[i - 1];
      out[cur.matchId] = absoluteLp(cur.tier, cur.rank, cur.lp) -
                         absoluteLp(prev.tier, prev.rank, prev.lp);
    }
  }
  return out;
}

module.exports = {
  initDatabase, db, dbPath,
  saveLpSnapshot, seedLpSnapshot, getLpHistory,
  recordLpReading, getLpReadings, attachLpReadingsToMatches,
  getLpDeltasByMatch, absoluteLp
};
