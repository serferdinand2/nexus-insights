/**
 * rankTiers.js — the one rank-tier colour palette.
 *
 * Previously three copies existed (analyticsEngine.RANK_COLORS,
 * tableRenderer.getRankColor with *different* hex values, and
 * calendarPanel.LP_TIER_COLORS). A tier now looks identical on a stat card,
 * a table cell, and the LP chart.
 */

const RANK_COLORS = {
    iron:        '#5A4A44',
    bronze:      '#8C5A2B',
    silver:      '#A8A8A8',
    gold:        '#D4AF37',
    platinum:    '#4FD1C5',
    emerald:     '#2ECC71',
    diamond:     '#5DADEC',
    master:      '#B56CFF',
    grandmaster: '#E74C3C',
    challenger:  '#F4D03F',
    unrated:     '#666666',
};

/** Uppercase-keyed view (Riot API tier strings: 'IRON', 'GOLD', ...). */
const RANK_COLORS_UC = Object.fromEntries(
    Object.entries(RANK_COLORS).map(([k, v]) => [k.toUpperCase(), v])
);

/** Colour for a tier name in either case; falls back to unrated grey. */
function tierColor(tier) {
    if (!tier) return RANK_COLORS.unrated;
    return RANK_COLORS[String(tier).toLowerCase()] || RANK_COLORS.unrated;
}

module.exports = { RANK_COLORS, RANK_COLORS_UC, tierColor };
