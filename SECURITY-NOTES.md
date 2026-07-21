# Security & Repo Hygiene — Action Required

> These steps need to be run by you on Windows. I added `.gitignore` but could not
> run `git` from my sandbox — the repo's `.git/index.lock` sits on a OneDrive mount
> that blocks file deletion for me.

---

## 0. Clear the stale lock file (do this first)

My interrupted `git` attempt left an empty lock file behind. Delete it or every
git command will fail with *"Another git process seems to be running"*:

```powershell
Remove-Item "C:\Users\anton\OneDrive\Documents\Nexus Insights\.git\index.lock"
```

---

## 1. Rotate the Riot API key — do this now

`.env` was committed in `e355f20` ("Backup before Live Match: progress display,
queue filtering, forward-only sync"). The key in it is in your git history and
`.gitignore` does **not** retroactively remove it.

1. Go to https://developer.riotgames.com/
2. Regenerate your key
3. Put the new key in `.env` (now gitignored) — never commit it again

Development keys expire every 24h, so this may already be moot. If you have a
personal or production key, treat it as compromised and rotate regardless.

Optional: keep a committed `.env.example` documenting the shape without the value:

```
RIOT_API_KEY=RGAPI-your-key-here
```

---

## 2. Stop tracking what shouldn't be tracked

7,925 files are currently tracked, including `node_modules/`, `dist/`, `.env`,
and the 131MB `nexus_data.sqlite`. `.gitignore` only affects **untracked** files,
so these need to be removed from the index explicitly.

`--cached` removes them from git only — **your files on disk are untouched**:

```powershell
cd "C:\Users\anton\OneDrive\Documents\Nexus Insights"

git rm -r --cached node_modules dist
git rm --cached .env nexus_data.sqlite

git add .gitignore
git commit -m "Stop tracking node_modules, dist, .env and the local database"
```

Verify — this should drop from ~7,925 to a few dozen:

```powershell
git ls-files | Measure-Object -Line
```

---

## 3. Purge the secret and the bulk from history (optional, destructive)

The two steps above stop the bleeding but leave `.env` and the 131MB database in
every historical commit — which is why `.git/` is **483MB**.

**This rewrites every commit SHA.** Only do it if you understand the consequences:
any existing clone becomes incompatible, and if you have a remote you must
force-push. Make a full folder backup first.

```powershell
# One-time install
pip install git-filter-repo

cd "C:\Users\anton\OneDrive\Documents\Nexus Insights"

git filter-repo --invert-paths ^
  --path .env ^
  --path nexus_data.sqlite ^
  --path node_modules ^
  --path dist

git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Expect `.git/` to drop from ~483MB to a few MB.

If you have a remote:

```powershell
git push origin --force --all
git push origin --force --tags
```

Rotating the key (step 1) matters more than purging history. History rewriting
does not help if the repo was ever pushed, cloned, or backed up somewhere else —
assume the old key is public and burn it.

---

## 4. Renderer privilege — partially addressed, NOT closed

`main.js` still runs the renderer with `nodeIntegration: true` and
`contextIsolation: false`. Any HTML injection in the renderer therefore has full
Node access — file system, shell, and your API key.

**What is fixed:** the injection vectors themselves. Every externally-sourced
string (summoner names and champion names out of the Riot payload) is now
escaped before being interpolated into `innerHTML` — see `escapeHtml()` in
`src/components/dom.js`, applied in `matchModal.js`, `matchCard.js` and
`tableRenderer.js`, with tests in `test/dom.test.js`.

**What is not fixed:** the privilege level itself. See the note below on why
this turned out to be a bigger change than it looks.

### Why the contextIsolation migration was not completed

Moving to `contextIsolation: true` means the renderer can no longer call
SQLite directly — everything crosses an IPC boundary. That is fine for small
payloads (config, rank data, match rows) but breaks down for the analytics
engine, which needs `timelineJson` for the Lane Phase, Combat and Death Review
tabs. Those blobs total ~116MB compressed and roughly a gigabyte parsed.
Shipping them through `ipcRenderer.invoke` means structured-cloning that volume
on every tab switch, which would be substantially slower than the problem we
just fixed.

Doing it properly requires splitting `analyticsEngine.js` in two: per-match
extraction from the blobs running in the main process, and aggregation plus
card-building staying in the renderer. Only small derived numbers would cross
IPC. That is the same "precompute timeline stats" work declined earlier — the
two changes are entangled, and doing the security migration without it would
make the app noticeably slower.

Recommended order if you want to pick this up:

1. Precompute the timeline-derived per-match values into real DB columns
   (extending the existing `backfillAdvancedStats` pattern)
2. Point the analytics calculators at those columns instead of the blobs
3. Then flip on `contextIsolation` — at that point the IPC surface is small
   and the migration is mechanical

Until then, the escaping in step 4 above is what is actually holding the line,
and it covers the realistic attack surface: Riot enforces a restricted charset
on summoner names, so a name that could break out of the markup should not be
reachable in the first place.
