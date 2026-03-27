# Google Form Answers — Ready to Paste

## Form Link: https://forms.gle/X644fWdLgAUhVcPF6

---

## Field: Project Title
```
rein: Next-Generation P2P Architecture with WebRTC, Koffi, and Cross-Platform Packaging
```

## Field: Project Size
```
Large (22 weeks / ~350 hours)
```

## Field: Discord Handle
```
upendrasingh786_91083
```

## Field: GitHub Username
```
upendra512
```

## Field: PoC Repository Link
```
https://github.com/upendra512/rein-poc
```

## Field: Abstract / Summary (Long Text Answer)

```
Rein is a cross-platform LAN-based remote input controller that allows touchscreen devices to act as a trackpad and keyboard for desktop systems. The current architecture uses WebSocket for all communication and Nut.js for input simulation — both introducing performance bottlenecks and maintenance overhead.

This proposal migrates Rein to a modern P2P architecture:

1. WebRTC replaces WebSocket — Two DataChannels (unordered for mouse/scroll at UDP-like latency, ordered for keys/text with reliable delivery) and MediaTrack for hardware-encoded screen mirroring. The server only handles initial signaling; all real-time data flows peer-to-peer.

2. Koffi FFI replaces Nut.js — Direct OS API calls (Win32 SendInput, X11/XTest, macOS CGEvent) via a lightweight Foreign Function Interface. This eliminates prebuilt binary issues, reduces bundle size by ~80%, and gives finer control over input simulation.

3. Cross-platform packaging — Electron Forge as primary packaging solution with ElectroBun evaluation for potential lighter alternative.

A working PoC demonstrating the WebRTC + Koffi architecture is available at: https://github.com/upendra512/rein-poc

Key deliverables across 22 weeks:
- Weeks 3-8: Complete WebRTC migration (signaling, DataChannels, reconnection)
- Weeks 9-13: Koffi native input for Windows, Linux, macOS
- Weeks 14-17: P2P screen mirroring via MediaTrack
- Weeks 18-22: Packaging, testing, documentation

I have submitted 6 PRs to Rein (#319, #322, #323, #324, #325, #326) covering memory leak fixes, gesture handling, Electron stability, and developer experience improvements — demonstrating deep familiarity with the codebase.
```

## Field: Google Doc Link (Detailed Description)

```
[CREATE A GOOGLE DOC WITH THE FULL PROPOSAL - SEE INSTRUCTIONS BELOW]
```

---

## HOW TO CREATE THE GOOGLE DOC:

### Step 1: Create Google Doc
1. Go to https://docs.google.com
2. Create new document
3. Title: "rein: Next-Generation P2P Architecture — GSoC 2026 Detailed Description"

### Step 2: Copy Content
Copy the FULL content from PROPOSAL.md into the Google Doc

### Step 3: Add Visual Diagrams
For EACH diagram in diagrams.md:
1. Go to https://mermaid.live
2. Copy the mermaid code
3. Paste in editor
4. Export as PNG
5. Insert PNG into Google Doc at the appropriate section

### IMPORTANT Diagrams to Include (in order):
1. **Diagram 1** (Full Architecture) → Place in "Architecture Overview" section
2. **Diagram 2** (Signaling Sequence) → Place in "HTTP Signaling Server" section
3. **Diagram 3** (DataChannel Architecture) → Place in "WebRTC Communication" section
4. **Diagram 4** (Koffi Platform Abstraction) → Place in "Koffi Native Input" section
5. **Diagram 5** (Screen Mirror Comparison) → Place in "Screen Mirroring" section
6. **Diagram 6** (Timeline Gantt) → Place in "Timeline" section

### Step 4: Share Settings
1. Click "Share" button
2. Change to "Anyone with the link can view"
3. Copy the link
4. Paste in the Google Form

### Step 5: Fill the Form
1. Open https://forms.gle/X644fWdLgAUhVcPF6
2. Fill all fields with the answers above
3. Paste Google Doc link
4. Submit

### Step 6: Receive & Submit
1. Check email for generated proposal PDF
2. Go to GSoC portal: https://summerofcode.withgoogle.com
3. Submit the PDF under AOSSIE organization
