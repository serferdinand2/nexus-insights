/**
 * matchModal.js — Match detail modal and inline expanded table rows.
 * Reads window.matchesData, window.DDRAGON_BASE, window.QUEUE_NAMES at call-time.
 */

const { getMatchById, getMatchParticipantRanks } = require('../services/matchService');
const { evaluateBadges }                          = require('./badgeEvaluator');
const { escapeHtml }                              = require('./dom');
const {
    RUNE_ICONS,
    getChampionIcon,
    formatDuration,
    formatDamage,
    timeAgo,
    getPositionName,
    getSummonerSpellImageName,
    renderModalItems
} = require('./matchCard');

// Badge evaluation cache — avoids re-evaluating on repeated expands
const badgeCache = new Map();

// ---------------------------------------------------------------------------
// EXPANDED ROW HELPERS
// ---------------------------------------------------------------------------

function formatDiff(val) {
    if (val === null || val === undefined) return '-';
    const num = parseInt(val);
    return num > 0 ? '+' + num : num.toString();
}

function getDiffColor(val) {
    if (val === null || val === undefined) return '#8a8a9a';
    return val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#8a8a9a';
}

function renderPlayerRow(player, gameDuration) {
    const kda    = player.deaths === 0 ? 'Perfect' : ((player.kills + player.assists) / player.deaths).toFixed(2);
    const kdaNum = player.deaths === 0 ? 99 : (player.kills + player.assists) / player.deaths;
    const champIcon = getChampionIcon(player.championName);
    const csPerMin  = gameDuration > 0 ? (player.cs / (gameDuration / 60)).toFixed(1) : '0.0';
    const DDRAGON   = window.DDRAGON_BASE;

    const itemsTop    = player.items.slice(0, 3).map(id =>
        id && id > 0 ? `<img src="${DDRAGON}/img/item/${id}.png" class="team-item-sm" data-item-id="${id}" alt="Item">` : `<div class="team-item-empty-sm"></div>`
    ).join('');
    const itemsBottom = player.items.slice(3, 7).map(id =>
        id && id > 0 ? `<img src="${DDRAGON}/img/item/${id}.png" class="team-item-sm" data-item-id="${id}" alt="Item">` : `<div class="team-item-empty-sm"></div>`
    ).join('');

    const primaryPath   = RUNE_ICONS[player.primaryRune]        || null;
    const secondaryPath = RUNE_ICONS[player.secondaryRuneStyle] || null;
    const runesHTML = `
        <div class="team-runes-sm">
            ${primaryPath   ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/${primaryPath}"   class="team-rune-sm" data-rune-id="${player.primaryRune}" alt="Primary">` : '<div class="team-rune-empty-sm"></div>'}
            ${secondaryPath ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/${secondaryPath}" class="team-rune-sm team-rune-secondary-sm" data-rune-id="${player.secondaryRuneStyle}" alt="Secondary">` : '<div class="team-rune-empty-sm"></div>'}
        </div>`;

    const spell1Img = player.summoner1Id ? getSummonerSpellImageName(player.summoner1Id) : null;
    const spell2Img = player.summoner2Id ? getSummonerSpellImageName(player.summoner2Id) : null;
    const spellsHTML = `
        <div class="team-spells-sm">
            ${spell1Img ? `<img src="${DDRAGON}/img/spell/${spell1Img}" class="team-spell-sm" data-spell-id="${player.summoner1Id}" alt="Spell 1">` : '<div class="team-spell-empty-sm"></div>'}
            ${spell2Img ? `<img src="${DDRAGON}/img/spell/${spell2Img}" class="team-spell-sm" data-spell-id="${player.summoner2Id}" alt="Spell 2">` : '<div class="team-spell-empty-sm"></div>'}
        </div>`;

    return `
        <tr class="${player.isCurrentPlayer ? 'current-player-row' : ''}">
            <td class="team-player-cell">
                <img src="${champIcon}" class="team-champion-icon-sm" alt="${escapeHtml(player.championName)}">
                <span class="team-player-name-sm">${escapeHtml(player.summonerName)}</span>
            </td>
            <td class="team-items-cell-sm">
                <div class="items-row-sm">${itemsTop}</div>
                <div class="items-row-sm">${itemsBottom}</div>
            </td>
            <td class="team-cell-center">${runesHTML}</td>
            <td class="team-cell-center">${spellsHTML}</td>
            <td class="team-cell-center">${player.kills}</td>
            <td class="team-cell-center">${player.deaths}</td>
            <td class="team-cell-center">${player.assists}</td>
            <td class="team-cell-center" style="color:${kdaNum >= 3 ? '#22c55e' : kdaNum >= 2 ? '#fbbf24' : '#ef4444'};font-weight:600">${kda}</td>
            <td class="team-cell-center">${player.cs}</td>
            <td class="team-cell-center">${csPerMin}</td>
            <td class="team-cell-center">${player.level}</td>
            <td class="team-cell-center">${formatDamage(player.damage)}</td>
            <td class="team-cell-center" style="color:${getDiffColor(player.goldDiff15)}">${formatDiff(player.goldDiff15)}</td>
            <td class="team-cell-center" style="color:${getDiffColor(player.xpDiff15)}">${formatDiff(player.xpDiff15)}</td>
            <td class="team-cell-center">${player.dmgGoldRatio}</td>
            <td class="team-cell-center">${player.totalPings}</td>
            <td class="team-cell-center">${player.controlWardsBought}</td>
            <td class="team-cell-center">${formatDamage(player.towerDamage)}</td>
        </tr>`;
}

function buildTeamData(match) {
    const teamData = { team100: [], team200: [] };
    if (!match.rawJson) return teamData;

    let timelineFrames = null;
    try {
        const matchData    = typeof match.rawJson === 'string' ? JSON.parse(match.rawJson) : match.rawJson;
        const participants = matchData.info?.participants || [];

        if (match.timelineJson) {
            const timeline  = typeof match.timelineJson === 'string' ? JSON.parse(match.timelineJson) : match.timelineJson;
            timelineFrames  = timeline?.info?.frames || null;
        }

        // Build position map for lane-opponent lookups
        const positionMap = {};
        participants.forEach((p, idx) => {
            const pos = p.teamPosition || p.lane || '';
            positionMap[`${p.teamId}-${pos}`] = { participantId: p.participantId || (idx + 1), ...p };
        });

        participants.forEach((p, idx) => {
            const participantId = p.participantId || (idx + 1);
            const position      = p.teamPosition || p.lane || '';
            let gd15 = null, xpd15 = null;

            if (timelineFrames && position) {
                const frame15  = timelineFrames[15] || timelineFrames[timelineFrames.length - 1];
                const oppTeam  = p.teamId === 100 ? 200 : 100;
                const opponent = positionMap[`${oppTeam}-${position}`];
                if (frame15?.participantFrames && opponent) {
                    const myFrame  = frame15.participantFrames[participantId];
                    const oppFrame = frame15.participantFrames[opponent.participantId];
                    if (myFrame && oppFrame) {
                        gd15  = (myFrame.totalGold || 0) - (oppFrame.totalGold || 0);
                        xpd15 = (myFrame.xp        || 0) - (oppFrame.xp        || 0);
                    }
                }
            }

            const totalPings =
                (p.allInPings||0) + (p.assistMePings||0) + (p.basicPings||0) +
                (p.commandPings||0) + (p.dangerPings||0) + (p.enemyMissingPings||0) +
                (p.enemyVisionPings||0) + (p.getBackPings||0) + (p.holdPings||0) +
                (p.needVisionPings||0) + (p.onMyWayPings||0) + (p.pushPings||0) +
                (p.visionClearedPings||0);

            const dmgGoldRatio = p.goldEarned > 0
                ? (p.totalDamageDealtToChampions / p.goldEarned).toFixed(2)
                : '0.00';

            const playerData = {
                championName: p.championName,
                summonerName: p.riotIdGameName || p.summonerName || 'Unknown',
                kills: p.kills, deaths: p.deaths, assists: p.assists,
                cs:    (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
                level: p.champLevel,
                items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
                primaryRune:        p.perks?.styles?.[0]?.selections?.[0]?.perk || null,
                secondaryRuneStyle: p.perks?.styles?.[1]?.style || null,
                summoner1Id: p.summoner1Id, summoner2Id: p.summoner2Id,
                damage:            p.totalDamageDealtToChampions || 0,
                goldDiff15: gd15,  xpDiff15: xpd15, dmgGoldRatio,
                totalPings,        controlWardsBought: p.visionWardsBoughtInGame || 0,
                towerDamage:       p.damageDealtToTurrets || 0,
                isCurrentPlayer:   p.championName === match.championName && p.teamId === match.teamId
            };

            if (p.teamId === 100) teamData.team100.push(playerData);
            else                  teamData.team200.push(playerData);
        });
    } catch (e) {
        console.error('Error parsing match data for expanded row:', e);
    }

    return teamData;
}

function createExpandedRow(match, index, badges = []) {
    const teamData       = buildTeamData(match);
    const playerOnTeam100 = teamData.team100.some(p => p.isCurrentPlayer);
    const yourTeam        = playerOnTeam100 ? teamData.team100 : teamData.team200;
    const enemyTeam       = playerOnTeam100 ? teamData.team200 : teamData.team100;

    const badgesHTML = badges.length > 0 ? `
        <div class="badges-section-top">
            <div class="badges-header">Badges Earned <span class="badges-count">${badges.length}</span></div>
            <div class="badges-grid">
                ${badges.map(b => {
                    const desc = b.description.replace(/"/g, '&apos;');
                    return `<div class="badge-pill" data-badge-tooltip="${desc}"><span class="badge-name">${b.name}</span></div>`;
                }).join('')}
            </div>
        </div>` : '';

    const tableHeader = `
        <thead><tr>
            <th>Player</th><th>Items</th><th>Runes</th><th>SP</th>
            <th>K</th><th>D</th><th>A</th><th>KDA</th><th>CS</th><th>CS/M</th><th>LVL</th><th>DMG</th>
            <th class="tooltip-header" data-column-tooltip="Gold difference vs lane opponent at 15 minutes">GD@15</th>
            <th class="tooltip-header" data-column-tooltip="XP difference vs lane opponent at 15 minutes">XPD@15</th>
            <th class="tooltip-header" data-column-tooltip="Damage dealt per gold earned - measures gold efficiency">DMG/Gold</th>
            <th>Pings</th>
            <th class="tooltip-header" data-column-tooltip="Control wards bought">CWB</th>
            <th class="tooltip-header" data-column-tooltip="Total tower damage">TTD</th>
        </tr></thead>`;

    const yourWin  = !!match.win;
    const enemyWin = !match.win;

    return `
        <tr class="expanded-row" data-match-index="${index}">
            <td colspan="100%">
                <div class="expanded-content-vertical">
                    ${badgesHTML}
                    <div class="teams-vertical">
                        <div class="team-section-full ${yourWin ? 'team-win' : 'team-loss'}">
                            <div class="team-header">${yourWin ? 'Victory' : 'Defeat'} - Your Team</div>
                            <div class="team-table-wrapper">
                                <table class="team-table-expanded">
                                    ${tableHeader}
                                    <tbody>${yourTeam.map(p => renderPlayerRow(p, match.gameDuration)).join('')}</tbody>
                                </table>
                            </div>
                        </div>
                        <div class="team-section-full ${enemyWin ? 'team-win' : 'team-loss'}">
                            <div class="team-header">${enemyWin ? 'Victory' : 'Defeat'} - Enemy Team</div>
                            <div class="team-table-wrapper">
                                <table class="team-table-expanded">
                                    ${tableHeader}
                                    <tbody>${enemyTeam.map(p => renderPlayerRow(p, match.gameDuration)).join('')}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>`;
}

// ---------------------------------------------------------------------------
// ROW EXPAND / COLLAPSE
// ---------------------------------------------------------------------------

window.toggleRowExpand = async function (index) {
    const matchesData = window.matchesData || [];
    const match       = matchesData[index];
    if (!match) return;

    const clickedRow = document.querySelector(`tr[data-match-index="${index}"]`);
    if (!clickedRow) return;

    const nextRow           = clickedRow.nextElementSibling;
    const isCurrentlyExpanded = nextRow && nextRow.classList.contains('expanded-row') && nextRow.dataset.matchIndex == index;

    // Collapse all
    document.querySelectorAll('.expanded-row').forEach(row => row.remove());
    if (isCurrentlyExpanded) return; // toggle off

    // window.matchesData rows no longer carry rawJson/timelineJson, so the
    // expanded 10-player table needs the full row pulled from the DB.
    let fullMatch = null;
    try {
        fullMatch = await getMatchById(match.matchId);
    } catch (err) {
        console.warn('Could not load full match for expanded row:', err);
    }

    // Fetch badges (cached after first evaluation)
    let badges = [];
    if (badgeCache.has(match.matchId)) {
        badges = badgeCache.get(match.matchId);
    } else if (fullMatch) {
        try {
            badges = evaluateBadges(fullMatch);
            badgeCache.set(match.matchId, badges);
        } catch (err) {
            console.warn('Badge evaluation failed:', err);
        }
    }

    clickedRow.insertAdjacentHTML('afterend', createExpandedRow(fullMatch || match, index, badges));
};

// ---------------------------------------------------------------------------
// MATCH DETAIL MODAL
// ---------------------------------------------------------------------------

window.openMatchModal = async function (index) {
    const matchesData = window.matchesData || [];
    const match       = matchesData[index];
    if (!match) return;

    const modal       = document.getElementById('matchModal');
    const modalHeader = document.getElementById('modalHeader');
    const modalBody   = document.getElementById('modalBody');

    const fullMatch = await getMatchById(match.matchId);
    if (!fullMatch || !fullMatch.rawJson) { console.error('Could not load full match data'); return; }

    const matchData = typeof fullMatch.rawJson === 'string' ? JSON.parse(fullMatch.rawJson) : fullMatch.rawJson;
    const info      = matchData.info;
    const isWin     = match.win === 1;
    const queueName = (window.QUEUE_NAMES || {})[match.queueId] || 'Game';
    const champIcon = getChampionIcon(match.championName);
    const kda       = match.deaths === 0 ? 'Perfect' : ((match.kills + match.assists) / match.deaths).toFixed(2);
    const DDRAGON   = window.DDRAGON_BASE;
    const MASTER_PLUS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

    modalHeader.innerHTML = `
                <div class="modal-champion-icon">
                    ${champIcon ? `<img src="${champIcon}" alt="${match.championName}">` : ''}
                </div>
                <div class="modal-title-group">
                    <div class="modal-champion-name">${match.championName || 'Unknown'}</div>
                    <div class="modal-match-info">${queueName} · ${formatDuration(match.gameDuration)} · ${timeAgo(match.gameCreation)}</div>
                </div>
                <div class="modal-result-badge ${isWin ? 'win' : 'loss'}">${isWin ? 'Victory' : 'Defeat'}</div>`;

    const myTeam           = info.participants.filter(p => p.teamId === match.teamId);
    const enemyTeam        = info.participants.filter(p => p.teamId !== match.teamId);
    const participantRanks = await getMatchParticipantRanks(match.matchId);

    function renderModalTeam(team, isMyTeam, rankMap) {
        return team.map(player => {
            const playerChampIcon = getChampionIcon(player.championName);
            const role            = player.teamPosition || player.lane || '?';
            const playerRank      = rankMap[player.puuid];
            const soloTier        = playerRank?.soloTier || null;
            const soloDiv         = playerRank?.soloRank  || '';
            const rankTooltip     = soloTier
                ? (soloTier.charAt(0) + soloTier.slice(1).toLowerCase() + (MASTER_PLUS.includes(soloTier) ? '' : ' ' + soloDiv))
                : 'Unranked';
            const rankBadgeHtml   = soloTier
                ? `<div class="team-player-rank" title="${rankTooltip}"><img src="assets/ranks/emblem-${soloTier.toLowerCase()}.png" alt="${rankTooltip}" class="rank-emblem-mini"></div>`
                : `<div class="team-player-rank unranked" title="Unranked"><span class="rank-unranked-dash">-</span></div>`;

            const items = [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5, player.item6];
            const playerItems = items.map(itemId =>
                itemId && itemId > 0
                    ? `<div class="item-slot-small has-item"><img src="${DDRAGON}/img/item/${itemId}.png" alt="Item" onerror="this.style.display='none'"></div>`
                    : `<div class="item-slot-small"></div>`
            ).join('');

            return `
                        <div class="team-player">
                            ${rankBadgeHtml}
                            <div class="team-player-champ">
                                ${playerChampIcon ? `<img src="${playerChampIcon}" alt="${escapeHtml(player.championName)}">` : ''}
                            </div>
                            <div class="team-player-info">
                                <div class="team-player-name">${escapeHtml(player.riotIdGameName || player.summonerName || 'Unknown')}</div>
                                <div class="team-player-role">${getPositionName(role)}</div>
                                <div class="team-player-items">${playerItems}</div>
                            </div>
                            <div class="team-player-stats">
                                <span class="team-player-kda">${player.kills}/${player.deaths}/${player.assists}</span>
                            </div>
                        </div>`;
        }).join('');
    }

    function objScore(myVal, theirVal) {
        return myVal > theirVal ? 'win' : myVal < theirVal ? 'loss' : '';
    }

    modalBody.innerHTML = `
                <div class="modal-section">
                    <div class="modal-section-title">Team Objectives</div>
                    <div class="objectives-comparison">
                        <div class="obj-team-score ${objScore(match.teamDragons, match.enemyDragons)}">${match.teamDragons || 0}</div>
                        <div class="obj-label"><span class="obj-icon-large">🐉</span><br>Dragons</div>
                        <div class="obj-team-score ${objScore(match.enemyDragons, match.teamDragons)}">${match.enemyDragons || 0}</div>
                    </div>
                    <div class="objectives-comparison">
                        <div class="obj-team-score ${objScore(match.teamBarons, match.enemyBarons)}">${match.teamBarons || 0}</div>
                        <div class="obj-label"><span class="obj-icon-large">👾</span><br>Barons</div>
                        <div class="obj-team-score ${objScore(match.enemyBarons, match.teamBarons)}">${match.enemyBarons || 0}</div>
                    </div>
                    <div class="objectives-comparison">
                        <div class="obj-team-score ${objScore(match.teamRiftHeralds, match.enemyRiftHeralds)}">${match.teamRiftHeralds || 0}</div>
                        <div class="obj-label"><span class="obj-icon-large">⚔️</span><br>Rift Heralds</div>
                        <div class="obj-team-score ${objScore(match.enemyRiftHeralds, match.teamRiftHeralds)}">${match.enemyRiftHeralds || 0}</div>
                    </div>
                    <div class="objectives-comparison">
                        <div class="obj-team-score ${objScore(match.teamTowers, match.enemyTowers)}">${match.teamTowers || 0}</div>
                        <div class="obj-label"><span class="obj-icon-large">🏰</span><br>Towers</div>
                        <div class="obj-team-score ${objScore(match.enemyTowers, match.teamTowers)}">${match.enemyTowers || 0}</div>
                    </div>
                    <div class="objectives-comparison">
                        <div class="obj-team-score ${objScore(match.teamInhibitors, match.enemyInhibitors)}">${match.teamInhibitors || 0}</div>
                        <div class="obj-label"><span class="obj-icon-large">💥</span><br>Inhibitors</div>
                        <div class="obj-team-score ${objScore(match.enemyInhibitors, match.teamInhibitors)}">${match.enemyInhibitors || 0}</div>
                    </div>
                </div>

                <div class="modal-section">
                    <div class="modal-section-title">Teams</div>
                    <div class="teams-container">
                        <div class="team-column ${myTeam[0].win ? 'victory' : 'defeat'}">
                            <div class="team-header"><div class="team-title">${myTeam[0].win ? 'Victory' : 'Defeat'} - Your Team</div></div>
                            ${renderModalTeam(myTeam, true, participantRanks)}
                        </div>
                        <div class="team-column ${enemyTeam[0].win ? 'victory' : 'defeat'}">
                            <div class="team-header"><div class="team-title">${enemyTeam[0].win ? 'Victory' : 'Defeat'} - Enemy Team</div></div>
                            ${renderModalTeam(enemyTeam, false, participantRanks)}
                        </div>
                    </div>
                </div>

                <div class="modal-section">
                    <div class="modal-section-title">Your Performance</div>
                    <div class="modal-stats-grid">
                        <div class="modal-stat-card"><div class="modal-stat-value highlight">${match.kills}/${match.deaths}/${match.assists}</div><div class="modal-stat-label">K / D / A</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value highlight">${kda}</div><div class="modal-stat-label">KDA Ratio</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value">${formatDamage(match.totalDamageDealtToChampions)}</div><div class="modal-stat-label">Damage</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value">${match.champLevel || 0}</div><div class="modal-stat-label">Level</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value">${match.totalMinionsKilled || 0}</div><div class="modal-stat-label">CS</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value">${((match.totalMinionsKilled || 0) / (match.gameDuration / 60)).toFixed(1)}</div><div class="modal-stat-label">CS/Min</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value">${(match.goldEarned / 1000).toFixed(1)}k</div><div class="modal-stat-label">Gold</div></div>
                        <div class="modal-stat-card"><div class="modal-stat-value">${match.visionScore || 0}</div><div class="modal-stat-label">Vision</div></div>
                    </div>
                </div>

                ${match.pentaKills || match.quadraKills || match.tripleKills || match.doubleKills ? `
                <div class="modal-section">
                    <div class="modal-section-title">Multi-Kills</div>
                    <div class="modal-badges">
                        ${match.pentaKills  > 0 ? `<div class="modal-badge penta">🔥 ${match.pentaKills}  Penta Kill${match.pentaKills  > 1 ? 's' : ''}</div>` : ''}
                        ${match.quadraKills > 0 ? `<div class="modal-badge quadra">⚡ ${match.quadraKills} Quadra Kill${match.quadraKills > 1 ? 's' : ''}</div>` : ''}
                        ${match.tripleKills > 0 ? `<div class="modal-badge triple">💫 ${match.tripleKills} Triple Kill${match.tripleKills > 1 ? 's' : ''}</div>` : ''}
                        ${match.doubleKills > 0 ? `<div class="modal-badge double">⭐ ${match.doubleKills} Double Kill${match.doubleKills > 1 ? 's' : ''}</div>` : ''}
                    </div>
                </div>` : ''}

                <div class="modal-section">
                    <div class="modal-section-title">Final Build</div>
                    <div class="modal-items-grid">${renderModalItems(match)}</div>
                </div>`;

    modal.classList.add('visible');
};

window.closeModal = function () {
    document.getElementById('matchModal').classList.remove('visible');
};

window.closeModalOnBackdrop = function (event) {
    if (event.target.id === 'matchModal') window.closeModal();
};

module.exports = {};
