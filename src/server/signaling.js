/**
 * WebRTC Signaling Server
 *
 * Replaces WebSocket-based communication with HTTP-based signaling:
 * - POST /api/signal      → Exchange SDP offer/answer
 * - GET  /api/signal/ice  → SSE stream for ICE candidates
 * - POST /api/signal/ice  → Send ICE candidate
 *
 * This is only used for initial connection setup.
 * Once WebRTC is established, all data flows P2P.
 */

// Store pending offers/answers and ICE candidates
let pendingOffer = null
let pendingAnswer = null
const iceCandidates = { desktop: [], phone: [] }

export function createSignalingServer(app, sseClients) {
  // Phone sends SDP offer, gets back SDP answer
  app.post("/api/signal", (req, res) => {
    const { type, sdp, candidate, from } = req.body

    if (type === "offer") {
      // Phone sends offer
      pendingOffer = { type, sdp }
      console.log("[Signal] Received SDP offer from phone")

      // If desktop already connected via SSE, forward the offer
      const desktopClient = sseClients.get("desktop")
      if (desktopClient) {
        desktopClient.write(`data: ${JSON.stringify({ type: "offer", sdp })}\n\n`)
      }

      // Wait briefly for answer
      const waitForAnswer = () => {
        return new Promise((resolve) => {
          let attempts = 0
          const check = setInterval(() => {
            attempts++
            if (pendingAnswer) {
              clearInterval(check)
              const answer = pendingAnswer
              pendingAnswer = null
              resolve(answer)
            } else if (attempts > 50) {
              // 5 second timeout
              clearInterval(check)
              resolve(null)
            }
          }, 100)
        })
      }

      waitForAnswer().then((answer) => {
        if (answer) {
          res.json(answer)
        } else {
          res.status(408).json({ error: "Timeout waiting for answer" })
        }
      })
      return
    }

    if (type === "answer") {
      // Desktop sends answer
      pendingAnswer = { type, sdp }
      console.log("[Signal] Received SDP answer from desktop")
      res.json({ ok: true })
      return
    }

    if (type === "candidate") {
      // ICE candidate from either side
      console.log(`[Signal] ICE candidate from ${from}`)
      const target = from === "desktop" ? "phone" : "desktop"

      // Forward to target via SSE
      const targetClient = sseClients.get(target)
      if (targetClient) {
        targetClient.write(
          `data: ${JSON.stringify({ type: "candidate", candidate })}\n\n`
        )
      }

      // Also store for late joiners
      iceCandidates[from] = iceCandidates[from] || []
      iceCandidates[from].push(candidate)

      res.json({ ok: true })
      return
    }

    res.status(400).json({ error: "Unknown signal type" })
  })

  // SSE endpoint for receiving signaling events
  app.get("/api/signal/ice", (req, res) => {
    const role = req.query.role // "desktop" or "phone"

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()

    console.log(`[Signal] SSE client connected: ${role}`)
    sseClients.set(role, res)

    // Send any pending ICE candidates for this role
    const target = role === "desktop" ? "phone" : "desktop"
    if (iceCandidates[target]) {
      for (const candidate of iceCandidates[target]) {
        res.write(
          `data: ${JSON.stringify({ type: "candidate", candidate })}\n\n`
        )
      }
    }

    // If desktop connects and there's a pending offer, send it
    if (role === "desktop" && pendingOffer) {
      res.write(`data: ${JSON.stringify(pendingOffer)}\n\n`)
    }

    req.on("close", () => {
      console.log(`[Signal] SSE client disconnected: ${role}`)
      sseClients.delete(role)
    })
  })
}
