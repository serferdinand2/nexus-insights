const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stubDatabase, makeMatch, SRC } = require('./helpers');

stubDatabase([]);
global.window = {};
require(path.join(SRC, 'components', 'analyticsEngine.js'));
const statHistory = require(path.join(SRC, 'components', 'statHistory.js'));
const T = require(path.join(SRC, 'components', 'chatTools.js'));

const at = (y, m, d) => new Date(y, m, d, 20, 0, 0).getTime();

const matches = [
    makeMatch({ championName: 'Ahri',      teamPosition: 'MIDDLE', queueId: 420, win: 1, kills: 9, deaths: 2, assists: 7,  gameCreation: at(2026, 8, 3) }),
    makeMatch({ championName: 'Ahri',      teamPosition: 'MIDDLE', queueId: 420, win: 0, kills: 3, deaths: 7, assists: 4,  gameCreation: at(2026, 8, 5), gameDuration: 2400 }),
    makeMatch({ championName: 'LeeSin',    teamPosition: 'JUNGLE', queueId: 440, win: 1, kills: 6, deaths: 3, assists: 11, gameCreation: at(2026, 8, 7) }),
    makeMatch({ championName: 'MonkeyKing',teamPosition: 'TOP',    queueId: 400, win: 0, kills: 2, deaths: 5, assists: 1,  gameCreation: at(2026, 9, 1) }),
    makeMatch({ championName: 'Kaisa',     teamPosition: 'BOTTOM', queueId: 420, win: 1, kills: 12,deaths: 1, assists: 5,  gameCreation: at(2026, 9, 2), teamKills: 0 }),
];

const ctx = {
    matches,
    computeTabStats: window.computeTabStats,
    statHistory,
    now: () => new Date(2026, 9, 8),
    lpDeltas: {},
};

test('filters: queue, champion (incl. spaces and display names), role, dates, last N', () => {
    const { applyFilters } = T._internal;
    assert.equal(applyFilters(matches, { queue: 'solo' }).matches.length, 3);
    assert.equal(applyFilters(matches, { queue: 'ranked' }).matches.length, 4);
    assert.equal(applyFilters(matches, { champion: 'lee sin' }).matches.length, 1);
    assert.equal(applyFilters(matches, { champion: 'Wukong' }).matches.length, 1, 'Wukong is MonkeyKing internally');
    assert.equal(applyFilters(matches, { champion: "Kai'Sa" }).matches.length, 1);
    assert.equal(applyFilters(matches, { role: 'adc' }).matches.length, 1);
    assert.equal(applyFilters(matches, { role: 'mid' }).matches.length, 2);
    assert.equal(applyFilters(matches, { since: '2026-10-01' }).matches.length, 2);
    assert.equal(applyFilters(matches, { until: '2026-09-05' }).matches.length, 2, 'until includes that whole day');
    const last2 = applyFilters(matches, { last_n_games: 2 }).matches;
    assert.deepEqual(last2.map(m => m.championName), ['Kaisa', 'MonkeyKing'], 'newest first');
});

test('bad filter input comes back as an error the model can relay, not an exception', async () => {
    for (const args of [{ queue: 'aram' }, { champion: 'Teemo' }, { role: 'goalkeeper' }, { since: 'last week' }]) {
        const out = await T.executeTool('get_overview', args, ctx);
        assert.ok(out.error, `expected an error for ${JSON.stringify(args)}`);
    }
    assert.ok((await T.executeTool('no_such_tool', {}, ctx)).error);
    // arguments arriving as a JSON string (some models do this) still work
    const out = await T.executeTool('get_overview', '{"queue":"solo"}', ctx);
    assert.equal(out.games, 3);
});

test('chat numbers match the Overview cards exactly', async () => {
    const out = await T.executeTool('get_overview', { queue: 'solo' }, ctx);
    const solo = matches.filter(m => m.queueId === 420);
    const card = id => window.computeTabStats('Overview', solo, []).find(c => c.id === id).value;
    assert.equal(out.win_rate_pct, Number(card('win_rate').toFixed(1)));
    assert.equal(out.kda, Number(card('avg_kda').toFixed(2)));
    assert.equal(out.cs_per_min, Number(card('avg_csm').toFixed(2)));
    assert.equal(out.damage_per_min, Number(card('dmg_min').toFixed(0)));
    // includes the game with zero team kills as 0%, like the card
    assert.equal(out.kill_participation_pct, Number(card('avg_kp').toFixed(1)));
    assert.ok(out.rank_tiers && out.rank_tiers['Win Rate'], 'tiers come from the cards');
});

test('category stats are the tab\'s own cards', async () => {
    const out = await T.executeTool('get_category_stats', { category: 'vision' }, ctx);
    assert.equal(out.category, 'Vision');
    const labels = window.computeTabStats('Vision', matches, []).map(c => c.label);
    assert.deepEqual(out.stats.map(s => s.stat), labels);
});

test('stat trend resolves a stat by its display name and returns 12 months', async () => {
    const out = await T.executeTool('get_stat_trend', { stat: 'avg kda' }, ctx);
    assert.equal(out.stat, 'Avg KDA');
    assert.equal(out.months.length, 12);
    assert.equal(out.months[11].month, '2026-10');
    assert.equal(out.months[11].partial_month, true);
    assert.equal(out.months.find(m => m.month === '2026-09').games, 3);
    assert.ok((await T.executeTool('get_stat_trend', { stat: 'Total Matches' }, ctx)).error,
        'stats without a monthly trend are refused');
});

test('champion and role breakdowns', async () => {
    const champs = await T.executeTool('get_champion_stats', { min_games: 1, sort_by: 'games' }, ctx);
    assert.equal(champs.champions[0].champion, 'Ahri');
    assert.equal(champs.champions[0].games, 2);
    const roles = await T.executeTool('get_role_stats', {}, ctx);
    assert.equal(roles.roles.reduce((s, r) => s + r.games, 0), matches.length);
});

test('recent games are newest first and capped', async () => {
    const out = await T.executeTool('get_recent_games', { count: 2 }, ctx);
    assert.equal(out.games.length, 2);
    assert.equal(out.games[0].champion, 'Kaisa');
    assert.equal(out.games[0].result, 'Win');
    assert.equal(out.games[0].kda, '12/1/5');
});

test('every tool has a schema the model can read', () => {
    for (const s of T.toolSchemas()) {
        assert.equal(s.type, 'function');
        assert.ok(s.function.name && s.function.description.length > 20);
        assert.equal(s.function.parameters.type, 'object');
    }
    assert.equal(T.describeCall('get_champion_stats', { queue: 'solo', champion: 'Ahri' }), 'champion stats (solo, Ahri)');
});
