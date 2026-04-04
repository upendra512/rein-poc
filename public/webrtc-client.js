/**
 * WebRTC Client for Rein PoC
 *
 * Features:
 * 1. DataChannel (unordered) - mouse move, scroll, zoom (UDP-like)
 * 2. DataChannel (ordered)   - key, text, click, ping/pong (TCP-like)
 * 3. MediaTrack              - screen mirror (P2P video)
 * 4. Latency display         - ping/pong every 2s
 * 5. Keyboard input          - text + special keys
 * 6. Pinch to zoom           - maps to Ctrl+scroll on desktop
 */

class ReinWebRTCClient {
  constructor() {
    this.pc = null
    this.dcUnordered = null
    this.dcOrdered = null
    this.scrollMode = false
    this.mirroring = false
    this.connected = false

    // Touch tracking
    this.touches = new Map()
    this.moved = false
    this.startTime = 0

    // Pinch tracking
    this.lastPinchDist = null

    // Ping interval
    this.pingInterval = null

    this.init()
  }

  async init() {
    this.setupUI()
    await this.connect()
  }

  updateStatus(state) {
    const el = document.getElementById('status')
    const labels = { connected: 'Connected (P2P)', connecting: 'Connecting...', disconnected: 'Disconnected' }
    el.textContent = labels[state] || state
    el.className = `status ${state}`
  }

