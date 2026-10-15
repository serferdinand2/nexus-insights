/**
 * winRateColor.js — ONE colour scale for every win-rate visual.
 *
 * Before: the calendar, day-of-week chart and game-length chart each had their
 * own rule (one was even relative to your other days, so a 48% day showed as
 * alarming red). Now 50% is always neutral slate, and colour strengthens
 * towards red/green as the win rate moves away from 50%, fully saturated at
 * ±12 points (38% / 62%).
 *
 * Small samples (< LOW_SAMPLE games) are drawn faded so they don't shout.
 */

const LOW_SAMPLE = 5;
const SPAN = 0.12;

// Fills (bars, calendar cells)
const NEUTRAL = [112, 117, 126];   // plain grey (blue-grey turned mauve when mixed with red)
const RED     = [220, 70, 70];
const GREEN   = [34, 180, 100];

// Text (percentages) — lighter so they read on the dark background
const T_NEUTRAL = [203, 213, 225];
const T_RED     = [248, 113, 113];
const T_GREEN   = [74, 222, 128];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function mix(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/** Position on the scale: -1 (≤38%) … 0 (50%) … +1 (≥62%). */
function wrPosition(wr) {
    return clamp((wr - 0.5) / SPAN, -1, 1);
}

function pick(wr, neutral, red, green) {
    const t = wrPosition(wr);
    return mix(neutral, t < 0 ? red : green, Math.abs(t));
}

/**
 * Fill colour for a win rate (0–1).
 * @param {number|null} wr
 * @param {{games?: number, alpha?: number}} [opts]
 */
function wrColor(wr, { games = Infinity, alpha = 0.85 } = {}) {
    if (wr == null || Number.isNaN(wr)) return 'rgba(255,255,255,0.05)';
    const [r, g, b] = pick(wr, NEUTRAL, RED, GREEN);
    const a = games < LOW_SAMPLE ? alpha * 0.45 : alpha;
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

/** Text colour for a win-rate percentage label. */
function wrTextColor(wr) {
    if (wr == null || Number.isNaN(wr)) return 'rgba(255,255,255,0.35)';
    const [r, g, b] = pick(wr, T_NEUTRAL, T_RED, T_GREEN);
    return `rgb(${r},${g},${b})`;
}

/** CSS gradient for legends: 38% → 50% → 62%. */
function wrLegendGradient() {
    return `linear-gradient(90deg, ${wrColor(0.38)}, ${wrColor(0.5)}, ${wrColor(0.62)})`;
}

const api = { wrColor, wrTextColor, wrLegendGradient, wrPosition, LOW_SAMPLE };
if (typeof window !== 'undefined') Object.assign(window, { wrColor, wrTextColor, wrLegendGradient });
if (typeof module === 'object' && module.exports) module.exports = api;
