const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'nexus-insights', 'nexus_data.sqlite');
const db = new sqlite3.Database(dbPath);

db.get(`SELECT championName, kills, deaths, assists, win, gameCreation, queueId, gameDuration 
        FROM matches 
        ORDER BY gameCreation DESC 
        LIMIT 1`, (err, row) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    if (!row) {
        console.log('No matches found in database');
        db.close();
        return;
    }

    const date = new Date(row.gameCreation);
    const kda = row.deaths > 0 ? ((row.kills + row.assists) / row.deaths).toFixed(2) : 'Perfect';
    const result = row.win ? 'Victory' : 'Defeat';
    const duration = Math.floor(row.gameDuration / 60);

    console.log('\n=== NEWEST MATCH ===');
    console.log(`Champion: ${row.championName}`);
    console.log(`KDA: ${row.kills}/${row.deaths}/${row.assists} (${kda} KDA)`);
    console.log(`Result: ${result}`);
    console.log(`Queue: ${row.queueId}`);
    console.log(`Duration: ${duration} minutes`);
    console.log(`Date: ${date.toLocaleString()}`);

    db.close();
});
