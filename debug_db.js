const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('=== Database Debug Info ===\n');

db.get("SELECT COUNT(*) as total FROM matches", (err, row) => {
    if (err) {
        console.error('Error:', err);
        return;
    }
    console.log(`Total matches in DB: ${row.total}`);
});

db.get("SELECT MAX(gameCreation) as newest, MIN(gameCreation) as oldest FROM matches", (err, row) => {
    if (err) {
        console.error('Error:', err);
        return;
    }
    const newestDate = new Date(row.newest);
    const oldestDate = new Date(row.oldest);
    console.log(`Newest match: ${newestDate.toISOString()}`);
    console.log(`Oldest match: ${oldestDate.toISOString()}`);
});

db.all("SELECT matchId, queueId, championName, gameCreation, datetime(gameCreation/1000, 'unixepoch') as readable FROM matches ORDER BY gameCreation DESC LIMIT 5", (err, rows) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }
    console.log('\n5 Most recent matches:');
    rows.forEach(r => {
        const date = new Date(r.gameCreation);
        console.log(`  ${r.matchId} | Queue ${r.queueId} | ${r.championName} | ${date.toISOString()}`);
    });

    db.close();
});
