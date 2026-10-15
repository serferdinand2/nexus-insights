/**
 * skins.js — app skins (colour themes + background).
 *
 * A skin is just a set of CSS custom-property overrides plus a background.
 * Everything in app.css / polish.css reads its accent, highlight, surface and
 * text colours from those properties, so swapping them restyles the app.
 *
 * Deliberately NOT part of a skin: win/loss red-green (winRateColor.js) and
 * the Iron → Challenger rank colours (rankTiers.js). Those carry meaning and
 * stay identical in every skin.
 *
 * To add a skin: add an entry to SKINS. `vars` only needs the properties it
 * changes; anything missing falls back to the default in app.css :root.
 */

const REGION_BACKGROUNDS = [
    'bandle city.png', 'bilgewater.png', 'demacia.png', 'freljord.png',
    'ionia.png', 'ixtal.png', 'noxus.png',
    'piltover.png', 'shadow isles.png', 'shurima.png', 'targon.png',
    'the void.png', 'zaun.png',
];

const SKINS = [
    {
        id: 'default',
        name: 'Nexus',
        description: 'The original: teal and gold over a random region of Runeterra.',
        swatches: ['#00cfbc', '#c8aa6e', '#f0e6d2', '#121216'],
        vars: {},
        // tint laid over the background image so text stays readable
        overlay: 'rgba(15, 15, 18, 0.85)',
        background: { type: 'region' },
    },
    {
        id: 'autumn-tide',
        name: 'Autumn Tide',
        description: 'Aqua water, lavender dusk and autumn leaves.',
        swatches: ['#4fe0c8', '#a58cf0', '#f4a77a', '#f6a5c0', '#16183a'],
        vars: {
            '--bg-primary':      '#15162e',
            '--accent-primary':  '#4fe0c8',
            '--accent-rgb':      '79, 224, 200',
            '--accent-deep':     '#2bb7a8',
            '--on-accent':       '#062a26',
            '--accent-secondary':'#a58cf0',
            '--gold':            '#f4a77a',
            '--gold-rgb':        '244, 167, 122',
            '--gold-light':      '#ffe3cf',
            '--bg-card':         'rgba(200, 188, 255, 0.07)',
            '--bg-card-hover':   'rgba(200, 188, 255, 0.10)',
            '--border-primary':  'rgba(205, 195, 255, 0.13)',
            '--border-hover':    'rgba(205, 195, 255, 0.24)',
            '--surface':         'rgba(205, 195, 255, 0.05)',
            '--surface-hover':   'rgba(205, 195, 255, 0.085)',
            '--line':            'rgba(205, 195, 255, 0.10)',
            '--line-strong':     'rgba(205, 195, 255, 0.20)',
            '--text-secondary':  '#bcb5dc',
            '--text-tertiary':   '#8780ad',
        },
        overlay: 'rgba(16, 15, 38, 0.72)',
        background: {
            type: 'gradient',
            // soft glows of the four palette colours over a dusk-indigo → deep-teal sky
            css: [
                // leaves up top (orange + blossom pink), lavender dusk top-right,
                // aqua water bottom-left, royal blue bottom-right
                'radial-gradient(ellipse at 10% 6%,  rgba(244, 160, 110, 0.30), transparent 40%)',
                'radial-gradient(ellipse at 42% 0%,  rgba(246, 165, 192, 0.22), transparent 38%)',
                'radial-gradient(ellipse at 90% 10%, rgba(165, 140, 240, 0.34), transparent 46%)',
                'radial-gradient(ellipse at 15% 95%, rgba(79, 224, 200, 0.28), transparent 50%)',
                'radial-gradient(ellipse at 92% 92%, rgba(60, 100, 220, 0.30), transparent 48%)',
                'linear-gradient(160deg, #1c1940 0%, #171d42 50%, #0f2636 100%)',
            ].join(', '),
        },
    },
];

const DEFAULT_SKIN = 'default';

/** The app.css :root values a preview needs, so the Nexus preview card shows
 *  Nexus colours even while another skin is active. */
const BASE_PREVIEW = {
    '--bg-card':        'rgba(255, 255, 255, 0.06)',
    '--border-primary': 'rgba(255, 255, 255, 0.08)',
    '--accent-primary': '#00cfbc',
    '--on-accent':      '#04201d',
    '--gold-light':     '#f0e6d2',
};

/** Value of a custom property in a given skin (for previews). */
function skinVar(skin, name) {
    return skin.vars[name] || BASE_PREVIEW[name];
}

function getSkin(id) {
    return SKINS.find(s => s.id === id) || SKINS.find(s => s.id === DEFAULT_SKIN);
}

/** file path → CSS url(), safe for spaces, backslashes and quotes */
function fileUrl(p) {
    const norm = String(p).replace(/\\/g, '/');
    const prefixed = /^[a-zA-Z]:\//.test(norm) ? `file:///${norm}` : norm;
    return `url("${encodeURI(prefixed).replace(/"/g, '%22')}")`;
}

/**
 * The CSS background-image value for a skin.
 * @param {object} skin
 * @param {{customImage?: string|null, random?: () => number}} [opts]
 */
function backgroundFor(skin, { customImage = null, random = Math.random } = {}) {
    const tint = `linear-gradient(${skin.overlay}, ${skin.overlay})`;
    if (customImage) return `${tint}, ${fileUrl(customImage)}`;
    if (skin.background.type === 'gradient') return skin.background.css;
    const pick = REGION_BACKGROUNDS[Math.floor(random() * REGION_BACKGROUNDS.length)];
    return `${tint}, url('./assets/backgrounds/${pick}')`;
}

/** All custom-property names any skin touches — cleared before applying. */
function allSkinVars() {
    return [...new Set(SKINS.flatMap(s => Object.keys(s.vars)))];
}

/**
 * Apply a skin to a document. Pure DOM, no storage — the caller saves the choice.
 */
function applySkin(id, { doc = document, customImage = null, random } = {}) {
    const skin = getSkin(id);
    const root = doc.documentElement;
    for (const name of allSkinVars()) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(skin.vars)) root.style.setProperty(name, value);
    root.dataset.skin = skin.id;

    const body = doc.body;
    if (body) {
        body.style.backgroundImage      = backgroundFor(skin, { customImage, random });
        body.style.backgroundRepeat     = 'no-repeat';
        body.style.backgroundPosition   = 'center center';
        body.style.backgroundAttachment = 'fixed';
        body.style.backgroundSize       = 'cover';
        body.style.backgroundColor      = skin.vars['--bg-primary'] || '';
    }
    return skin;
}

const api = { SKINS, DEFAULT_SKIN, BASE_PREVIEW, skinVar, REGION_BACKGROUNDS, getSkin, backgroundFor, applySkin, fileUrl, allSkinVars };
if (typeof module === 'object' && module.exports) module.exports = api;
