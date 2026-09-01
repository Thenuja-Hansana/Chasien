# Running Chasien locally — full runbook

Written after the first real end-to-end local run (2026-09-01), which hit
several environment problems worth documenting so they don't have to be
re-diagnosed from scratch next time. This machine has 8GB RAM, which is
tight for Docker + a physical device build simultaneously — see the
"Known gotchas" section for what that causes and how to work around it.

The dev-client APK only needs to be **rebuilt** when native code changes
(new native module, `app.json` native config changes, `android/` edits).
Otherwise, use "Every day" below — it's much faster.

## One-time setup

`adb` is **not on this machine's PATH** by default — every `adb` command
below will fail with `CommandNotFoundException` unless you either use its
full path each time (`& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`)
or add it to PATH once, permanently:
```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\Android\Sdk\platform-tools", "User")
```
Close and reopen PowerShell afterward for it to take effect. The rest of
this doc assumes plain `adb` works — do this first.

## Every day (dev-client already installed on your phone)

1. **Start Docker Desktop** (if not already running) and wait for it to
   say "Engine running." Don't trust that alone — see gotcha #1 below.

2. **Start the Supabase stack.** Directory: **repo root**
   (`chasien/`, the folder containing `supabase/`):
   ```powershell
   cd C:\Users\conta\Desktop\chasien
   npx supabase start
   ```
   Wait for the JSON block with `API_URL`, `ANON_KEY`, etc.

3. **Check `edge_runtime` came up** — it's needed for Room join/invite
   actions and push notifications, and it doesn't always restart
   automatically. Directory: **anywhere** (`docker` is a global command,
   not tied to the repo):
   ```powershell
   docker ps --format "{{.Names}}`t{{.Status}}" | findstr chasien
   ```
   If `supabase_edge_runtime_chasien` is missing or `Exited`:
   ```powershell
   docker start supabase_edge_runtime_chasien
   ```
   (`supabase_vector_chasien` restart-looping is fine — it's just the
   internal log shipper for Studio, not required for the app.)

4. **Plug in your phone via USB**, confirm it's detected. Directory:
   **anywhere** (assumes the one-time PATH setup above is done):
   ```powershell
   adb devices -l
   ```
   Should list your phone's serial (not empty). If empty, see gotcha #3.

5. **Set up the port tunnels** (every time you replug/reconnect — these
   don't survive an adb server restart or a replug). Directory:
   **anywhere**:
   ```powershell
   adb reverse tcp:8081 tcp:8081
   adb reverse tcp:54321 tcp:54321
   ```

6. **Check nothing else is already on port 8081** (a previous Metro
   session can leak an orphaned node process — see gotcha #4).
   Directory: **anywhere**:
   ```powershell
   Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue
   ```
   If something's there and it's an old `expo` process, kill it
   (`Stop-Process -Id <pid> -Force`) before continuing.

7. **Start Metro.** Directory: **`mobile/`**:
   ```powershell
   cd C:\Users\conta\Desktop\chasien\mobile
   npx expo start --dev-client --port 8081
   ```
   Wait for `Waiting on http://localhost:8081`.

