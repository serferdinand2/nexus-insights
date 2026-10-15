/**
 * skinsPanel.js — the Skins page + applying the saved skin at startup.
 *
 * Saved in config.json:
 *   skin               id from skins.js (default 'default')
 *   customBackground   path to a copy of the user's own image in the data
 *                      folder, or null. Copied (not referenced) so moving or
 *                      deleting the original doesn't break the app.
 */

const fs   = require('fs');
const path = require('path');
const { loadConfig, setConfigValue } = require('../services/config');
const { userDataPath } = require('../services/paths');
const { SKINS, getSkin, applySkin, backgroundFor, skinVar, defaultDim, parseOverlay } = require('./skins');
const { escapeHtml } = require('./dom');

const $ = id => document.getElementById(id);

function current() {
    const cfg = loadConfig();
    const custom = cfg.customBackground && fs.existsSync(cfg.customBackground) ? cfg.customBackground : null;
    const skinId = getSkin(cfg.skin).id;
    // Dim is remembered per skin: 85% suits a bright region image but would
    // black out a gradient skin that's already dark.
    const saved = cfg.bgDim && typeof cfg.bgDim === 'object' ? cfg.bgDim[skinId] : undefined;
    const dim = typeof saved === 'number' ? saved : null;
    return { skinId, custom, dim };
}

/** The dim actually in effect (saved value, or the skin's default). */
function effectiveDim({ skinId, custom, dim }) {
    if (dim !== null) return dim;
    const skin = getSkin(skinId);
    return custom ? parseOverlay(skin.overlay).alpha : defaultDim(skin);
}

/** Apply whatever is saved. Called once at startup, before first paint. */
function applySavedSkin(overrideDim) {
    const cur = current();
    applySkin(cur.skinId, { customImage: cur.custom, dim: overrideDim !== undefined ? overrideDim : cur.dim });
}

function saveDim(value) {
    const cfg = loadConfig();
    const map = cfg.bgDim && typeof cfg.bgDim === 'object' ? { ...cfg.bgDim } : {};
    const id = getSkin(cfg.skin).id;
    if (value === null) delete map[id]; else map[id] = value;
    setConfigValue('bgDim', map);
}

function chooseSkin(id) {
    setConfigValue('skin', id);
    applySavedSkin();
    renderSkinsPanel();
    // Canvas charts read the accent colour when they draw — redraw them.
    if (typeof window.renderLpCharts === 'function') window.renderLpCharts();
}

function previewCard(skin, selected) {
    // A tiny mock-up of the app in that skin: background, a card, a button.
    const bg = backgroundFor(skin, { random: () => 0.42 });
    const v = name => skinVar(skin, name);
    return `
        <button type="button" class="skin-card${selected ? ' is-selected' : ''}" data-skin="${escapeHtml(skin.id)}"
                aria-pressed="${selected}">
            <div class="skin-preview" style="background-image:${escapeHtml(bg)}">
                <div class="skin-preview-rail" style="background:${v('--bg-card')};border-color:${v('--border-primary')}">
                    <i style="background:${v('--accent-primary')}"></i><i></i><i></i>
                </div>
                <div class="skin-preview-card" style="background:${v('--bg-card')};border-color:${v('--border-primary')}">
                    <span class="skin-preview-title" style="color:${v('--gold-light')}">Win Rate</span>
                    <span class="skin-preview-value" style="color:${v('--accent-primary')}">53%</span>
                    <span class="skin-preview-btn" style="background:${v('--accent-primary')};color:${v('--on-accent')}">Sync</span>
                </div>
            </div>
            <div class="skin-meta">
                <div class="skin-name">${escapeHtml(skin.name)}${selected ? '<span class="skin-check">✓ In use</span>' : ''}</div>
                <div class="skin-desc">${escapeHtml(skin.description)}</div>
                <div class="skin-swatches">${skin.swatches.map(c => `<span style="background:${escapeHtml(c)}"></span>`).join('')}</div>
            </div>
        </button>`;
}

function renderSkinsPanel() {
    const grid = $('skinsGrid');
    if (!grid) return;
    const { skinId, custom } = current();
    grid.innerHTML = SKINS.map(s => previewCard(s, s.id === skinId)).join('');
    grid.querySelectorAll('.skin-card').forEach(btn =>
        btn.addEventListener('click', () => chooseSkin(btn.dataset.skin)));

    const status = $('skinBgStatus');
    if (status) status.textContent = custom
        ? `Using your image: ${path.basename(custom)}`
        : "Using the skin's own background.";
    const reset = $('skinBgReset');
    if (reset) reset.hidden = !custom;

    const slider = $('skinDim');
    if (slider) {
        const cur = current();
        slider.value = Math.round(effectiveDim(cur) * 100);
        updateDimLabel(slider.value, cur.dim === null);
    }
}

function updateDimLabel(v, isDefault) {
    const out = $('skinDimValue');
    if (out) out.textContent = `${v}%${isDefault ? ' (default)' : ''}`;
    const def = $('skinDimReset');
    if (def) def.hidden = !!isDefault;
}

async function pickBackground(file) {
    if (!file) return;
    const { webUtils } = require('electron');
    const src = webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : file.path;
    if (!src) return;
    const ext = (path.extname(src) || '.png').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
        if (window.showToast) window.showToast('Not an image', 'Pick a PNG, JPG, WEBP, GIF or BMP file.', 5000);
        return;
    }
    // New file name each time so Chromium doesn't show a cached old image
    const dest = path.join(userDataPath, `background-${Date.now()}${ext}`);
    try {
        fs.copyFileSync(src, dest);
        const old = loadConfig().customBackground;
        setConfigValue('customBackground', dest);
        if (old && old !== dest && old.startsWith(userDataPath)) fs.rmSync(old, { force: true });
    } catch (err) {
        if (window.showToast) window.showToast('Could not use that image', err.message, 6000);
        return;
    }
    applySavedSkin();
    renderSkinsPanel();
}

function resetBackground() {
    const old = loadConfig().customBackground;
    setConfigValue('customBackground', null);
    if (old && old.startsWith(userDataPath)) { try { fs.rmSync(old, { force: true }); } catch { /* ignore */ } }
    applySavedSkin();
    renderSkinsPanel();
}

let wired = false;
window.openSkinsPanel = function () {
    if (!wired) {
        wired = true;
        const input = $('skinBgInput');
        if (input) input.addEventListener('change', () => { pickBackground(input.files && input.files[0]); input.value = ''; });
        const pickBtn = $('skinBgPick');
        if (pickBtn) pickBtn.addEventListener('click', () => input && input.click());
        const reset = $('skinBgReset');
        if (reset) reset.addEventListener('click', resetBackground);

        const slider = $('skinDim');
        if (slider) {
            // Live while dragging, saved when let go
            slider.addEventListener('input', () => {
                applySavedSkin(slider.value / 100);
                updateDimLabel(slider.value, false);
            });
            slider.addEventListener('change', () => saveDim(slider.value / 100));
        }
        const dimReset = $('skinDimReset');
        if (dimReset) dimReset.addEventListener('click', () => {
            saveDim(null);
            applySavedSkin();
            renderSkinsPanel();
        });
    }
    renderSkinsPanel();
};
window.applySavedSkin = applySavedSkin;

module.exports = { applySavedSkin, effectiveDim };
