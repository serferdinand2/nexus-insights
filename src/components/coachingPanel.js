/**
 * coachingPanel.js — the coaching board.
 *
 * Rewritten 2026-08. The previous version showed 20 goal cards, each with a
 * progress bar, six statistics, an insight paragraph and an action paragraph:
 * 78 numbers presented as equally urgent. Twenty priorities is zero priorities.
 *
 * The structure now mirrors how someone can actually use this:
 *
 *   FOCUS      one thing, chosen by how much win rate is associated with it,
 *              expressed as a single rule you can hold in your head mid-game
 *   WATCH      up to three metrics, one line each, no prose
 *   REFERENCE  outcomes as evidence, in a collapsed table, never as tasks
 *
 * The ranking, the causes-vs-symptoms split and the statistical caveats all
 * live in coachingEngine.js; this file only renders what it returns.
 *
 * Exposes: window.renderCoachingPanel()
 */

(function () {
    'use strict';

    const { getCoachingData } = require('../services/matchService');
    const { loadConfig, saveConfig } = require('../services/config');
    const Engine = require('./coachingEngine');
    const { escapeHtml } = require('./dom');

    const SEASON_START = new Date('2026-01-01T00:00:00Z').getTime();

    const fmt = (v, dp = 1) => (v === null || v === undefined || Number.isNaN(v))
        ? '—' : Number(v).toFixed(dp);
    const pct = v => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Math.round(v) + '%';
    const signed = v => (v > 0 ? '+' : '') + Math.round(v);

    // ── Focus persistence ────────────────────────────────────────────────────
    // Storing the chosen metric with the date it was set is what lets the board
    // show whether the advice worked. Without it this is advice, not coaching.
    function loadFocus() {
        return loadConfig().coachingFocus || null;
    }

    function saveFocus(metricId) {
        const cfg = loadConfig();
        cfg.coachingFocus = { id: metricId, since: Date.now() };
        saveConfig(cfg);
    }

    window.coachingSetFocus = function (metricId) {
        saveFocus(metricId);
        window.renderCoachingPanel();
    };

    window.coachingClearFocus = function () {
        const cfg = loadConfig();
        delete cfg.coachingFocus;
        saveConfig(cfg);
        window.renderCoachingPanel();
    };

    window.coachingToggleReference = function () {
        const el  = document.getElementById('coaching-reference-body');
        const btn = document.getElementById('coaching-reference-toggle');
        if (!el) return;
        const hidden = el.classList.toggle('collapsed');
        if (btn) btn.textContent = hidden ? 'Show' : 'Hide';
    };

    // ── Renderers ────────────────────────────────────────────────────────────

    function renderFocus(focus, progress, roleLabel) {
        if (!focus) {
            return `<div class="coach-empty">Not enough ranked games yet to pick a focus.</div>`;
        }

        const dp = focus.decimals;
        const current = focus.binary
            ? pct(focus.failureRate) + ' of games'
            : `${fmt(focus.current, dp)} ${escapeHtml(focus.unit || '')}`;

        const targetText = focus.binary
            ? ''
            : `&middot; ${escapeHtml(roleLabel)} target ${fmt(focus.target, dp)}`;

        // The headline is deliberately hedged: this is an association measured
        // on the player's own games, not a promised gain.
        // Hedged deliberately: this is the difference between the player's
        // current blended win rate and the rate of their good games. It is an
        // association, not a promise, and the tooltip says so.
        const headline = focus.gap > 0
            ? `<div class="coach-focus-gain" title="If every game went like the ${pct(100 - focus.failureRate)} where you manage this, your win rate would be about ${pct(focus.wrMet)} instead of ${pct(focus.wrMet - focus.recoverable)}. An association measured on your own games, not a guaranteed gain.">
                 <div class="coach-focus-gain-value">${signed(focus.recoverable)}%</div>
                 <div class="coach-focus-gain-label">if every game went like your good ones</div>
               </div>`
            : '';

        const confidence = focus.confident
            ? ''
            : `<div class="coach-caveat">Based on ${focus.sampleSize} games
                 (${focus.metGames} vs ${focus.failedGames}) — the gap is within the
                 margin of error, so treat this as a hint rather than a finding.</div>`;

        // Naming both group sizes matters. "You win 71% of games that hit this
        // and 43% of games that don't" reads as though the two should sum to
        // 100 — they are separate groups, each with its own win rate.
        const metShare = 100 - focus.failureRate;
        const evidence = (focus.wrMet !== null && focus.wrMissed !== null)
            ? `In the <b>${pct(metShare)}</b> of games where you managed this, you won
               <b class="good">${pct(focus.wrMet)}</b>.
               In the other <b>${pct(focus.failureRate)}</b>, you won
               <b class="bad">${pct(focus.wrMissed)}</b>.
               <span class="coach-dim">(Two separate groups &mdash; each out of its own games.)</span>`
            : '';

        return `
        <div class="coach-focus">
          <div class="coach-focus-top">
            <div>
              <div class="coach-focus-title">${escapeHtml(focus.label)}</div>
              <div class="coach-focus-sub">${current} ${targetText}</div>
            </div>
            ${headline}
          </div>

          <div class="coach-rule">
            <div class="coach-rule-label">The rule</div>
            <div class="coach-rule-text">${escapeHtml(focus.rule || '')}</div>
          </div>

          <p class="coach-evidence">${evidence}</p>
          ${confidence}
          ${renderProgress(progress, focus)}

          <div class="coach-focus-actions">
            ${focus.pinned
                ? `<button class="coach-btn" onclick="coachingClearFocus()">Let the app choose</button>`
                : `<button class="coach-btn" onclick="coachingSetFocus('${focus.id}')">Commit to this</button>`}
          </div>
        </div>`;
    }

    function renderProgress(progress, focus) {
        if (!progress) return '';
        const since = new Date(progress.since).toLocaleDateString();

        if (progress.tooEarly) {
            return `<div class="coach-progress-note">Tracking since ${since} —
                ${progress.games} game${progress.games === 1 ? '' : 's'} so far,
                too few to show movement yet.</div>`;
        }

        const dp    = focus.decimals;
        const dir   = progress.improving ? 'good' : 'bad';
        const arrow = progress.improving ? '&darr;' : '&uarr;';
        const move  = focus.binary
            ? `${pct(progress.before * 100)} &rarr; ${pct(progress.after * 100)}`
            : `${fmt(progress.before, dp)} &rarr; ${fmt(progress.after, dp)}`;

        return `
        <div class="coach-progress-grid">
          <div class="coach-progress-cell">
            <div class="coach-progress-label">Since ${since}</div>
            <div class="coach-progress-value ${dir}">${arrow} ${move}</div>
          </div>
          <div class="coach-progress-cell">
            <div class="coach-progress-label">Games since</div>
            <div class="coach-progress-value">${progress.games} &middot; ${pct(progress.winRateSince)} WR</div>
          </div>
        </div>`;
    }

    function renderWatch(watch) {
        if (!watch || !watch.length) return '';

        const rows = watch.map(w => {
            const dp = w.decimals;
            const value = w.binary
                ? pct(w.failureRate) + ' of games'
                : `${fmt(w.current, dp)} ${escapeHtml(w.unit || '')}`;

            let note = '', cls = 'muted';
            if (w.trend && w.trend.improving !== null) {
                cls  = w.trend.improving ? 'good' : 'bad';
                // Binary metrics are rates: printing them at 0 decimals would
                // show a real change as "0 -> 0".
                const from = w.binary ? pct(w.trend.before * 100) : fmt(w.trend.before, dp);
                note = `${w.trend.improving ? '&darr;' : '&uarr;'} from ${from}`;
            } else if (w.trend && w.trend.flat) {
                note = 'steady';
            } else if (w.gap > 0) {
                note = signed(w.recoverable) + '%';
            }

            return `
            <div class="coach-watch-row" title="${escapeHtml(w.rule || '')}">
              <span class="coach-watch-label">${escapeHtml(w.label)}</span>
              <span class="coach-watch-value">${value}</span>
              <span class="coach-watch-note ${cls}">${note}</span>
              <button class="coach-mini-btn" onclick="coachingSetFocus('${w.id}')">Focus</button>
            </div>`;
        }).join('');

        return `<div class="coach-section-label">Watching</div>
                <div class="coach-watch">${rows}</div>`;
    }

    function renderTilt(tilt) {
        if (!tilt) return '';

        // Deliberately phrased around behaviour, not results. Win rate after two
        // losses is circular — a losing run contains losses by definition —
        // whereas early deaths going up is evidence about how you played.
        if (!tilt.degraded) {
            return `<div class="coach-note">
              After two losses you play <b>${tilt.games}</b> more games
              (${pct(tilt.share)} of your total), but your in-game habits hold up:
              early and isolated deaths stay flat. That looks like variance
              rather than tilt.</div>`;
        }

        const bits = [];
        if (tilt.earlyDeaths && tilt.earlyDeaths.delta > 0.15) {
            bits.push(`early deaths ${fmt(tilt.earlyDeaths.normal)} &rarr; <b class="bad">${fmt(tilt.earlyDeaths.tilted)}</b>`);
        }
        if (tilt.isolatedDeaths && tilt.isolatedDeaths.delta > 0.15) {
            bits.push(`dying alone ${fmt(tilt.isolatedDeaths.normal)} &rarr; <b class="bad">${fmt(tilt.isolatedDeaths.tilted)}</b>`);
        }
        if (tilt.csAt10 && tilt.csAt10.delta < -3) {
            bits.push(`CS@10 ${fmt(tilt.csAt10.normal, 0)} &rarr; <b class="bad">${fmt(tilt.csAt10.tilted, 0)}</b>`);
        }

        return `<div class="coach-note warn">
          <b>You play worse after two losses.</b> Across ${tilt.games} such games:
          ${bits.join(', ')}. That is a change in how you play, not just in results —
          the strongest case for stopping at two.</div>`;
    }

    function renderReference(reference, sampleSize) {
        if (!reference || !reference.length) return '';

        const rows = reference.map(r => `
            <tr>
              <td>${escapeHtml(r.label)}</td>
              <td class="num">${fmt(r.current, r.decimals)}${escapeHtml(r.unit || '')}</td>
            </tr>`).join('');

        return `
        <div class="coach-section-label coach-reference-head">
          <span>Evidence <span class="coach-dim">— outcomes, not tasks</span></span>
          <button class="coach-mini-btn" id="coaching-reference-toggle"
                  onclick="coachingToggleReference()">Show</button>
        </div>
        <div class="coach-reference collapsed" id="coaching-reference-body">
          <p class="coach-dim coach-reference-why">
            These follow from winning rather than causing it — you take Baron
            because you are ahead. Useful as evidence, useless as instructions,
            so they are not ranked as things to fix.
          </p>
          <table class="coach-table">${rows}</table>
          <p class="coach-dim">Averages over ${sampleSize} ranked Solo/Duo games this season.</p>
        </div>`;
    }

    // ── Entry point ──────────────────────────────────────────────────────────
    window.renderCoachingPanel = async function () {
        const container = document.getElementById('coaching-panel-content');
        if (!container) return;
        window.coachingPanelLoaded = true;

        container.innerHTML = `
            <div class="coaching-loading">
              <div class="coaching-spinner"></div>
              <p>Analysing your Solo/Duo ranked games…</p>
            </div>`;

        try {
            // timelineSample 0: the board no longer needs first-drake timings,
            // so no timelines are decompressed at all.
            const { rows } = await getCoachingData(SEASON_START, 0);

            if (!rows || rows.length === 0) {
                container.innerHTML = `<div class="coach-empty">
                    No Solo/Duo ranked games found for this season.</div>`;
                return;
            }

            const pref = loadFocus();
            const result = Engine.analyse(rows, {
                focusId:    pref ? pref.id : null,
                focusSince: pref ? pref.since : null,
            });

            container.innerHTML = `
            <div class="coach-header">
              <div>
                <h2>Coaching</h2>
                <p>${result.sampleSize} ranked games &middot; ${escapeHtml(result.roleLabel)}
                   ${result.roleShare < 0.6
                     ? `<span class="coach-dim">(only ${pct(result.roleShare * 100)} of games — benchmarks approximate)</span>`
                     : ''}</p>
              </div>
              <button class="coach-btn" onclick="window.renderCoachingPanel()">Refresh</button>
            </div>

            <div class="coach-section-label">This week's focus
              <span class="coach-dim">— one thing</span></div>
            ${renderFocus(result.focus, result.progress, result.roleLabel)}
            ${renderTilt(result.tilt)}
            ${renderWatch(result.watch)}
            ${renderReference(result.reference, result.sampleSize)}
            `;

        } catch (err) {
            container.innerHTML = `<div class="coach-empty error">Error: ${escapeHtml(err.message)}</div>`;
            console.error('[CoachingPanel]', err);
        }
    };

    window.refreshCoachingPanel = window.renderCoachingPanel;
})();