  async connect() {
    this.updateStatus('connecting')

    this.pc = new RTCPeerConnection({ iceServers: [] })

    // Unordered channel — mouse, scroll, zoom (UDP-like)
    this.dcUnordered = this.pc.createDataChannel('input-unreliable', {
      ordered: false,
      maxRetransmits: 0,
    })

    // Ordered channel — keys, text, click, ping/pong (TCP-like)
    this.dcOrdered = this.pc.createDataChannel('input-reliable', {
      ordered: true,
    })

    this.dcUnordered.onopen = () => {
      console.log('[WebRTC] Unordered channel open')
      this.checkConnection()
    }

    this.dcOrdered.onopen = () => {
      console.log('[WebRTC] Ordered channel open')
      this.checkConnection()
    }

    this.dcOrdered.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'pong') {
          const latency = Date.now() - msg.ts
          document.getElementById('latency').textContent = `${latency} ms`
        }
      } catch {}
    }

    this.dcUnordered.onclose = () => this.updateStatus('disconnected')
    this.dcOrdered.onclose = () => {
      this.updateStatus('disconnected')
      clearInterval(this.pingInterval)
    }

    this.pc.ontrack = (event) => {
      const video = document.getElementById('mirrorVideo')
      const mirror = document.getElementById('mirror')
      video.srcObject = event.streams[0]
      // Auto-show mirror and force play
      mirror.style.display = 'block'
      document.getElementById('btnMirror').textContent = 'Hide'
      document.getElementById('btnMirror').style.borderColor = '#e94560'
      this.mirroring = true
      video.play().catch(err => console.warn('[Mirror] play() failed:', err))
    }

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        fetch('/api/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'candidate', candidate: event.candidate, from: 'phone' }),
        })
      }
    }

    this.pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE:', this.pc.iceConnectionState)
      if (this.pc.iceConnectionState === 'connected') this.updateStatus('connected')
      if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
        this.updateStatus('disconnected')
        clearInterval(this.pingInterval)
      }
    }

    this.setupSSE()

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    try {
      const response = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'offer', sdp: offer.sdp }),
      })
      const answer = await response.json()
      if (answer.type === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
        console.log('[WebRTC] Remote description set')
      }
    } catch (err) {
      console.error('[WebRTC] Signaling error:', err)
      this.updateStatus('disconnected')
    }
  }

  setupSSE() {
    const evtSource = new EventSource('/api/signal/ice?role=phone')
    evtSource.onmessage = async (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'candidate' && data.candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate))
        } catch {}
      }

      if (data.type === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data))
      }

      // Desktop is renegotiating (e.g. added screen share track)
      if (data.type === 'offer' && data.from === 'desktop') {
        try {
          await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          await fetch('/api/signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'answer', sdp: answer.sdp, from: 'phone' })
          })
          console.log('[WebRTC] Renegotiation complete — screen share incoming')
        } catch (err) {
          console.warn('[WebRTC] Renegotiation error:', err)
        }
      }
    }
  }

  checkConnection() {
    if (this.dcUnordered?.readyState === 'open' && this.dcOrdered?.readyState === 'open') {
      this.connected = true
      this.updateStatus('connected')
      console.log('[WebRTC] Both channels open — fully connected!')
      // Start latency ping every 2 seconds
      this.pingInterval = setInterval(() => this.sendPing(), 2000)
    }
  }

  sendPing() {
    if (this.dcOrdered?.readyState === 'open') {
      this.dcOrdered.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
    }
  }

  sendUnordered(msg) {
    if (this.dcUnordered?.readyState === 'open') {
      this.dcUnordered.send(JSON.stringify(msg))
    }
  }

  sendOrdered(msg) {
    if (this.dcOrdered?.readyState === 'open') {
      this.dcOrdered.send(JSON.stringify(msg))
    }
  }

  setupUI() {
    const touchpad  = document.getElementById('touchpad')
    const btnLeft   = document.getElementById('btnLeft')
    const btnRight  = document.getElementById('btnRight')
    const btnScroll = document.getElementById('btnScroll')
    const btnMirror = document.getElementById('btnMirror')
    const btnSend   = document.getElementById('btnSend')
    const textInput = document.getElementById('textInput')

    // Touchpad gestures
    touchpad.addEventListener('touchstart',  (e) => this.handleTouchStart(e), { passive: false })
    touchpad.addEventListener('touchmove',   (e) => this.handleTouchMove(e),  { passive: false })
    touchpad.addEventListener('touchend',    (e) => this.handleTouchEnd(e),   { passive: false })
    touchpad.addEventListener('touchcancel', (e) => this.handleTouchEnd(e),   { passive: false })

    // Mouse buttons
    btnLeft.addEventListener('click', () => {
      this.sendOrdered({ type: 'click', button: 'left', press: true })
      setTimeout(() => this.sendOrdered({ type: 'click', button: 'left', press: false }), 50)
    })
    btnRight.addEventListener('click', () => {
      this.sendOrdered({ type: 'click', button: 'right', press: true })
      setTimeout(() => this.sendOrdered({ type: 'click', button: 'right', press: false }), 50)
    })

    btnScroll.addEventListener('click', () => {
      this.scrollMode = !this.scrollMode
      btnScroll.style.background = this.scrollMode ? '#228B22' : '#533483'
      btnScroll.textContent = this.scrollMode ? 'Scroll ON' : 'Scroll'
    })

    btnMirror.addEventListener('click', () => this.toggleMirror())

    // Text input — send on button click
    btnSend.addEventListener('click', () => {
      const text = textInput.value.trim()
      if (text) {
        this.sendOrdered({ type: 'text', text })
        textInput.value = ''
        textInput.focus()
      }
    })

    // Text input — send on Enter key
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        btnSend.click()
      }
    })

    // Special keys
    document.querySelectorAll('.special-keys button[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key
        this.sendOrdered({ type: 'key', key })
      })
    })

    // Keyboard tabs
    document.querySelectorAll('.keyboard-tabs button[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.keyboard-tabs button').forEach(t => t.classList.remove('active'))
        document.querySelectorAll('.kb-panel').forEach(p => p.classList.remove('active'))
        tab.classList.add('active')
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active')
      })
    })
  }

  handleTouchStart(e) {
    e.preventDefault()
    this.moved = false
    this.startTime = Date.now()
    this.lastPinchDist = null

    for (const touch of e.changedTouches) {
      this.touches.set(touch.identifier, { x: touch.pageX, y: touch.pageY })
    }
  }

  handleTouchMove(e) {
    e.preventDefault()
    this.moved = true

    // Pinch-to-zoom: 2 fingers, calculate distance change
    if (e.touches.length === 2) {
      const t0 = e.touches[0]
      const t1 = e.touches[1]
      const dist = Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY)

      if (this.lastPinchDist !== null) {
        const delta = (dist - this.lastPinchDist) * 0.05
        if (Math.abs(delta) > 0.01) {
          this.sendUnordered({ type: 'zoom', delta })
        }
      }
      this.lastPinchDist = dist

      // Update touch positions for both fingers
      for (const touch of e.touches) {
        this.touches.set(touch.identifier, { x: touch.pageX, y: touch.pageY })
      }
      return
    }

    // Single finger: move or scroll
    this.lastPinchDist = null
    const sensitivity = 1.5

    for (const touch of e.changedTouches) {
      const prev = this.touches.get(touch.identifier)
      if (!prev) continue

      const dx = (touch.pageX - prev.x) * sensitivity
      const dy = (touch.pageY - prev.y) * sensitivity

      if (this.scrollMode) {
        this.sendUnordered({ type: 'scroll', dx: -dx, dy: -dy })
      } else {
        this.sendUnordered({ type: 'move', dx, dy })
      }

      this.touches.set(touch.identifier, { x: touch.pageX, y: touch.pageY })
    }
  }

  handleTouchEnd(e) {
    e.preventDefault()
    for (const touch of e.changedTouches) {
      this.touches.delete(touch.identifier)
    }
    this.lastPinchDist = null

    // Tap = click (quick touch, no movement)
    if (!this.moved && Date.now() - this.startTime < 200 && e.changedTouches.length === 1) {
      this.sendOrdered({ type: 'click', button: 'left', press: true })
      setTimeout(() => this.sendOrdered({ type: 'click', button: 'left', press: false }), 50)
    }
  }

  toggleMirror() {
    const mirror = document.getElementById('mirror')
    this.mirroring = !this.mirroring
    mirror.style.display = this.mirroring ? 'block' : 'none'
    const btn = document.getElementById('btnMirror')
    btn.textContent = this.mirroring ? 'Hide' : 'Mirror'
    btn.style.borderColor = this.mirroring ? '#e94560' : '#228B22'
  }
}

window.addEventListener('load', () => new ReinWebRTCClient())
