/**
 * matchCard.js — Pure HTML-generation helpers for match display.
 *
 * Reads window.DDRAGON_BASE and window.QUEUE_NAMES at call-time so they
 * always reflect the version resolved after DDragon loads.
 */

const { getSummonerSpellData } = require('../services/dataDragon');
const { getCachedRawJson }     = require('../services/matchService');
const { escapeHtml }           = require('./dom');

// ---------------------------------------------------------------------------
// RUNE ICON MAP
// ---------------------------------------------------------------------------
const RUNE_ICONS = {
    // Precision Keystones
    8005: 'Precision/PressTheAttack/PressTheAttack.png',
    8008: 'Precision/LethalTempo/LethalTempoTemp.png',
    8021: 'Precision/FleetFootwork/FleetFootwork.png',
    8010: 'Precision/Conqueror/Conqueror.png',
    // Domination Keystones
    8112: 'Domination/Electrocute/Electrocute.png',
    8124: 'Domination/Predator/Predator.png',
    8128: 'Domination/DarkHarvest/DarkHarvest.png',
    9923: 'Domination/HailOfBlades/HailOfBlades.png',
    // Sorcery Keystones
    8214: 'Sorcery/SummonAery/SummonAery.png',
    8229: 'Sorcery/ArcaneComet/ArcaneComet.png',
    8230: 'Sorcery/PhaseRush/PhaseRush.png',
    // Resolve Keystones
    8437: 'Resolve/GraspOfTheUndying/GraspOfTheUndying.png',
    8439: 'Resolve/VeteranAftershock/VeteranAftershock.png',
    8465: 'Resolve/Guardian/Guardian.png',
    // Inspiration Keystones
    8351: 'Inspiration/GlacialAugment/GlacialAugment.png',
    8360: 'Inspiration/UnsealedSpellbook/UnsealedSpellbook.png',
    8369: 'Inspiration/FirstStrike/FirstStrike.png',
    // Rune Tree Icons (secondary style)
    8000: '7201_Precision.png',
    8100: '7200_Domination.png',
    8200: '7202_Sorcery.png',
    8300: '7203_Whimsy.png',
    8400: '7204_Resolve.png'
};

// ---------------------------------------------------------------------------
// DISPLAY UTILITIES
// ---------------------------------------------------------------------------

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    const intervals = [
        { label: 'd', seconds: 86400 },
        { label: 'h', seconds: 3600 },
        { label: 'm', seconds: 60 }
    ];
    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) return `${count}${interval.label} ago`;
    }
    return 'Just now';
}

