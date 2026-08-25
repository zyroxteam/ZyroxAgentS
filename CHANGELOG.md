# ZYROX Changelog

## 1.0.0 — 2026-08-25

Initial ZYROX release. Rebranded from ollama-termux (MIT), trimmed to a
Termux-first installer/launcher package.

### ZYROX features

- Single `zyrox` command: first run installs the runtime, then opens the
  interactive menu automatically.
- `zyrox install / update / uninstall / status` — lifecycle management with
  atomic, rollback-safe, SHA256-verified installs (from upstream logic).
- `zyrox <args>` pass-through to the local runtime (`serve`, `run`, `pull`,
  `list`, `launch`, `ps`, `stop`, ...).
- **NEW: `zyrox gemini`** — built-in Google Gemini cloud chat with zero
  dependencies:
  - one-shot: `zyrox gemini "question"`
  - interactive multi-turn chat: `zyrox gemini`
  - uses `GEMINI_API_KEY`; model override via `GEMINI_MODEL` with automatic
    fallback (`gemini-flash-latest` → `gemini-2.5-flash` → `gemini-2.0-flash`)
  - clear guidance when the key is missing
- Runtime version pinning via `ZYROX_RUNTIME_VERSION`.

### Cleanup vs upstream repo

- Removed the full Go source tree, CI workflows, Docker, macOS/Windows
  build scripts and general upstream docs — not needed for Termux usage
  (the installer downloads pre-built release assets).
- Kept: secure installer, launcher, installer tests, Termux-relevant docs
  (BENCHMARKS, VULKAN_ANDROID_LOADER), LICENSE + NOTICE attribution.

### Based on

- ollama-termux `v0.32.2-termux.1` (installer logic)
- Runtime binaries: ollama-termux releases (Ollama v0.32.2 + llama.cpp)
