/**
 * WebRTC Client for Rein PoC
 *
 * Replaces WebSocket with:
 * 1. DataChannel (unordered) - for mouse move, scroll, zoom (UDP-like, can drop old)
 * 2. DataChannel (ordered)   - for key, text, combo, clipboard (TCP-like, reliable)
 * 3. MediaTrack              - for screen mirroring (P2P video stream)
 *
 * Signaling via HTTP (POST /api/signal + SSE /api/signal/ice)
 */

class ReinWebRTCClient {
  constructor() {
    this.pc = null
    this.dcUnordered = null // Mouse, scroll, zoom
    this.dcOrdered = null // Keys, text, clipboard
    this.scrollMode = false
    this.mirroring = false
    this.connected = false

    // Touch tracking
    this.touches = new Map()
    this.lastTouch = null
    this.moved = false
    this.startTime = 0

    this.init()
  }

  async init() {
    this.setupUI()
    await this.connect()
  }

  updateStatus(state) {
    const el = document.getElementById("status")
    el.textContent =
      state === "connected"
        ? "Connected (WebRTC)"
        : state === "connecting"
          ? "Connecting..."
          : "Disconnected"
    el.className = `status ${state}`
  }

  async connect() {
    this.updateStatus("connecting")

    // Create RTCPeerConnection
    this.pc = new RTCPeerConnection({
      iceServers: [
        // LAN-only, no STUN needed for same network
        // Add STUN for cross-network: { urls: "stun:stun.l.google.com:19302" }
      ],
    })

    // Create two DataChannels (as specified in Rein's target architecture)
    // 1. Unordered channel for high-frequency mouse/scroll events
    this.dcUnordered = this.pc.createDataChannel("input-unreliable", {
      ordered: false,
      maxRetransmits: 0, // UDP-like: no retransmission
    })

    // 2. Ordered channel for reliable key/text events
    this.dcOrdered = this.pc.createDataChannel("input-reliable", {
      ordered: true, // TCP-like: guaranteed order
    })

    // Handle DataChannel open/close
    this.dcUnordered.onopen = () => {
      console.log("[WebRTC] Unordered DataChannel open (mouse/scroll/zoom)")
      this.checkConnection()
    }

    this.dcOrdered.onopen = () => {
      console.log("[WebRTC] Ordered DataChannel open (key/text/combo)")
      this.checkConnection()
    }

    this.dcUnordered.onclose = () => this.updateStatus("disconnected")
    this.dcOrdered.onclose = () => this.updateStatus("disconnected")

    // Handle incoming media track (screen mirror from desktop)
    this.pc.ontrack = (event) => {
      console.log("[WebRTC] Received media track (screen mirror)")
      const video = document.getElementById("mirrorVideo")
      video.srcObject = event.streams[0]
    }

    // ICE candidate handling
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Send ICE candidate to signaling server
        fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candidate",
            candidate: event.candidate,
            from: "phone",
          }),
        })
      }
    }

    this.pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE state:", this.pc.iceConnectionState)
      if (this.pc.iceConnectionState === "connected") {
        this.updateStatus("connected")
      }
    }

    // Listen for signaling events via SSE
    this.setupSSE()

    // Create and send offer
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    try {
      const response = await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: offer.sdp }),
      })

      const answer = await response.json()
      if (answer.type === "answer") {
        await this.pc.setRemoteDescription(
          new RTCSessionDescription(answer)
        )
        console.log("[WebRTC] Remote description set (answer)")
      }
    } catch (err) {
      console.error("[WebRTC] Signaling error:", err)
      this.updateStatus("disconnected")
    }
  }

  setupSSE() {
    const evtSource = new EventSource("/api/signal/ice?role=phone")

    evtSource.onmessage = async (event) => {
      const data = JSON.parse(event.data)

      if (data.type === "candidate" && data.candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          console.log("[WebRTC] Added ICE candidate from desktop")
        } catch (err) {
          console.warn("[WebRTC] Failed to add ICE candidate:", err)
        }
      }

      if (data.type === "answer") {
        await this.pc.setRemoteDescription(
          new RTCSessionDescription(data)
        )
      }
    }
  }

  checkConnection() {
    if (
      this.dcUnordered?.readyState === "open" &&
      this.dcOrdered?.readyState === "open"
    ) {
      this.connected = true
      this.updateStatus("connected")
      console.log("[WebRTC] Both DataChannels open - fully connected!")
    }
  }

  // Send input via appropriate DataChannel
  sendUnordered(msg) {
    if (this.dcUnordered?.readyState === "open") {
      this.dcUnordered.send(JSON.stringify(msg))
    }
  }

  sendOrdered(msg) {
    if (this.dcOrdered?.readyState === "open") {
      this.dcOrdered.send(JSON.stringify(msg))
    }
  }

  setupUI() {
    const touchpad = document.getElementById("touchpad")
    const btnLeft = document.getElementById("btnLeft")
    const btnRight = document.getElementById("btnRight")
    const btnScroll = document.getElementById("btnScroll")
    const btnMirror = document.getElementById("btnMirror")

    // Touch events on trackpad
    touchpad.addEventListener("touchstart", (e) => this.handleTouchStart(e))
    touchpad.addEventListener("touchmove", (e) => this.handleTouchMove(e))
    touchpad.addEventListener("touchend", (e) => this.handleTouchEnd(e))
    touchpad.addEventListener("touchcancel", (e) => this.handleTouchEnd(e))

    // Button clicks
    btnLeft.addEventListener("click", () => {
      this.sendOrdered({ type: "click", button: "left", press: true })
      setTimeout(() => {
        this.sendOrdered({ type: "click", button: "left", press: false })
      }, 50)
    })

    btnRight.addEventListener("click", () => {
      this.sendOrdered({ type: "click", button: "right", press: true })
      setTimeout(() => {
        this.sendOrdered({ type: "click", button: "right", press: false })
      }, 50)
    })

    btnScroll.addEventListener("click", () => {
      this.scrollMode = !this.scrollMode
      btnScroll.style.background = this.scrollMode ? "#228B22" : "#533483"
      btnScroll.textContent = this.scrollMode ? "Scroll: ON" : "Scroll Mode"
    })

    btnMirror.addEventListener("click", () => {
      this.toggleMirror()
    })
  }

  handleTouchStart(e) {
    e.preventDefault()
    this.moved = false
    this.startTime = Date.now()

    for (const touch of e.changedTouches) {
      this.touches.set(touch.identifier, {
        x: touch.pageX,
        y: touch.pageY,
      })
    }
  }

  handleTouchMove(e) {
    e.preventDefault()
    this.moved = true
    const sensitivity = 1.5

    for (const touch of e.changedTouches) {
      const prev = this.touches.get(touch.identifier)
      if (!prev) continue

      const dx = (touch.pageX - prev.x) * sensitivity
      const dy = (touch.pageY - prev.y) * sensitivity

      if (this.scrollMode || e.touches.length === 2) {
        // Scroll events via UNORDERED channel (can drop old ones)
        this.sendUnordered({
          type: "scroll",
          dx: -dx,
          dy: -dy,
        })
      } else {
        // Mouse move via UNORDERED channel (UDP-like)
        this.sendUnordered({
          type: "move",
          dx: dx,
          dy: dy,
        })
      }

      this.touches.set(touch.identifier, {
        x: touch.pageX,
        y: touch.pageY,
      })
    }
  }

  handleTouchEnd(e) {
    e.preventDefault()

    for (const touch of e.changedTouches) {
      this.touches.delete(touch.identifier)
    }

    // Tap detection (quick touch without movement = click)
    if (!this.moved && Date.now() - this.startTime < 200) {
      // Click via ORDERED channel (reliable)
      this.sendOrdered({ type: "click", button: "left", press: true })
      setTimeout(() => {
        this.sendOrdered({ type: "click", button: "left", press: false })
      }, 50)
    }
  }

  toggleMirror() {
    const mirror = document.getElementById("mirror")
    this.mirroring = !this.mirroring
    mirror.style.display = this.mirroring ? "block" : "none"

    const btn = document.getElementById("btnMirror")
    btn.textContent = this.mirroring ? "Hide Mirror" : "Mirror"
    btn.style.borderColor = this.mirroring ? "#e94560" : "#228B22"
  }
}

// Initialize when page loads
window.addEventListener("load", () => {
  new ReinWebRTCClient()
})
