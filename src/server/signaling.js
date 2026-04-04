/**
 * WebRTC Signaling Server
 *
 * Bidirectional: phone OR desktop can be the offerer (needed for renegotiation).
 * - POST /api/signal      → Exchange SDP offer/answer (with from: "phone"|"desktop")
 * - GET  /api/signal/ice  → SSE stream for ICE candidates
 */

let pendingOffer = null
let pendingAnswer = null
const iceCandidates = { desktop: [], phone: [] }

export function createSignalingServer(app, sseClients) {

  app.post("/api/signal", (req, res) => {
    const { type, sdp, candidate, from } = req.body

    // ── OFFER ──────────────────────────────────────────────────
    if (type === "offer") {
      const target = from === "desktop" ? "phone" : "desktop"
      console.log(`[Signal] SDP offer from ${from || "phone"} → forwarding to ${target}`)

      // Forward to the other side via SSE
      const targetClient = sseClients.get(target)
      if (targetClient) {
        targetClient.write(`data: ${JSON.stringify({ type: "offer", sdp, from: from || "phone" })}\n\n`)
      }

      if (from === "desktop") {
        // Desktop sent offer for renegotiation — wait for phone's answer via SSE
        // Desktop will receive the answer through its own SSE stream
        res.json({ ok: true })
        return
      }

      // Phone sent initial offer — wait for desktop answer (polling)
      pendingOffer = { type, sdp }
      const waitForAnswer = () => new Promise((resolve) => {
        let attempts = 0
        const check = setInterval(() => {
          attempts++
          if (pendingAnswer) {
            clearInterval(check)
            const answer = pendingAnswer
            pendingAnswer = null
            resolve(answer)
          } else if (attempts > 100) {
            clearInterval(check)
            resolve(null)
          }
        }, 100)
      })

      waitForAnswer().then((answer) => {
        if (answer) res.json(answer)
        else res.status(408).json({ error: "Timeout waiting for answer" })
      })
      return
    }

    // ── ANSWER ─────────────────────────────────────────────────
    if (type === "answer") {
      if (from === "phone") {
        // Phone is answering a renegotiation offer from desktop → forward to desktop SSE
        console.log("[Signal] SDP answer from phone (renegotiation) → desktop")
        const desktopClient = sseClients.get("desktop")
        if (desktopClient) {
          desktopClient.write(`data: ${JSON.stringify({ type: "answer", sdp, from: "phone" })}\n\n`)
        }
        res.json({ ok: true })
        return
      }

      // Desktop answering initial phone offer
      console.log("[Signal] SDP answer from desktop")
      pendingAnswer = { type, sdp }
      res.json({ ok: true })
      return
    }

    // ── ICE CANDIDATE ──────────────────────────────────────────
    if (type === "candidate") {
      const sender = from || "phone"
      const target = sender === "desktop" ? "phone" : "desktop"
      console.log(`[Signal] ICE from ${sender} → ${target}`)

      const targetClient = sseClients.get(target)
      if (targetClient) {
        targetClient.write(`data: ${JSON.stringify({ type: "candidate", candidate })}\n\n`)
      }

      iceCandidates[sender] = iceCandidates[sender] || []
      iceCandidates[sender].push(candidate)
      res.json({ ok: true })
      return
    }

    res.status(400).json({ error: "Unknown signal type" })
  })

  // SSE endpoint
  app.get("/api/signal/ice", (req, res) => {
    const role = req.query.role

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()

    console.log(`[Signal] SSE connected: ${role}`)
    sseClients.set(role, res)

    // Send buffered ICE candidates from the other side
    const other = role === "desktop" ? "phone" : "desktop"
    for (const candidate of (iceCandidates[other] || [])) {
      res.write(`data: ${JSON.stringify({ type: "candidate", candidate })}\n\n`)
    }

    // If desktop connects late and offer is waiting, send it
    if (role === "desktop" && pendingOffer) {
      res.write(`data: ${JSON.stringify(pendingOffer)}\n\n`)
    }

    req.on("close", () => {
      console.log(`[Signal] SSE disconnected: ${role}`)
      sseClients.delete(role)
    })
  })
}
