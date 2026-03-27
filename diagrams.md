# Rein Architecture Diagrams (Mermaid)

## How to Use:
## 1. Go to https://mermaid.live
## 2. Copy each diagram code block
## 3. Paste in the editor
## 4. Export as PNG (click download icon)
## 5. Embed in your Google Doc

---

## Diagram 1: Full End-to-End Architecture (MAIN DIAGRAM)

```mermaid
flowchart TD
    subgraph DESKTOP["🖥️ Desktop (Server)"]
        subgraph WRAPPER["Desktop App Wrapper\n(Electron Forge / ElectroBun)"]
            MAIN["App Process\nSpawns HTTP server\nPolls until ready\nOpens browser window"]
            RENDERER["Embedded Browser Window\nHosts Settings UI\nWebRTC peer endpoint"]
        end

        subgraph NITRO["Nitro / Node.js HTTP Server"]
            direction TB
            IP_DETECT["IP Detection\ndgram UDP socket\nconnects to 1.1.1.1:1\nreads socket.address()\n→ LAN IP"]
            HTTP_ROUTES["HTTP API\nGET  /api/ip\nPOST /api/token\nPOST /api/config\nPOST /api/signal\nGET  /api/signal/ice (SSE)"]
            TOKEN_STORE["Token Store\nGenerate / validate\nauth tokens"]
        end

        subgraph KOFFI["Koffi Native Input Layer"]
            INPUT_CTRL["InputController\n(Unified API)"]
            WIN32["Windows\nuser32.dll\nSendInput\nSetCursorPos"]
            LINUX["Linux\nlibX11 + libXtst\nydotool (Wayland)"]
            MACOS["macOS\nCoreGraphics\nCGEvent APIs"]
        end

        IP_DETECT -->|"resolved LAN IP"| HTTP_ROUTES
        HTTP_ROUTES --> TOKEN_STORE
        INPUT_CTRL --> WIN32
        INPUT_CTRL --> LINUX
        INPUT_CTRL --> MACOS
        MAIN -->|"spawns + polls HTTP"| NITRO
        MAIN -->|"opens"| RENDERER
    end

    subgraph PHONE["📱 Phone (Client Browser)"]
        direction TB

        subgraph SETTINGS["Settings Page"]
            SRV_SET["Server Settings\nPort, Server IP"]
            CLIENT_SET["Client Settings\nSensitivity, Scroll\nInvert, Theme"]
            QR["QR Code\nEncodes trackpad URL\nwith auth token"]
        end

        subgraph TRACKPAD["Trackpad Page"]
            TOUCH["Touch Area\nMouse movement\nClick / scroll / zoom"]
            KEYS["Extra Keys\nArrows, Fn, modifiers"]
            KBD["Mobile Keyboard\nText input\nComposition support"]
            MIRROR_VIEW["Screen Mirror\nVideo element\nP2P stream"]
        end

        CONN["ConnectionProvider\nRTCPeerConnection\nDataChannels"]
    end

    subgraph WEBRTC["⚡ WebRTC P2P Layer"]
        DC_UNORDERED["DataChannel — unordered\nmove · scroll · zoom\nUDP-like, drops stale events\nBinary protocol (3-6 bytes)"]
        DC_ORDERED["DataChannel — ordered\nclick · key · text · combo\nTCP-like, reliable delivery\nJSON format"]
        MEDIA["MediaTrack — video\nH.264 / VP9 / AV1\nHardware encoded\nAdaptive bitrate"]
    end

    %% Boot
    MAIN -->|"1. spawn"| NITRO
    NITRO -->|"ready"| MAIN
    RENDERER -->|"2. GET /api/ip"| HTTP_ROUTES
    HTTP_ROUTES -->|"{ ip }"| RENDERER

    %% Token / QR
    RENDERER -->|"3. POST /api/token\n(localhost only)"| HTTP_ROUTES
    HTTP_ROUTES -->|"{ token }"| RENDERER
    RENDERER -->|"QR url"| QR

    %% Phone connects
    QR -->|"4. scan → open URL"| CONN
    CONN -->|"POST /api/signal offer"| HTTP_ROUTES
    HTTP_ROUTES -->|"SDP answer + ICE (SSE)"| CONN

    %% WebRTC P2P
    CONN <-->|"5. P2P established"| RENDERER
    CONN --- DC_UNORDERED
    CONN --- DC_ORDERED
    RENDERER --- MEDIA

    %% Input path
    TOUCH -->|"move / scroll / zoom"| DC_UNORDERED
    KEYS -->|"key / combo"| DC_ORDERED
    KBD -->|"text / backspace"| DC_ORDERED
    DC_UNORDERED -->|"forwarded"| INPUT_CTRL
    DC_ORDERED -->|"forwarded"| INPUT_CTRL

    %% Screen mirror
    RENDERER -->|"getDisplayMedia() stream"| MEDIA
    MEDIA -->|"P2P — server never sees frames"| MIRROR_VIEW

    %% Client settings
    CLIENT_SET -->|"persisted in localStorage"| CLIENT_SET

    %% Config change
    SRV_SET -->|"6. POST /api/config"| HTTP_ROUTES

    style WEBRTC fill:#1a5276,color:#fff
    style KOFFI fill:#1e8449,color:#fff
    style DESKTOP fill:#2c3e50,color:#fff
    style PHONE fill:#7d3c98,color:#fff
```