8. **Launch the app on your phone**, pointed at `localhost` (not the
   printed LAN IP/QR code — see gotcha #2 for why). Directory:
   **anywhere**:
   ```powershell
   adb shell am force-stop com.thenujacode.chasien
   adb shell am start -a android.intent.action.VIEW -d "exp+chasien://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
   ```

## First time / after a native code change (full rebuild)

Same as above through step 6, then instead of step 7. Directory:
**`mobile/`**:

```powershell
cd C:\Users\conta\Desktop\chasien\mobile
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npx expo run:android
```

This builds the native app (several minutes) and installs + launches it
automatically. `JAVA_HOME` must point at Android Studio's bundled JDK 21
— see gotcha #5. After it launches, if it opens pointed at a LAN IP
instead of `localhost`, redo step 8 above to fix it.

## Test accounts (local seed data)

All seeded accounts use the password `password123`:

| Email | Handle |
|---|---|
| mara@example.com | maraclimbs |
| tobi@example.com | tobi |
| nadia@example.com | nadia |
| kwame@example.com | kwame |
| rui@example.com | rui |
| eve@example.com | eve |
| outsider@example.com | outsider_test |

For features needing two accounts at once (chat delivery, likes,
reactions, join requests), use your phone for one account and a browser
on this laptop for a second. Easiest: just open `http://localhost:8081`
in a browser while Metro from step 7 is already running — no extra
command needed, no adb/network setup either, since a browser on this
machine reaches `localhost` directly. Alternatively, run a dedicated web
session from **`mobile/`**:
```powershell
cd C:\Users\conta\Desktop\chasien\mobile
npx expo start --web
```

Signup confirmation emails don't go to a real inbox locally — check
**http://localhost:54324** (Mailpit) for the confirmation link instead.

## Known gotchas (all hit and diagnosed on 2026-09-01)

1. **`docker info` succeeding doesn't mean Docker is actually healthy.**
   After a crash/restart, Docker Desktop's engine API can return `500
   Internal Server Error` on real container operations while `docker
   info` still reports fine. If `supabase start` fails with a
   `LegacyDockerLifecycleInspectError` or containers won't respond, do a
   full restart: kill all Docker processes, `wsl --shutdown`, relaunch
   Docker Desktop, and wait for `docker ps` (not `docker info`) to
   actually succeed before retrying.

2. **Never launch pointed at the printed LAN IP or QR code.** This
   machine's Wi-Fi (`172.20.10.6` at time of writing) is a phone hotspot
   subnet, and hotspots commonly enable client isolation — plus if
   Cloudflare WARP is connected, it can corrupt Metro's chunked HTTP
   bundle responses in transit (`ProtocolException: Expected leading
   [0-9a-fA-F] character`), causing a stuck "Reloading…" screen. Always
   force the app to connect via `localhost` through `adb reverse`
   instead (step 8 above) — that goes over the USB/ADB transport
   directly and sidesteps both problems entirely.

3. **Phone not showing up in `adb devices`.** In order: (a) check for an
   "Allow USB debugging?" popup on the phone and tap Allow; (b) check the
   phone's USB notification is set to File Transfer/PTP, not
   charge-only; (c) try a different cable — many are power-only; (d) if
   the phone still only shows as a generic `WinUsb Device` in Windows
   Device Manager, install the phone maker's official USB driver (e.g.
   Samsung USB Driver for Mobile Phones / Smart Switch for Samsung
   devices) and replug.

4. **A killed background Metro task can leave its `node` process
   running**, still holding port 8081. Stopping the task in this session
   doesn't guarantee the underlying process died on Windows — check with
   `Get-NetTCPConnection -LocalPort 8081` and kill it directly if so.

5. **The system default `java` (JDK 25) is too new for the Android
   Gradle Plugin's native build** — it fails
   `configureCMakeDebug[...]` with a cryptic "restricted method"
   warning treated as fatal. Android Studio ships its own JDK 21 at
   `C:\Program Files\Android\Android Studio\jbr` — always set
   `JAVA_HOME` to that before running `expo run:android`.

6. **Expo Go from the Play Store may not support this project's SDK.**
   Expo Go only ever supports one SDK version at a time (whatever's
   current when it was last published), and a brand-new project SDK can
   outpace it — "Project is incompatible with this version of Expo Go."
   Downgrading the project's SDK isn't a good fix (disruptive, and won't
   restore push notifications either — see below). Use the dev-client
   build instead; it always matches exactly.

7. **Expo Go cannot do push notifications at all, on any SDK, as of SDK
   53+** — Expo removed remote push support from the Expo Go client
   itself, permanently, as a deliberate change (not a bug in this
   project). `mobile/src/lib/push.ts` already handles this: it detects
   Expo Go and no-ops instead of crashing. Push notifications only work
   in a dev-client or standalone build.

8. **8GB RAM is genuinely tight for this workflow.** Docker's WSL2 VM
   (~850MB) plus a Gradle build (JDK, ~1GB+) plus VS Code's "Language
   Support for Java" extension reacting to the `android/` folder
   (200MB–1GB across several JVM processes, auto-relaunches unless
   disabled) can push free memory to under 5%, which is what actually
   caused the app to get killed mid-session once. If things start
   crashing for no obvious reason, check free memory
   (`Get-CimInstance Win32_OperatingSystem`) before assuming it's an app
   bug. Disabling the Java extension for this workspace (VS Code
   Extensions panel → "Language Support for Java(TM) by Red Hat" →
   Disable (Workspace), then **reload the window** — disabling alone
   isn't enough) recovers real memory since this project's only Java/
   Kotlin/Gradle files are the generated `android/` folder, never hand-
   edited directly.