function formatDuration(seconds) {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDamage(dmg) {
    if (!dmg) return '0';
    if (dmg >= 1000) return (dmg / 1000).toFixed(1) + 'k';
    return dmg.toString();
}

function getPositionName(pos) {
    const positions = {
        'TOP': 'TOP', 'JUNGLE': 'JG', 'MIDDLE': 'MID',
        'BOTTOM': 'ADC', 'UTILITY': 'SUP'
    };
    return positions[pos] || pos || '';
}

// ---------------------------------------------------------------------------
// CHAMPION ICON  (URL cache to avoid redundant string builds)
// ---------------------------------------------------------------------------
const championIconCache = new Map();

function getChampionIcon(championName) {
    if (!championName) return '';
    if (championIconCache.has(championName)) return championIconCache.get(championName);

    let normalized = championName;
    const specialNames = { 'FiddleSticks': 'Fiddlesticks', 'Wukong': 'MonkeyKing' };
    if (specialNames[championName]) normalized = specialNames[championName];

    const url = `${window.DDRAGON_BASE}/img/champion/${normalized}.png`;
    championIconCache.set(championName, url);
    return url;
}

// ---------------------------------------------------------------------------
// MULTI-KILL & OBJECTIVE BADGES
// ---------------------------------------------------------------------------

function getMultiKillBadges(match) {
    const badges = [];
    if (match.pentaKills  > 0) badges.push(`<span class="multi-kill-badge penta"   data-tooltip="Penta Kill - 5 kills in quick succession (${match.pentaKills}x)">PENTA</span>`);
    if (match.quadraKills > 0) badges.push(`<span class="multi-kill-badge quadra"  data-tooltip="Quadra Kill - 4 kills in quick succession (${match.quadraKills}x)">QUADRA</span>`);
    if (match.tripleKills > 0) badges.push(`<span class="multi-kill-badge triple"  data-tooltip="Triple Kill - 3 kills in quick succession (${match.tripleKills}x)">TRIPLE</span>`);
    if (match.doubleKills > 0) badges.push(`<span class="multi-kill-badge double"  data-tooltip="Double Kill - 2 kills in quick succession (${match.doubleKills}x)">DOUBLE</span>`);
    return badges.join('');
}

function getObjectiveBadges(match) {
    const badges = [];
    if (match.dragonKills    > 0) badges.push(`<span class="objective-badge dragon"    data-tooltip="Dragons slain by you (${match.dragonKills}x)">DRAGON</span>`);
    if (match.baronKills     > 0) badges.push(`<span class="objective-badge baron"     data-tooltip="Baron Nashors slain by you (${match.baronKills}x)">BARON</span>`);
    if (match.turretKills    > 0) badges.push(`<span class="objective-badge tower"     data-tooltip="Turrets destroyed by you (${match.turretKills}x)">TOWER</span>`);
    if (match.inhibitorKills > 0) badges.push(`<span class="objective-badge inhibitor" data-tooltip="Inhibitors destroyed by you (${match.inhibitorKills}x)">INHIB</span>`);
    return badges.join('');
}

// ---------------------------------------------------------------------------
// ITEM / RUNE / SPELL HTML
// ---------------------------------------------------------------------------

function renderItems(match) {
    const items = [match.item0, match.item1, match.item2, match.item3, match.item4, match.item5, match.item6];
    return items.map(itemId => {
        if (itemId && itemId > 0) {
            return `<div class="item-slot has-item"><img src="${window.DDRAGON_BASE}/img/item/${itemId}.png" alt="Item" data-item-id="${itemId}" onerror="this.style.display='none'"></div>`;
        }
        return `<div class="item-slot"></div>`;
    }).join('');
}

function renderRunes(match) {
    if (!match.primaryRune && !match.secondaryRuneStyle) {
        return `<div class="rune-display"><div class="rune-empty"></div><div class="rune-empty"></div></div>`;
    }
    const primaryPath   = RUNE_ICONS[match.primaryRune]        || null;
    const secondaryPath = RUNE_ICONS[match.secondaryRuneStyle] || null;

    const primaryHTML = primaryPath
        ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/${primaryPath}" alt="Primary Rune" class="rune-icon" data-rune-id="${match.primaryRune}">`
        : '<div class="rune-empty"></div>';

    const secondaryHTML = secondaryPath
        ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/${secondaryPath}" alt=" Secondary Rune" class="rune-icon secondary" data-rune-id="${match.secondaryRuneStyle}">`
        : '<div class="rune-empty"></div>';

    return `<div class="rune-display">${primaryHTML}${secondaryHTML}</div>`;
}

function getSummonerSpellImageName(spellId) {
    const spellData = getSummonerSpellData(spellId);
    if (spellData && spellData.image) return spellData.image.full;
    const spellMap = {
        1:  'SummonerBoost.png',    3:  'SummonerExhaust.png',
        4:  'SummonerFlash.png',    6:  'SummonerHaste.png',
        7:  'SummonerHeal.png',     11: 'SummonerSmite.png',
        12: 'SummonerTeleport.png', 13: 'SummonerMana.png',
        14: 'SummonerDot.png',      21: 'SummonerBarrier.png',
        32: 'SummonerSnowball.png'
    };
    return spellMap[spellId] || 'SummonerFlash.png';
}

function renderSummonerSpells(match) {
    let spell1Id = null, spell2Id = null;
    // rawJson is no longer carried on the match row — it is prefetched into the
    // matchService cache for the visible page before this renders.
    const rawSource = match.rawJson || getCachedRawJson(match.matchId);
    if (rawSource) {
        try {
            const matchData = typeof rawSource === 'string' ? JSON.parse(rawSource) : rawSource;
            const me = (matchData.info?.participants || []).find(p => p.championName === match.championName);
            if (me) { spell1Id = me.summoner1Id; spell2Id = me.summoner2Id; }
        } catch (e) {
            console.warn('Error parsing match data for summoner spells:', e);
        }
    }
    if (!spell1Id && !spell2Id) {
        return `<div class="spell-display"><div class="spell-empty"></div><div class="spell-empty"></div></div>`;
    }
    const base  = window.DDRAGON_BASE;
    const s1img = spell1Id ? getSummonerSpellImageName(spell1Id) : null;
    const s2img = spell2Id ? getSummonerSpellImageName(spell2Id) : null;
    const spell1HTML = s1img ? `<img src="${base}/img/spell/${s1img}" alt="Spell 1" class="spell-icon" data-spell-id="${spell1Id}">` : '<div class="spell-empty"></div>';
    const spell2HTML = s2img ? `<img src="${base}/img/spell/${s2img}" alt="Spell 2" class="spell-icon" data-spell-id="${spell2Id}">` : '<div class="spell-empty"></div>';
    return `<div class="spell-display">${spell1HTML}${spell2HTML}</div>`;
}

function renderModalItems(match) {
    const items = [match.item0, match.item1, match.item2, match.item3, match.item4, match.item5, match.item6];
    return items.map(itemId => {
        if (itemId && itemId > 0) {
            return `<div class="modal-item"><img src="${window.DDRAGON_BASE}/img/item/${itemId}.png" alt="Item" onerror="this.parentElement.style.display='none'"></div>`;
        }
        return '';
    }).join('');
}

// ---------------------------------------------------------------------------
// MATCH CARD
// ---------------------------------------------------------------------------

function renderMatchCard(match, index) {
    const isWin         = match.win === 1;
    const kda           = match.deaths === 0 ? 'Perfect' : ((match.kills + match.assists) / match.deaths).toFixed(1);
    const queueName     = (window.QUEUE_NAMES || {})[match.queueId] || 'Game';
    const multiKills    = getMultiKillBadges(match);
    const objectiveBadges = getObjectiveBadges(match);
    const position      = match.teamPosition || match.lane;
    const positionBadge = position ? `<span class="position-badge ${position}">${getPositionName(position)}</span>` : '';
    const champIcon     = getChampionIcon(match.championName);

    return `
                <div class="match-card ${isWin ? 'win' : 'loss'}" onclick="openMatchModal(${index})">
                    <div class="match-champion">
                        ${champIcon ? `<img src="${champIcon}" alt="${escapeHtml(match.championName)}" onerror="this.parentElement.textContent='${escapeHtml(match.championName ? match.championName.charAt(0) : '?')}'">` : (match.championName ? match.championName.charAt(0) : '?')}
                    </div>
                    <div class="match-info">
                        <div class="match-primary">
                            <span class="match-champion-name">${escapeHtml(match.championName || 'Unknown')}</span>
                            ${positionBadge}
                            <span class="match-result ${isWin ? 'win' : 'loss'}">${isWin ? 'Victory' : 'Defeat'}</span>
                        </div>
                        <div class="match-secondary">${queueName} · ${formatDuration(match.gameDuration)} · Lvl ${match.champLevel || '?'}</div>
                        <div class="multi-kills">${multiKills}${objectiveBadges}</div>
                        <div class="match-items">${renderItems(match)}</div>
                    </div>
                    <div class="match-stats">
                        <div class="match-kda">
                            <div class="kda-value">${match.kills}/${match.deaths}/${match.assists}</div>
                            <div class="kda-label">${kda} KDA</div>
                        </div>
                        <div class="match-stat-item">
                            <div class="stat-item-value">${match.totalMinionsKilled || 0}</div>
                            <div class="stat-item-label">CS</div>
                        </div>
                        <div class="match-stat-item">
                            <div class="stat-item-value">${formatDamage(match.totalDamageDealtToChampions)}</div>
                            <div class="stat-item-label">DMG</div>
                        </div>
                        <div class="match-stat-item">
                            <div class="stat-item-value">${match.wardsPlaced || 0}</div>
                            <div class="stat-item-label">Wards</div>
                        </div>
                        <div class="match-time">
                            <div class="time-value">${match.gameCreation ? timeAgo(match.gameCreation) : ''}</div>
                        </div>
                    </div>
                </div>
            `;
}

module.exports = {
    RUNE_ICONS,
    timeAgo,
    formatDuration,
    formatDamage,
    getPositionName,
    getChampionIcon,
    getMultiKillBadges,
    getObjectiveBadges,
    renderItems,
    renderRunes,
    getSummonerSpellImageName,
    renderSummonerSpells,
    renderModalItems,
    renderMatchCard
};
