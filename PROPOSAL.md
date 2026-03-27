# rein: Next-Generation P2P Architecture with WebRTC, Koffi, and Cross-Platform Packaging

**Project Size:** Large (22 weeks / ~350 hours)
**Discord:** upendrasingh786_91083
**GitHub:** [@upendra512](https://github.com/upendra512)
**PoC Repository:** [upendra512/rein-poc](https://github.com/upendra512/rein-poc)

---

## Abstract

Rein is a cross-platform LAN-based remote input controller that allows touchscreen devices to act as a trackpad and keyboard for desktop systems. The current architecture relies on WebSocket for all real-time communication and Nut.js for native input simulation — both of which introduce performance bottlenecks, maintenance overhead, and scalability limitations.

This proposal outlines a complete architectural migration to:

1. **WebRTC** — replacing WebSocket with peer-to-peer DataChannels for input events and MediaTracks for screen mirroring, eliminating the server as a data relay and achieving sub-millisecond latency on LAN.
2. **Koffi FFI** — replacing Nut.js with direct OS-level API calls via a lightweight Foreign Function Interface, reducing bundle size, eliminating prebuilt binary issues, and enabling finer-grained control over input simulation.
3. **Cross-platform packaging** — evaluating and implementing both Electron Forge and ElectroBun for distributing Rein as a native desktop application across Windows, Linux, and macOS.

A working Proof of Concept demonstrating the WebRTC + Koffi architecture is available at [upendra512/rein-poc](https://github.com/upendra512/rein-poc).

---

## Table of Contents

1. [Abstract](#abstract)
2. [About Me](#about-me)
3. [Architecture Overview](#architecture-overview)
4. [Detailed Architecture](#detailed-architecture)
   - 4.1 [WebRTC Communication Layer](#41-webrtc-communication-layer)
   - 4.2 [HTTP Signaling Server](#42-http-signaling-server)
   - 4.3 [Koffi Native Input Layer](#43-koffi-native-input-layer)
   - 4.4 [Screen Mirroring via MediaTrack](#44-screen-mirroring-via-mediatrack)
   - 4.5 [Cross-Platform Packaging](#45-cross-platform-packaging)
5. [Challenges and Solutions](#challenges-and-solutions)
6. [Packaging Strategy](#packaging-strategy)
7. [Timeline](#timeline)
8. [Future Expansion](#future-expansion)
9. [Contributions to Rein](#contributions-to-rein)

---

## About Me

**Name:** Upendra Singh
**University:** [Your University Name] — Undergraduate Student
**GitHub:** [@upendra512](https://github.com/upendra512)
**Email:** upendra.singh@tesseris.org
**Discord:** upendrasingh786_91083
**Location:** India (IST, UTC+5:30)

### Technical Skills
- **Languages:** TypeScript, JavaScript, HTML/CSS, Python
- **Frameworks:** React, Node.js, Express, Electron, TanStack
- **Tools:** Git, VS Code, Linux, Docker
- **Relevant Knowledge:** WebRTC, FFI, WebSocket, Systems Programming, Cross-platform development

### Open Source Contributions to AOSSIE

| PR | Project | Description | Status |
|---|---|---|---|
| [#319](https://github.com/AOSSIE-Org/Rein/pull/319) | Rein | Fix JSON.parse crash in trackpad component | Open |
| [#322](https://github.com/AOSSIE-Org/Rein/pull/322) | Rein | Fix GPU memory leak in video element cleanup | Open |
| [#323](https://github.com/AOSSIE-Org/Rein/pull/323) | Rein | Fix timer leak on unmount in useTrackpadGesture | Open |
| [#324](https://github.com/AOSSIE-Org/Rein/pull/324) | Rein | Prevent Electron hang when Nitro server fails | Open |
| [#325](https://github.com/AOSSIE-Org/Rein/pull/325) | Rein | Handle touchcancel for stuck gesture prevention | Open |
| [#326](https://github.com/AOSSIE-Org/Rein/pull/326) | Rein | Support dev builds in Electron without packaging | Open |

**PoC:** [upendra512/rein-poc](https://github.com/upendra512/rein-poc) — Working prototype of WebRTC + Koffi architecture

---

## Architecture Overview

### Current Architecture (WebSocket + Nut.js)

```
┌──────────────┐         WebSocket          ┌──────────────┐
│              │ ◄────── (TCP, server ──────►│              │
│  📱 Phone    │          relayed)           │  🖥️ Desktop  │
│  (Client)    │                             │  (Server)    │
│              │   Canvas blobs via WS       │              │
│  Touch Area  │ ◄────── (binary frames) ────│  Nut.js      │
│  Keyboard    │                             │  ydotool     │
│  Screen View │                             │  Screen Cap  │
└──────────────┘                             └──────────────┘

Problems:
• Server relays ALL data (bottleneck)
• TCP head-of-line blocking delays mouse events
• Manual canvas capture is CPU-intensive
• Nut.js has large bundles and prebuilt binary issues
• No adaptive bitrate for screen mirroring
```

### Proposed Architecture (WebRTC + Koffi)

```
┌──────────────┐                             ┌──────────────┐
│              │   HTTP Signaling (once)      │              │
│  📱 Phone    │ ──────────────────────────►  │  🖥️ Desktop  │
│  (Client)    │                              │  (Server)    │
│              │                              │              │
│              │ ◄═══ WebRTC P2P (direct) ═══►│              │
│              │                              │              │
│  Touch Area ─┼─► DataChannel (unordered) ──►│─► Koffi FFI  │
│  Keyboard  ──┼─► DataChannel (ordered) ────►│   │ Win32    │
│              │                              │   │ X11      │
│  Screen    ◄─┼─◄ MediaTrack (H.264/VP9) ◄──│   │ CGEvent  │
│  Mirror      │   (hardware encoded)        │   └─► OS     │
└──────────────┘                             └──────────────┘

Benefits:
• P2P — server is not in the data path
• UDP-like channel for mouse (no head-of-line blocking)
• Hardware-encoded screen streaming
• Adaptive bitrate automatically
• Koffi: lightweight, no prebuilt binary issues
• Direct OS API access for precise input control
```

---

## Detailed Architecture

### 4.1 WebRTC Communication Layer

The core innovation is replacing the WebSocket-based client-server model with WebRTC peer-to-peer communication using two distinct DataChannels:

#### DataChannel Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  RTCPeerConnection                       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  DataChannel: "input-unreliable"                 │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │ ordered: false                            │   │   │
│  │  │ maxRetransmits: 0                         │   │   │
│  │  │ Transport: SCTP/DTLS/UDP                  │   │   │
│  │  │                                           │   │   │
│  │  │ Events: move, scroll, zoom                │   │   │
│  │  │ Behavior: Fire-and-forget                 │   │   │
│  │  │ Rationale: Old mouse positions are stale; │   │   │
│  │  │ dropping one frame is better than         │   │   │
│  │  │ delaying all subsequent frames            │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  DataChannel: "input-reliable"                   │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │ ordered: true                             │   │   │
│  │  │ reliable: true (default)                  │   │   │
│  │  │ Transport: SCTP/DTLS/UDP (with retransmit)│   │   │
│  │  │                                           │   │   │
│  │  │ Events: click, key, text, combo,          │   │   │
│  │  │         copy, paste                       │   │   │
│  │  │ Behavior: Guaranteed delivery and order   │   │   │
│  │  │ Rationale: Keystrokes and clicks must     │   │   │
│  │  │ not be lost or reordered                  │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  MediaTrack: "screen-mirror"                     │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │ Codec: H.264 / VP9 / AV1                 │   │   │
│  │  │ Source: getDisplayMedia()                 │   │   │
│  │  │ Encoding: Hardware-accelerated            │   │   │
│  │  │ Bitrate: Adaptive (automatic)             │   │   │
│  │  │ Direction: Desktop → Phone (one-way)      │   │   │
│  │  │ Rationale: Native video pipeline replaces │   │   │
│  │  │ manual canvas capture + blob transfer     │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### Message Format (Binary Protocol)

To minimize serialization overhead on the unordered channel, input events will use a compact binary format instead of JSON:

```
Mouse Move (6 bytes):
┌──────────┬───────────┬───────────┐
│ Type (1) │  dx (2)   │  dy (2)   │
│  0x01    │ int16_le  │ int16_le  │
└──────────┴───────────┴───────────┘

Scroll (6 bytes):
┌──────────┬───────────┬───────────┐
│ Type (1) │  dx (2)   │  dy (2)   │
│  0x02    │ int16_le  │ int16_le  │
└──────────┴───────────┴───────────┘

Click (3 bytes):
┌──────────┬──────────┬───────────┐
│ Type (1) │ Button(1)│ Press (1) │
│  0x03    │ 0/1/2    │ 0/1       │
└──────────┴──────────┴───────────┘

Key (variable):
┌──────────┬──────────┬───────────────┐
│ Type (1) │ Len (1)  │ Key (N bytes) │
│  0x04    │ N        │ UTF-8         │
└──────────┴──────────┴───────────────┘
```

This reduces per-message overhead from ~50-100 bytes (JSON) to 3-6 bytes (binary), critical for high-frequency mouse events at 60+ Hz.

---

### 4.2 HTTP Signaling Server

WebRTC requires a signaling mechanism for initial connection setup. Instead of maintaining a persistent WebSocket for signaling, we use lightweight HTTP endpoints:

#### Signaling Flow

```
     Phone                    Server                   Desktop
       │                        │                         │
       │  1. GET /api/ip        │                         │
       │ ──────────────────────►│                         │
       │ ◄──────────────────────│                         │
       │    { ip: 192.168.x.x } │                         │
       │                        │                         │
       │                        │  2. GET /api/signal/ice │
       │                        │    (SSE, role=desktop)  │
       │                        │◄────────────────────────│
       │                        │    [SSE stream open]    │
       │                        │                         │
       │  3. POST /api/signal   │                         │
       │    { type: "offer",    │                         │
       │      sdp: "..." }      │                         │
       │ ──────────────────────►│  4. Forward offer       │
       │                        │ ─────── SSE event ─────►│
       │                        │                         │
       │                        │  5. POST /api/signal    │
       │                        │◄────────────────────────│
       │                        │    { type: "answer" }   │
       │ ◄──────────────────────│                         │
       │    { type: "answer" }  │                         │
       │                        │                         │
       │  6. ICE candidates     │  6. ICE candidates      │
       │ ─── POST /api/signal ─►│──── SSE event ─────────►│
       │ ◄── SSE event ─────────│◄─ POST /api/signal ─────│
       │                        │                         │
       │  ════════════════════════════════════════════════ │
       │           7. WebRTC P2P ESTABLISHED               │
       │  ════════════════════════════════════════════════ │
       │                        │                         │
       │  All data flows P2P    │  Server idle            │
       │ ◄═══════════════════════════════════════════════►│
```

#### API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /api/ip` | GET | Returns server's LAN IP for QR code |
| `POST /api/token` | POST | Generate auth token (localhost only) |
| `POST /api/signal` | POST | Exchange SDP offer/answer and ICE candidates |
| `GET /api/signal/ice` | GET (SSE) | Server-Sent Events stream for ICE candidates |
| `POST /api/config` | POST | Update server configuration |

---

### 4.3 Koffi Native Input Layer

Koffi replaces Nut.js by providing direct FFI access to OS-level input APIs. This eliminates the need for prebuilt native binaries and gives us finer control over input simulation.

#### Platform Abstraction Architecture

```
┌───────────────────────────────────────────────────┐
│              InputController (Unified API)          │
│                                                     │
│  moveMouse(dx, dy)    keyPress(key)                │
│  mouseClick(button)   keyRelease(key)              │
│  mouseDown(button)    typeText(text)               │
│  mouseUp(button)      scroll(dx, dy)               │
│  zoom(delta)          combo(keys[])                │
└────────────────┬──────────────────────────────────┘
                 │ Platform Detection (os.platform())
        ┌────────┼────────┐
        ▼        ▼        ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Windows  │ │  Linux   │ │  macOS   │
│          │ │          │ │          │
│ user32   │ │ libX11   │ │ Core     │
│  .dll    │ │ libXtst  │ │ Graphics │
│          │ │ ydotool  │ │          │
│ Send     │ │ XTest    │ │ CGEvent  │
│ Input()  │ │ Fake     │ │ Create   │
│ Set      │ │ Motion() │ │ Mouse    │
│ Cursor   │ │ Fake     │ │ Event()  │
│ Pos()    │ │ Key()    │ │ CGEvent  │
│ Get      │ │          │ │ Post()   │
│ Cursor   │ │ Wayland: │ │          │
│ Pos()    │ │ ydotool  │ │ CGEvent  │
│          │ │ fallback │ │ Create   │
│          │ │          │ │ Keyboard │
│          │ │          │ │ Event()  │
└──────────┘ └──────────┘ └──────────┘
    via           via           via
   Koffi         Koffi         Koffi
    FFI           FFI           FFI
```

#### Windows Implementation (Win32 API via Koffi)

```javascript
// Load user32.dll via Koffi
const user32 = koffi.load("user32.dll")

// Define Win32 structures
const POINT = koffi.struct("POINT", { x: "long", y: "long" })
const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
  dx: "long", dy: "long",
  mouseData: "uint32", dwFlags: "uint32",
  time: "uint32", dwExtraInfo: "uintptr"
})

// Bind Win32 functions
const GetCursorPos = user32.func("bool GetCursorPos(_Out_ POINT*)")
const SetCursorPos = user32.func("bool SetCursorPos(int, int)")
const SendInput = user32.func("uint32 SendInput(uint32, INPUT*, int)")

// Usage: Move mouse relatively
function moveMouse(dx, dy) {
  const pos = {}
  GetCursorPos(pos)
  SetCursorPos(pos.x + dx, pos.y + dy)
}
```

#### Linux Implementation

```javascript
// X11 session: use libX11 + libXtst via Koffi
const libX11 = koffi.load("libX11.so.6")
const libXtst = koffi.load("libXtst.so.6")

const XOpenDisplay = libX11.func("void* XOpenDisplay(const char*)")
const XTestFakeMotionEvent = libXtst.func(
  "int XTestFakeMotionEvent(void*, int, int, int, unsigned long)"
)

// Wayland: fallback to ydotool via child_process
```

#### Comparison: Koffi vs Nut.js

| Metric | Nut.js | Koffi |
|---|---|---|
| Bundle size | ~15-25 MB (with prebuilt binaries) | ~2-3 MB (FFI bridge only) |
| Installation | Requires prebuild-install, often fails | Simple npm install, reliable |
| Electron compatibility | Frequent Node ABI mismatches | Minimal native footprint |
| Wayland support | None (X11 only) | Can call any library |
| API coverage | Fixed (what library offers) | Full OS API access |
| Performance overhead | Abstraction layers | Direct native calls |
| License | Paid features in v3+ | MIT (fully open) |
| Maintenance | Depends on maintainers | You control API calls |

---

### 4.4 Screen Mirroring via MediaTrack

#### Current Approach (Problems)

```
Desktop                              Phone
getDisplayMedia() → Canvas
  → ctx.drawImage() (CPU)
  → canvas.toBlob("webp") (CPU)
  → WebSocket.send(blob) (TCP)  ───► img.src = blob
                                      (decode + render)

Issues:
• CPU-intensive: manual frame capture at ~12 FPS
• No hardware encoding
• TCP transport: head-of-line blocking
• No adaptive bitrate
• Server relays all frames
• High bandwidth: raw WebP blobs
```

#### Proposed Approach (WebRTC MediaTrack)

```
Desktop                              Phone
getDisplayMedia()
  → stream.getVideoTracks()
  → pc.addTrack(videoTrack)
  → Hardware encode (H.264/VP9) ════► <video>.srcObject = stream
  → RTP/UDP transport (P2P)           (hardware decode + render)
  → Adaptive bitrate (automatic)

Benefits:
• Hardware-accelerated encoding and decoding
• Adaptive bitrate (auto quality adjustment)
• P2P: server never sees video frames
• 30-60 FPS achievable on LAN
• Sub-100ms glass-to-glass latency
• Codec negotiation (H.264 preferred for hardware support)
```

---

### 4.5 Cross-Platform Packaging

#### Electron Forge

```
┌─────────────────────────────────────┐
│         Electron Forge               │
│                                     │
│  Makers:                            │
│  ├── @electron-forge/maker-squirrel │ → Windows (.exe installer)
│  ├── @electron-forge/maker-dmg      │ → macOS (.dmg)
│  ├── @electron-forge/maker-deb      │ → Linux (.deb)
│  └── @electron-forge/maker-rpm      │ → Linux (.rpm)
│                                     │
│  Auto-update: electron-updater      │
│  Code signing: built-in support     │
│  Asar packaging: yes                │
└─────────────────────────────────────┘
```

#### ElectroBun (Alternative)

```
┌─────────────────────────────────────┐
│         ElectroBun                   │
│                                     │
│  • Bun runtime instead of Node.js   │
│  • Smaller bundle size              │
│  • Faster startup time              │
│  • Native OS APIs via Bun FFI       │
│  • macOS + Linux support            │
│  • Windows support (experimental)   │
│                                     │
│  Trade-offs:                        │
│  • Less mature ecosystem            │
│  • Fewer plugins                    │
│  • Community still growing          │
└─────────────────────────────────────┘
```

Both will be evaluated during the project. Electron Forge is the primary target for stability; ElectroBun is explored as a potential future optimization.

---

## Challenges and Solutions

### Challenge 1: WebRTC Reconnection on Network Changes

**Problem:** Wi-Fi roaming or network interruptions drop the WebRTC connection. Unlike WebSocket, WebRTC does not auto-reconnect.

**Solution:** Implement ICE restart mechanism. When `iceConnectionState` changes to "disconnected" or "failed":
1. Trigger ICE restart via `pc.restartIce()`
2. Create new offer with `iceRestart: true`
3. Re-exchange SDP via signaling server
4. Maintain a heartbeat ping via the ordered DataChannel

### Challenge 2: Firewall Blocking UDP on LAN

**Problem:** Some corporate/aggressive firewalls block UDP even on local networks, preventing WebRTC DataChannels from establishing.

**Solution:** Implement a WebSocket fallback path:
1. Attempt WebRTC connection first (5-second timeout)
2. If ICE fails, fall back to WebSocket (existing infrastructure)
3. Display connection type to user ("P2P" vs "Relayed")

### Challenge 3: Koffi Struct Alignment on Windows

**Problem:** Win32 `INPUT` structure uses a union (`MOUSEINPUT` | `KEYBDINPUT` | `HARDWAREINPUT`). Incorrect struct alignment causes SendInput to fail silently.

**Solution:** Carefully define structs with Koffi's `koffi.struct()` and `koffi.union()`, validate with `koffi.sizeof()`, and test against known working Win32 calls. Add automated tests that verify struct sizes match expected values.

### Challenge 4: Wayland Input Simulation

**Problem:** X11/XTest APIs do not work on Wayland compositors. ydotool requires `ydotoold` daemon with root/uinput access.

**Solution:** Multi-strategy approach:
1. Detect session type (`XDG_SESSION_TYPE`)
2. X11 → use Koffi + libXtst
3. Wayland → use ydotool (existing approach, proven)
4. Future → explore libei (emerging Wayland input emulation interface)

### Challenge 5: macOS Accessibility Permissions

**Problem:** macOS requires explicit Accessibility permission for apps that control input, regardless of the method used.

**Solution:** Detect permission status on startup, show clear UI prompt guiding users to System Preferences → Privacy & Security → Accessibility. Provide a one-click "Open Settings" button.

### Challenge 6: Screen Mirroring Codec Compatibility

**Problem:** Not all devices support the same video codecs. H.264 has best hardware support but VP8/VP9 are universally available in WebRTC.

**Solution:** Let WebRTC handle codec negotiation automatically. Prefer H.264 via `setCodecPreferences()` when available, fall back to VP8/VP9. Test across Chrome, Safari, and Firefox mobile browsers.

---

## Packaging Strategy

### Phase 1: Electron Forge (Primary)

| Platform | Format | Tool |
|---|---|---|
| Windows | .exe (Squirrel) | @electron-forge/maker-squirrel |
| macOS | .dmg | @electron-forge/maker-dmg |
| Linux | .deb, .rpm, .AppImage | @electron-forge/maker-deb, maker-rpm |

**Configuration:**
- Asar packaging with unpacked files for native modules
- Code signing for macOS and Windows
- Auto-update via electron-updater
- CI/CD with GitHub Actions for all three platforms

### Phase 2: ElectroBun (Experimental)

Evaluate ElectroBun as a lighter alternative:
- Compare bundle sizes (Electron: ~150MB vs ElectroBun: ~50MB estimated)
- Compare startup times
- Test Koffi compatibility with Bun FFI
- Document findings for future migration decision

---

## Timeline (22 Weeks)

### Community Bonding (Weeks 1-2)

| Week | Activities |
|---|---|
| 1 | Deep dive into Rein codebase, set up all dev environments (Win/Linux/macOS VMs), align with mentors on architecture decisions |
| 2 | Finalize binary protocol format, set up CI/CD pipeline, create integration test framework |

### Phase 1: WebRTC Migration (Weeks 3-8)

| Week | Deliverable |
|---|---|
| 3 | Implement HTTP signaling server (POST /api/signal + SSE /api/signal/ice) |
| 4 | Implement WebRTC connection in ConnectionProvider (replace WebSocket client) |
| 5 | Implement unordered DataChannel for mouse/scroll/zoom with binary protocol |
| 6 | Implement ordered DataChannel for key/text/combo/clipboard |
| 7 | Implement ICE restart, reconnection logic, and WebSocket fallback |
| 8 | Integration testing, latency benchmarking, fix edge cases |

**Midterm Evaluation Deliverable:** Fully functional WebRTC-based input control (trackpad, keyboard, scroll, zoom) with latency under 5ms on LAN.

### Phase 2: Koffi Native Input (Weeks 9-13)

| Week | Deliverable |
|---|---|
| 9 | Implement Windows input handler (Koffi + user32.dll: SendInput, SetCursorPos) |
| 10 | Implement Linux input handler (Koffi + X11/XTest, ydotool fallback) |
| 11 | Implement macOS input handler (Koffi + CoreGraphics CGEvent APIs) |
| 12 | Implement unified InputController API, remove Nut.js dependency |
| 13 | Cross-platform testing on VMs, fix platform-specific issues |

### Phase 3: Screen Mirroring + MediaTrack (Weeks 14-17)

| Week | Deliverable |
|---|---|
| 14 | Replace canvas capture with getDisplayMedia() + RTCPeerConnection.addTrack() |
| 15 | Implement codec preference (H.264 > VP9 > VP8), test on mobile browsers |
| 16 | Remove WebSocket binary relay, implement P2P-only screen mirroring |
| 17 | Adaptive bitrate testing, latency optimization, mobile browser compatibility |

### Phase 4: Packaging + Polish (Weeks 18-22)

| Week | Deliverable |
|---|---|
| 18 | Set up Electron Forge configuration, test packaging on all platforms |
| 19 | Evaluate ElectroBun, document comparison, implement if viable |
| 20 | End-to-end testing suite, performance benchmarks, bug fixes |
| 21 | Documentation, architecture diagrams update, contributor guide |
| 22 | Final review, code cleanup, buffer for unexpected issues |

**Final Evaluation Deliverable:** Complete WebRTC + Koffi architecture deployed across Windows, Linux, and macOS with Electron Forge packaging, comprehensive tests, and documentation.

---

## Future Expansion

### Post-GSoC Roadmap

1. **Audio Streaming** — Add audio track to RTCPeerConnection for remote audio playback
2. **File Transfer** — Use DataChannel for drag-and-drop file transfer between phone and desktop
3. **Multi-monitor Support** — Allow selecting which monitor to mirror/control
4. **Gamepad Emulation** — Virtual gamepad overlay for gaming use cases
5. **Remote Access Beyond LAN** — Add STUN/TURN support for controlling desktop over internet
6. **Plugin System** — Allow third-party extensions for custom input mappings
7. **Clipboard Sync** — Bidirectional clipboard sharing via ordered DataChannel
8. **Touch Mode for Screen Mirror** — Tap on mirrored screen to click at that position
9. **ElectroBun Migration** — If evaluation is positive, migrate for smaller bundle size
10. **Flathub/Snap Distribution** — Linux package manager distribution pipeline

---

## Contributions to Rein

### Pull Requests Submitted

I have submitted 6 PRs to Rein demonstrating deep understanding of the codebase:

1. **[PR #319](https://github.com/AOSSIE-Org/Rein/pull/319)** — Fixed JSON.parse crash in trackpad component by adding try/catch error handling for malformed localStorage data
2. **[PR #322](https://github.com/AOSSIE-Org/Rein/pull/322)** — Fixed GPU memory leak by adding video.pause() and video.srcObject = null cleanup in useCaptureProvider
3. **[PR #323](https://github.com/AOSSIE-Org/Rein/pull/323)** — Fixed timer memory leak by adding useEffect cleanup for draggingTimeout in useTrackpadGesture
4. **[PR #324](https://github.com/AOSSIE-Org/Rein/pull/324)** — Prevented Electron hang by adding retry limit to waitForServer and SIGTERM/SIGINT signal handlers
5. **[PR #325](https://github.com/AOSSIE-Org/Rein/pull/325)** — Added touchcancel event handler to prevent stuck gesture state on mobile devices
6. **[PR #326](https://github.com/AOSSIE-Org/Rein/pull/326)** — Added development build support in Electron, eliminating need to package for every change

### Proof of Concept

**Repository:** [upendra512/rein-poc](https://github.com/upendra512/rein-poc)

The PoC demonstrates:
- WebRTC signaling via HTTP/SSE (replacing WebSocket)
- Two DataChannels (unordered + ordered) for input events
- Koffi FFI calling Win32 SendInput for mouse/keyboard control
- Client UI with touch area, gesture detection, and screen mirror
- Platform-specific input handlers for Windows, Linux, and macOS

---

*This proposal was prepared for Google Summer of Code 2026 with AOSSIE.*
*Candidate: Upendra Singh (@upendra512)*
