# MINI-SHARD

Mobile Cursor aide for Android. Cyberpunk chat HUD inspired by [SHARD](https://github.com/mrhands-eng/SHARD), stripped to **Cursor Cloud Agents only** — no Ollama, no PC chips, no Electron.

Install via **APK** (sideload).

## Features

- Cursor API key login (`GET /v1/me`)
- Cloud agent chat (no-repo agents + follow-up runs + SSE stream)
- Local session history on device
- Model picker (`GET /v1/models`)
- STOP / cancel active run

## Requirements

- Node 20+
- JDK 17+ (21 works)
- Android SDK platform 34 + build-tools 34
- Cursor account with an [API key](https://cursor.com/dashboard?tab=integrations) and access to Cloud Agents (no-repo)

## Develop (web)

```bash
npm install
npm run dev
```

Open the URL, paste your Cursor API key on the gate screen.

## Build APK

```bash
npm install
npm run apk          # prefers release; falls back to debug if no keystore
# or
npm run apk:debug
```

Artifact:

```
release/mini-shard-latest.apk
```

### Optional release signing

Create `keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/to/mini-shard.jks
storePassword=...
keyAlias=mini-shard
keyPassword=...
```

Wire it into `android/app/build.gradle` signingConfigs if you customize further. Without it, the script ships a **debug-signed** APK suitable for sideload testing.

### Install on phone

1. Copy `release/mini-shard-latest.apk` to the device.
2. Allow install from unknown sources for your file manager.
3. Open the APK → Install.
4. Launch **MINI-SHARD** → paste Cursor API key → CONNECT.

## Architecture

```
Android WebView (Capacitor)
  └─ Vite/TS HUD
       └─ https://api.cursor.com
            POST /v1/agents          (first message, no repos/env)
            POST /v1/agents/{id}/runs
            GET  .../runs/{runId}/stream
            POST .../runs/{runId}/cancel
```

Desktop SHARD uses `@cursor/sdk` local agents + custom tools. Phones cannot host that stack, so MINI-SHARD talks to the **Cloud Agents REST API** instead.

On Android, JSON calls use Capacitor native HTTP (avoids WebView CORS). Run progress uses **status polling** (SSE streaming is used in local web preview via the Vite `/v1` proxy).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite preview |
| `npm run build` | Typecheck + web bundle |
| `npm run cap:sync` | Build + sync into `android/` |
| `npm run apk` | Produce sideload APK under `release/` |
| `npm run apk:debug` | Debug APK |

## Not included (by design)

- Local / Ollama models
- PC control (RIG), screen OCR, forge chips
- Desktop SHARD UPLINK bridge
- iOS / Play Store listing