---

## Diagram 2: WebRTC Signaling Sequence

```mermaid
sequenceDiagram
    participant Phone as 📱 Phone
    participant Server as 🌐 HTTP Server
    participant Desktop as 🖥️ Desktop

    Note over Phone, Desktop: Phase 1: Discovery & Authentication

    Desktop->>Server: GET /api/ip
    Server-->>Desktop: { ip: 192.168.x.x }
    Desktop->>Server: POST /api/token (localhost only)
    Server-->>Desktop: { token: "abc123" }
    Desktop->>Desktop: Generate QR Code with token

    Note over Phone, Desktop: Phase 2: WebRTC Signaling

    Phone->>Phone: Scan QR → Open URL
    Desktop->>Server: GET /api/signal/ice (SSE, role=desktop)
    Note right of Server: SSE stream open

    Phone->>Phone: Create RTCPeerConnection
    Phone->>Phone: Create DataChannels (ordered + unordered)
    Phone->>Phone: Create SDP Offer
    Phone->>Server: POST /api/signal { type: "offer", sdp }
    Server-->>Desktop: SSE event: { type: "offer", sdp }

    Desktop->>Desktop: setRemoteDescription(offer)
    Desktop->>Desktop: Create SDP Answer
    Desktop->>Server: POST /api/signal { type: "answer", sdp }
    Server-->>Phone: Return answer in HTTP response

    Phone->>Phone: setRemoteDescription(answer)

    Note over Phone, Desktop: Phase 3: ICE Candidate Exchange

    Phone->>Server: POST /api/signal { type: "candidate", from: "phone" }
    Server-->>Desktop: SSE event: { type: "candidate" }
    Desktop->>Server: POST /api/signal { type: "candidate", from: "desktop" }
    Server-->>Phone: SSE event: { type: "candidate" }

    Note over Phone, Desktop: Phase 4: P2P Established ✅

    Phone<-->Desktop: DataChannel (unordered): mouse, scroll, zoom
    Phone<-->Desktop: DataChannel (ordered): key, text, click
    Desktop->>Phone: MediaTrack: screen mirror (H.264/VP9)

    Note over Server: Server is now IDLE<br/>All data flows P2P
```

---

## Diagram 3: DataChannel Architecture

```mermaid
flowchart LR
    subgraph PHONE["📱 Phone Input Events"]
        TOUCH["Touch Area\n60 Hz events"]
        SCROLL["Scroll\nTwo-finger"]
        ZOOM["Zoom\nPinch gesture"]
        CLICK["Click\nTap detection"]
        KEYBOARD["Keyboard\nText input"]
        COMBO["Combos\nCtrl+C, etc."]
    end

    subgraph CHANNELS["⚡ WebRTC DataChannels"]
        subgraph UNORDERED["Unordered Channel\n(UDP-like)"]
            U_PROPS["ordered: false\nmaxRetransmits: 0\nBinary protocol\n3-6 bytes/event"]
        end
        subgraph ORDERED["Ordered Channel\n(TCP-like)"]
            O_PROPS["ordered: true\nreliable: true\nJSON format\nGuaranteed delivery"]
        end
    end

    subgraph DESKTOP["🖥️ Desktop Processing"]
        DECODE["Decode\nBinary → Event"]
        THROTTLE["Throttle\n8ms debounce"]
        KOFFI_INPUT["Koffi FFI\nOS Input API"]
    end

    TOUCH -->|"move"| UNORDERED
    SCROLL -->|"scroll"| UNORDERED
    ZOOM -->|"zoom"| UNORDERED
    CLICK -->|"click"| ORDERED
    KEYBOARD -->|"key/text"| ORDERED
    COMBO -->|"combo"| ORDERED

    UNORDERED -->|"P2P"| DECODE
    ORDERED -->|"P2P"| DECODE
    DECODE --> THROTTLE
    THROTTLE --> KOFFI_INPUT

    style UNORDERED fill:#e74c3c,color:#fff
    style ORDERED fill:#2ecc71,color:#fff
```

---

## Diagram 4: Koffi Platform Abstraction

