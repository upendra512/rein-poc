# Rein PoC: WebRTC + Koffi

**Proof of Concept** for migrating [Rein](https://github.com/AOSSIE-Org/Rein) from WebSocket + Nut.js to **WebRTC + Koffi**.

> GSoC 2026 PoC by [@upendra512](https://github.com/upendra512)

## What This Proves

| Current Rein | This PoC |
|---|---|
| WebSocket for all communication | WebRTC DataChannels (P2P) |
| Canvas capture + WS binary for screen mirror | WebRTC MediaTrack (hardware encoded) |
| Nut.js for input control | Koffi FFI (direct OS API calls) |
| Server relays everything | Server only does signaling, then P2P |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    DESKTOP (Server)                  │
│                                                     │
│  ┌──────────────┐    ┌───────────────────────────┐ │
│  │ HTTP Server   │    │ RTCPeerConnection         │ │
│  │ (Express)     │    │                           │ │
│  │               │    │ ┌─ DataChannel (ordered)  │ │
│  │ GET  /api/ip  │    │ │  key, text, combo       │ │
│  │ POST /api/    │    │ │                         │ │
│  │      signal   │    │ ├─ DataChannel (unordered)│ │
│  │ GET  /api/    │    │ │  move, scroll, zoom     │ │
│  │   signal/ice  │    │ │                         │ │
│  │  (SSE)        │    │ └─ MediaTrack (video)     │ │
│  └──────┬───────┘    │    getDisplayMedia()       │ │
│         │            └───────────┬───────────────┘ │
│         │ signaling only         │ P2P data        │
│         │                        │                  │
│         │            ┌───────────▼───────────────┐ │
│         │            │ Koffi Input Handler        │ │
│         │            │ (replaces Nut.js)          │ │
│         │            │                           │ │
│         │            │ Win32: SendInput/          │ │
│         │            │        SetCursorPos        │ │
│         │            │ Linux: ydotool / X11       │ │
│         │            │ macOS: CGEvent APIs        │ │
│         │            └───────────────────────────┘ │
└─────────┼───────────────────────────────────────────┘
          │
    HTTP signaling
    (SDP + ICE only)
          │
┌─────────┼───────────────────────────────────────────┐
│         │              PHONE (Client)                │
│         │                                           │
│  ┌──────▼───────┐    ┌───────────────────────────┐ │
│  │ Signaling     │    │ RTCPeerConnection         │ │
│  │ (fetch +SSE)  │    │                           │ │
│  │               │    │ ┌─ DataChannel (unordered)│ │
│  │ POST offer    │──▶│ │  sends: move/scroll     │ │
│  │ GET  ICE      │    │ │                         │ │
│  │               │    │ ├─ DataChannel (ordered)  │ │
│  └──────────────┘    │ │  sends: key/text/click  │ │
│                       │ │                         │ │
│  ┌──────────────┐    │ └─ MediaTrack (video)     │ │
│  │ Touch Area    │    │    receives screen stream │ │
│  │ Buttons       │───▶│                           │ │
│  │ Keyboard      │    └───────────────────────────┘ │
│  │ Screen Mirror │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

## Key Improvements Over Current Rein

### 1. WebRTC DataChannels (vs WebSocket)
- **Unordered channel** for mouse/scroll (UDP-like, drops stale events = lower latency)
- **Ordered channel** for keyboard/text (TCP-like, reliable delivery)
- **P2P** - no server relay needed after connection

### 2. WebRTC MediaTrack (vs Canvas + WebSocket blobs)
- **Hardware-encoded** video (H.264/VP9) vs manual canvas capture
- **Adaptive bitrate** - automatic quality adjustment
- **P2P** - server never sees video frames
- **Native `getDisplayMedia()`** directly into RTCPeerConnection

### 3. Koffi FFI (vs Nut.js)
- **No prebuilt binaries** - Koffi loads OS libraries dynamically
- **Direct OS API access** - Win32 SendInput, X11, CGEvent
- **Smaller bundle** - no native compilation step
- **Better Electron compatibility** - no node-gyp issues

## Demo Video

[![Rein PoC Demo - WebRTC + Koffi](https://img.youtube.com/vi/Y7DnOQ0exhQ/maxresdefault.jpg)](https://youtu.be/Y7DnOQ0exhQ)

> Watch the PoC in action: P2P trackpad control, keyboard input, real-time latency display, pinch-to-zoom, and screen mirroring — all via WebRTC + Koffi FFI.

## Setup

```bash
npm install
node src/server/index.js

# 1. Open http://localhost:3000/desktop on your laptop (desktop peer)
# 2. Scan the QR code with your phone — or open http://<your-ip>:3000
# 3. Wait for "Connected (P2P)" status
# 4. Click "Share Screen" on desktop, tap "Mirror" on phone
```

## File Structure

```
rein-poc/
├── public/
│   ├── index.html           # Phone UI (touchpad, keyboard, latency display)
│   ├── desktop.html         # Desktop peer (QR code, stats, screen share)
│   └── webrtc-client.js     # WebRTC client (DataChannels, ping/pong, pinch zoom)
├── src/
│   ├── server/
│   │   ├── index.js         # Express server + QR code endpoint
│   │   └── signaling.js     # Bidirectional SDP/ICE via HTTP + SSE
│   └── input/
│       └── handler.js       # Koffi FFI input (Win32, Linux, macOS)
├── package.json
└── README.md
```

## Testing

| Platform | Input Method | Status |
|----------|-------------|--------|
| Windows  | Win32 SendInput via Koffi | Working |
| Linux    | ydotool (Wayland) | Working |
| macOS    | CGEvent APIs | Planned |

## Author

- **Upendra Singh** ([@upendra512](https://github.com/upendra512))
- GSoC 2026 Proposal for AOSSIE / Rein
