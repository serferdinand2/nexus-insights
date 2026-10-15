## Install (first time)

1. Download **[Nexus-Insights-Setup.exe](https://github.com/toancina/nexus-insights/releases/latest/download/Nexus-Insights-Setup.exe)** from the Assets below.
2. Run it. Windows may say *"Windows protected your PC"*. The app isn't code-signed (signing certificates cost money), so click **More info → Run anyway**.
3. In the app, fill in the setup window:
   - **Riot API key**: sign in at [developer.riotgames.com](https://developer.riotgames.com) with your League account and copy the *Development API Key*. It expires every 24 hours. When syncing stops working, paste a fresh one in Settings (⚙).
   - **Riot ID**: your name and tag, e.g. `Faker` + `KR1`.
   - **Server**: where you play (EUW, NA, …).
4. Click **Sync Matches**. The first sync downloads this season's games and takes a few minutes.

**Already installed?** Click the update button (⟳, top right, next to ⚙). Your matches and settings are kept.

**Optional, Chat page:** install [Ollama](https://ollama.com), then run `ollama pull qwen3:8b` once. It runs on your PC, so nothing is sent anywhere.

Windows 10/11, 64-bit.
