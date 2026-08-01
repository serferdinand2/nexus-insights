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

function formatDamage(dmg) {
    if (!dmg) return '0';
    if (dmg >= 1000) return (dmg / 1000).toFixed(1) + 'k';
    return dmg.toString();
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
// ITEM / RUNE / SPELL HTML
// ---------------------------------------------------------------------------

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

module.exports = {
    RUNE_ICONS,
    timeAgo,
    formatDamage,
    getChampionIcon,
    renderRunes,
    getSummonerSpellImageName,
    renderSummonerSpells
};
