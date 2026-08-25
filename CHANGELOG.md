# TOXIC / ZYROX AGENT Changelog

## 1.4.0 — 2026-08-25

### 🎯 Menu bypass — hamesha working AI se start

- Bare `toxic` ab HAMESHA FREE Gemini chat se shuru hota hai
  (menu ka default cloud model retired/paid hai — 410/403 errors)
- `toxic menu` par ab pehle warning dikhti hai
- Startup par version + local model count dikhta hai

## 1.3.0 — 2026-08-25

### 🛠️ Smart start (cloud-error fix)

- Bare `toxic` ab smart hai: local models maujood ho → menu; warna → FREE
  Gemini chat (bundled keys) seedha khul jata hai
- Menu ke retired/subscription cloud models (410/403 errors) ab default
  path mein use nahi hote
- Naye commands: `toxic menu` (original menu), `toxic chat` (= gemini)
- `toxic status` ab local model count bhi dikhata hai

## 1.2.0 — 2026-08-25

### 🔒 Command change: `zyrox` → `toxic`

- Naya command: **`toxic`** (`toxic install`, `toxic gemini`, `toxic serve`, ...)
- Purana `zyrox` command ab kaam NAHI karta — secret command style
- Branding ab bhi ZYROX AGENT hai, sirf trigger word badla hai
- File rename: `zyrox.js` → `toxic.js` (same core)

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
