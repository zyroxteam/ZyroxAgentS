<div align="center">

<img src="assets/banner.png" width="100%" alt="ZYROX AGENT">

[![Termux](https://img.shields.io/badge/Platform-Termux%20%7C%20Android-22c55e?style=for-the-badge&logo=android&logoColor=white)](https://termux.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-8b5cf6?style=for-the-badge)](LICENSE)
[![Release](https://img.shields.io/badge/Version-1.0.0-06b6d4?style=for-the-badge)](CHANGELOG.md)
[![Zero Dependencies](https://img.shields.io/badge/npm-0%20deps-f59e0b?style=for-the-badge)](package.json)

**⚡ AI toolkit for Termux — ek command, sab kuch.**

Local LLMs phone par (100% offline) · Gemini cloud chat · Coding agents

`Android` · `ARM64` · `No root` · `MIT License`

</div>

---

</br>

## ✨ ZYROX kya hai?

| Feature | Detail |
|---|---|
| 🤖 **Local AI models** | Qwen, Gemma, DeepSeek… phone par hi chalte hain — **bina internet, bina API key** |
| ☁️ **Gemini cloud chat** | Apni Gemini API key se — `toxic gemini "question"` |
| 🧑‍💻 **Coding agents** | Qwen Code (2000 free req/day), Codex, Pi — `toxic launch` |
| 🔒 **Secure install** | Har download SHA256-verified + archive safety checks |
| 🪶 **Lightweight** | Ek hi command, zero npm dependencies |

## 📲 Installation (Termux)

```bash
pkg update && pkg upgrade -y
pkg install nodejs-lts git -y
npm install -g github:zyroxteam/ZyroxAgentS
toxic install
```

Bas! Ab `toxic` type karo.

> 🔒 **Note:** Command naam `toxic` hai (v1.2.0 se). Purana `zyrox` command ab kaam nahi karta — secret command style. Purane version se update karne ke liye: `npm rm -g zyrox` phir upar wala install command.

## 🚀 Usage

> ⚠️ **Important:** Menu mein `:cloud` wale models (jaise `gemini-3-flash-preview:cloud`) **paid Ollama subscription** maangte hain (403 error) aur kuch retire ho chuke hain (410 error). **Free ke liye:** local models ya `toxic gemini` use karo.

### 1️⃣ Local AI (offline, free)

```bash
toxic serve &              # server start (background)
toxic pull qwen3.5:4b      # model download (8GB RAM phones)
toxic run qwen3.5:4b       # chat — airplane mode mein bhi chalega!
toxic list                 # installed models
toxic stop                 # running models stop
```

**Apne RAM ke hisaab se model:**

| Phone RAM | Model |
|---|---|
| 4–6 GB | `qwen3.5:0.5b` ya `gemma4:1b` |
| 8 GB | `qwen3.5:4b` ya `gemma4:e4b` ⭐ recommended |
| 12–16 GB | 9B models tak |

### 2️⃣ Gemini cloud chat — 6 built-in keys, AUTO-SWITCH 🔑

```bash
toxic gemini "explain quantum computing in simple words"
toxic gemini                          # interactive chat mode
```

**Kaise auto-switch hota hai:**
- 6 API keys pehle se built-in hain — **koi setup nahi, seedha chalao**
- Key expire/quota-full (429) hui → **automatically agli key** par switch
- Invalid key (401/403) → pool se hat jati hai, agli key chalti hai
- Rate-limited key 60 second baad wapas pool mein aa jati hai
- Jo key+model chal raha hai, wahi sticky hota hai (fast retries)

**Apni key bhi laga sakte ho (priority milegi):**
```bash
export GEMINI_API_KEY="your-key"          # ek key
export GEMINI_API_KEY="key1,key2,key3"    # ya multiple keys comma se
export GEMINI_MODEL="gemini-3.6-flash"    # (optional) model override
```

### 3️⃣ Coding agents

```bash
toxic launch qwen      # Qwen Code — FREE 2000 requests/day (browser sign-in)
toxic launch codex     # OpenAI Codex (API key / ChatGPT account)
toxic launch pi        # Pi agent
```

### 4️⃣ Menu

```bash
toxic menu             # original interactive menu (agents ke liye)
toxic chat             # seedha Gemini chat
toxic status           # installation status
toxic help             # all commands
toxic update           # runtime update
toxic uninstall        # remove runtime
```

## 📖 Docs

- [Benchmarks](docs/BENCHMARKS.md) — real phones par performance numbers
- [Vulkan GPU](docs/VULKAN_ANDROID_LOADER.md) — GPU acceleration enable karna

## ⚙️ Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | 6 bundled keys | Apni key(s) — comma-separated bhi chalti hain, priority milti hai |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model override |
| `ZYROX_RUNTIME_VERSION` | `0.32.2-termux.1` | Runtime version pin karne ke liye |

## 📄 License

MIT — [LICENSE](LICENSE)

---

<div align="center">

**ZYROX** ⚡ — *Phone mein AI.*

</div>