```mermaid
flowchart TD
    INPUT["InputController\n(Unified API)"]

    INPUT -->|"os.platform()"| DETECT{"Platform\nDetection"}

    DETECT -->|"win32"| WIN
    DETECT -->|"linux"| LIN
    DETECT -->|"darwin"| MAC

    subgraph WIN["Windows (user32.dll via Koffi)"]
        direction TB
        W1["koffi.load('user32.dll')"]
        W2["GetCursorPos() → current position"]
        W3["SetCursorPos(x, y) → move cursor"]
        W4["SendInput(INPUT*) → click/key/scroll"]
        W1 --> W2 --> W3 --> W4
    end

    subgraph LIN["Linux (X11 + ydotool via Koffi)"]
        direction TB
        L_DETECT{"XDG_SESSION_TYPE?"}
        L_DETECT -->|"x11"| L_X11["koffi.load('libX11.so')\nkoffi.load('libXtst.so')\nXTestFakeMotionEvent()\nXTestFakeKeyEvent()"]
        L_DETECT -->|"wayland"| L_WAY["ydotool (child_process)\nmousemove -x dx -y dy\nclick / type"]
    end

    subgraph MAC["macOS (CoreGraphics via Koffi)"]
        direction TB
        M1["koffi.load('CoreGraphics.framework')"]
        M2["CGEventCreateMouseEvent()"]
        M3["CGEventCreateKeyboardEvent()"]
        M4["CGEventPost() → inject event"]
        M1 --> M2 --> M3 --> M4
    end

    style WIN fill:#0078d4,color:#fff
    style LIN fill:#e95420,color:#fff
    style MAC fill:#555555,color:#fff
```

---

## Diagram 5: Screen Mirroring Comparison

```mermaid
flowchart LR
    subgraph CURRENT["❌ Current: Canvas + WebSocket"]
        direction TB
        C1["getDisplayMedia()"]
        C2["Canvas.drawImage()\n(CPU bound)"]
        C3["canvas.toBlob('webp')\n(CPU encoding)"]
        C4["WebSocket.send(blob)\n(TCP, server relayed)"]
        C5["Phone: img.src = blob\n(~12 FPS, high latency)"]
        C1 --> C2 --> C3 --> C4 --> C5
    end

    subgraph PROPOSED["✅ Proposed: WebRTC MediaTrack"]
        direction TB
        P1["getDisplayMedia()"]
        P2["pc.addTrack(videoTrack)\n(Hardware encoder)"]
        P3["RTP/UDP transport\n(P2P, adaptive bitrate)"]
        P4["Phone: video.srcObject\n(30-60 FPS, low latency)"]
        P1 --> P2 --> P3 --> P4
    end

    style CURRENT fill:#e74c3c,color:#fff
    style PROPOSED fill:#2ecc71,color:#fff
```

---

## Diagram 6: Project Timeline (Gantt)

```mermaid
gantt
    title Rein GSoC 2026 Timeline (22 Weeks)
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Community Bonding
    Codebase deep dive & setup           :cb1, 2026-05-08, 7d
    Finalize protocol & CI/CD            :cb2, after cb1, 7d

    section Phase 1 - WebRTC
    HTTP signaling server                :p1a, 2026-05-22, 7d
    WebRTC ConnectionProvider            :p1b, after p1a, 7d
    Unordered DataChannel (mouse)        :p1c, after p1b, 7d
    Ordered DataChannel (keys)           :p1d, after p1c, 7d
    Reconnection & fallback              :p1e, after p1d, 7d
    Integration testing                  :p1f, after p1e, 7d

    section Midterm Evaluation
    Midterm review                       :milestone, m1, after p1f, 0d

    section Phase 2 - Koffi
    Windows input (Win32)                :p2a, after p1f, 7d
    Linux input (X11 + ydotool)          :p2b, after p2a, 7d
    macOS input (CoreGraphics)           :p2c, after p2b, 7d
    Unified API & remove Nut.js          :p2d, after p2c, 7d
    Cross-platform testing               :p2e, after p2d, 7d

    section Phase 3 - Screen Mirror
    MediaTrack implementation            :p3a, after p2e, 7d
    Codec negotiation & testing          :p3b, after p3a, 7d
    Remove WS relay, P2P only            :p3c, after p3b, 7d
    Mobile browser compatibility         :p3d, after p3c, 7d

    section Phase 4 - Packaging
    Electron Forge setup                 :p4a, after p3d, 7d
    ElectroBun evaluation                :p4b, after p4a, 7d
    E2E testing & benchmarks             :p4c, after p4b, 7d
    Documentation & cleanup              :p4d, after p4c, 7d

    section Final Evaluation
    Final review                         :milestone, m2, after p4d, 0d
```

---

## Diagram 7: Binary Protocol Format

```mermaid
packet-beta
    title Mouse Move Event (6 bytes)
    0-7: "Type (0x01)"
    8-23: "dx (int16_le)"
    24-39: "dy (int16_le)"
```

---

## How to Create Visual Diagrams:

### Option 1: Mermaid Live Editor (Recommended)
1. Go to https://mermaid.live
2. Copy a diagram code block above
3. Paste in the editor (left panel)
4. Click the download/export icon (PNG)
5. Embed PNG in your Google Doc

### Option 2: Excalidraw (For custom diagrams)
1. Go to https://excalidraw.com
2. Draw the architecture manually
3. Export as PNG
4. Better for custom styling

### Option 3: Draw.io
1. Go to https://draw.io
2. Create a new diagram
3. More formal/professional look
4. Export as PNG

### Tips for Legible Diagrams:
- Use high resolution (2x or 3x)
- Light background, dark text
- Font size 14+ for readability
- Keep diagram width under 800px
- Use color coding consistently
