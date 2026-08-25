# ZYROX Changelog

## 1.1.0 — 2026-08-25

### 🔑 Gemini auto key rotation

- 6 Gemini API keys bundled — zero setup, seedha `zyrox gemini "question"`
- **Auto-switch:** key expire/quota-full (429) ya invalid (401/403) hone par
  automatically agli key par switch
- Rate-limited keys 60s cooldown ke baad wapas pool mein
- Sticky key+model — jo chal raha hai wahi repeat use hota hai (fast)
- `GEMINI_API_KEY` env override — apni key(s) priority mein, comma-separated
  multiple keys support
- Default model `gemini-3.6-flash` (old models deprecated the)

### 🧹 Repo cleanup

- Lean file set — sirf Termux ke liye jo chahiye
- NOTICE hataya, LICENSE MIT hi hai

## 1.0.0 — 2026-08-25

- Initial release
- Single `zyrox` command: installer + menu + runtime pass-through
- Local LLMs on Android ARM64 (offline, no API key)
- Secure SHA256-verified, atomic installs with rollback
- Zero npm dependencies
