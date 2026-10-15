# Nexus Insights

A League of Legends personal analytics desktop app. Syncs your match history
from the Riot API, stores it locally, and works offline after the first sync.

## ⬇ Download

**[Download Nexus Insights for Windows](https://github.com/toancina/nexus-insights/releases/latest/download/Nexus-Insights-Setup.exe)**
(Windows 10/11, 64-bit). Every version is on the [Releases page](https://github.com/toancina/nexus-insights/releases).

1. Run `Nexus-Insights-Setup.exe`. If Windows says *"Windows protected your PC"*,
   click **More info → Run anyway**. The app just isn't code-signed.
2. In the setup window enter:
   - a **Riot API key**: free at [developer.riotgames.com](https://developer.riotgames.com)
     (sign in with your League account, copy the *Development API Key*; it
     expires every 24 h, so paste a fresh one in Settings ⚙ when syncing stops),
   - your **Riot ID** (name + tag) and **server**.
3. Click **Sync Matches**. The first sync takes a few minutes.

Updates: click ⟳ next to ⚙ in the app. Your matches and settings are kept.

Optional **Chat** page: install [Ollama](https://ollama.com) and run
`ollama pull qwen3:8b`. It runs locally and nothing leaves your PC.

**macOS or Linux?** There's no download yet. Build your own copy in a couple of
minutes: see [Building for macOS or Linux](#building-for-macos-or-linux).

---

*Everything below is for working on the code.*

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
npm run dist # clean, shareable installer for this OS into dist/
```

---

## Sharing it with someone else

**Double-click `Build Installer.bat`** (or run `npm run dist`). After a minute
or two it opens `dist\` with `Nexus-Insights-Setup.exe` in it. Send that
one file, or better, publish it with `Publish Update.bat` (see Updates below)
so people download it from GitHub and get updates.

The installer is a **completely fresh copy**: no API key, no Riot ID, no matches,
no LP history. Those all live in `%APPDATA%\nexus-insights` on *your* PC and are
never packaged. The one piece of personal data in the source (your hardcoded LP
history in `calendarPanel.js`) is stripped during the build and put back
afterwards, so your own app is unaffected. The script refuses to build if it
can't find that data to strip.

Use `npm run dist`, not `npm run build`. Plain `build` skips the strip.

`dist\Nexus Insights - portable.zip` is a no-install alternative: unzip it, run
`Nexus Insights.exe`. It was built from the same cleaned source.

### What to tell the person you send it to

1. **Windows will warn** "Windows protected your PC", because the app isn't
   code-signed (a certificate costs money yearly). Click **More info → Run
   anyway**.
2. On first launch it asks for a **Riot API key** (from
   https://developer.riotgames.com, sign in and copy the key), their
   **Riot ID** (`Name` + `#Tag`), and their **server** (EUW, NA, KR…). The
   region fills itself in from the server. Then **Sync Matches**.
3. **Development keys expire every 24 hours.** When sync says "API key
   invalid or expired", they generate a new key and paste it in Settings
   (gear icon, top right).
   For a key that lasts, Riot offers a *Personal API Key* application on the
   same site.
4. The first sync downloads their whole season and is slow on purpose. Riot
   allows 100 requests per 2 minutes, and each match takes at least two
   (match + timeline), so it's at most about 50 matches every 2 minutes.
5. By default the app **starts with Windows and closes to the tray**, because
   it has to be running to record LP changes. Both can be turned off in
   Settings.

### Building for macOS or Linux

On the Mac or Linux PC itself:

```
npm install
npm run dist
```

| OS | Output in `dist/` |
|----|-------------------|
| macOS | `Nexus-Insights-mac-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) |
| Linux | `Nexus-Insights-linux-x64.AppImage` (or `-arm64`) |

Same fresh copy as the Windows one: LP history stripped, no data packaged.

- **Each OS builds its own copy, for its own chip.** The SQLite driver and
  Electron in `node_modules` are the ones `npm install` downloaded for that
  machine, so a Mac can't build the Windows installer or the Intel Mac
  version, and the other way round.
- **macOS: first launch.** The app isn't signed with an Apple Developer ID
  ($99/year). macOS says it can't verify the developer: click **Done**, then
  **System Settings → Privacy & Security**, scroll down, **Open Anyway**.
  Only needed once.
- **No automatic updates** on macOS or Linux. Releases carry only the Windows
  installer, and macOS won't update an unsigned app. There the ⟳ button
  opens the Releases page. `npm run release` refuses to run outside Windows,
  so a Mac can never publish a release that breaks Windows updates.
- Linux: `chmod +x` the AppImage, then run it. "Start with Windows" is hidden
  there (Electron has no login-item API on Linux). On macOS it's called
  "Open at login".

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

- **There is no `.env`.** The app never read one. The API key lives in
  `config.json` and is set through the Settings dialog. If you create a `.env`
  expecting it to change the key, nothing will happen. (`.env.example` used to
  sit in this folder purely as documentation and was removed in August 2026 —
  it implied a mechanism that doesn't exist.)

---

## Notes for future work

`CLAUDE.md` has the detailed architecture notes — schema, sync strategy, the
lazy-JSON-loading design, and which analytics tabs need which data.

The renderer runs with `nodeIntegration: true` (see "General" in `CLAUDE.md`);
every string from the Riot API is escaped before it reaches the page.

---

## Updates

The installed app has an update button (⟳) next to Settings. It checks this
repo's GitHub Releases, downloads a newer version and restarts into it. Your
matches, API key and settings are kept (they live in `%APPDATA%\nexus-insights`).

**To release a new version:** double-click `Publish Update.bat`. It raises the
version number, builds the installer, uploads it as a GitHub Release, and
commits + pushes the code. The first time, it asks for a GitHub token. Put it
in `%APPDATA%\nexus-insights\github-token.txt` (never inside this folder).
