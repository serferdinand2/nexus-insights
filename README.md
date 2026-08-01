# Nexus Insights

A League of Legends personal analytics desktop app. Syncs your match history
from the Riot API, stores it locally, and works offline after the first sync.

Electron + vanilla JS + SQLite. No framework, no build step for the UI.

---

## Running it

```
npm install
npm start
```

On first launch the setup dialog asks for a Riot API key, your Riot ID
(`Name#Tag`), and your region. Get a key at https://developer.riotgames.com/.

```
npm test     # unit tests
npm run build # Windows installer into dist/
```

---

## Where things live

Two locations, deliberately kept separate.

### Code — this folder

```
src/
├── main.js              Electron main process; window, menu, IPC
├── index.html           Single-page UI shell
├── renderer.js          Entry point, global state, setup modal
├── assets/              Rank emblems, backgrounds, badge definitions
├── components/          UI modules (analytics, coaching, calendar, modals…)
├── services/            Riot API, SQLite, config, Data Dragon, rate limiter
└── styles/              CSS
test/                    Unit tests
scripts/                 One-off analysis scripts, not part of the app
```

### Your data — `%APPDATA%\nexus-insights\`

| File | What it is |
|------|-----------|
| `config.json` | API key, Riot ID, region, platform |
| `nexus_data.sqlite` | Every synced match, including raw match + timeline JSON |

**The Settings dialog has an "Open folder" button that takes you straight
there.** The path is shown above the button.

#### Why the data isn't in this folder

Two reasons:

1. **It's the correct place.** Windows expects per-user application data in
   `%APPDATA%`, not alongside source code. The same app installed from the
   built installer has no project folder to write into.
2. **This folder is inside OneDrive.** A live SQLite database in a cloud-synced
   folder is a well-known corruption vector — the sync client can upload a
   half-written file mid-transaction, lock it while the app has it open, or
   dehydrate it with Files On-Demand so the app can't read it at all. The
   database is also large enough that it would re-upload constantly.

If you ever want to back up your match history, copy `nexus_data.sqlite` out of
that folder while the app is **closed**.

### What is *not* used

- **There is no `.env`.** The app never read one — `.env.example` is kept only
  as documentation. The API key lives in `config.json` and is set through the
  Settings dialog. If you edit a `.env` expecting it to change the key, nothing
  will happen.

---

## Notes for future work

`CLAUDE.md` has the detailed architecture notes — schema, sync strategy, the
lazy-JSON-loading design, and which analytics tabs need which data.

`SECURITY-NOTES.md` covers repo hygiene and the outstanding renderer-privilege
question.
