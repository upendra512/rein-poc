import express from "express"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import QRCode from "qrcode"
import { createSignalingServer } from "./signaling.js"
import { InputHandler } from "../input/handler.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = 3000

app.use(express.json())
app.use(express.static(join(__dirname, "../../public")))

// Desktop opens /desktop, phone opens / (root)
app.get("/desktop", (req, res) => {
  res.sendFile(join(__dirname, "../../public/desktop.html"))
})

// Input handler using Koffi (replaces nut.js)
const inputHandler = new InputHandler()

// SSE clients for ICE candidates
const sseClients = new Map()

// Signaling endpoints (replaces WebSocket upgrade)
createSignalingServer(app, sseClients)

// Input endpoint - receives events forwarded from WebRTC DataChannel bridge
app.post("/api/input", async (req, res) => {
  try {
    await inputHandler.handleMessage(req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error("Input error:", err)
    res.status(500).json({ error: String(err) })
  }
})

// IP detection (same as current Rein)
app.get("/api/ip", async (req, res) => {
  const ip = await getLocalIp()
  res.json({ ip })
})

// QR code endpoint - generates QR for phone URL
app.get("/api/qr", async (req, res) => {
  const ip = await getLocalIp()
  const url = `http://${ip}:${PORT}`
  const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 2 })
  res.json({ dataUrl, url })
})

async function getLocalIp() {
  const { createSocket } = await import("node:dgram")
  // Same trick as Rein: connect UDP socket to get LAN IP
  return new Promise((resolve) => {
    const sock = createSocket("udp4")
    sock.connect(1, "1.1.1.1", () => {
      const addr = sock.address()
      sock.close()
      resolve(addr.address)
    })
  })
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Rein PoC Server running!`)
  console.log(`  Local:   http://localhost:${PORT}`)
  console.log(`  Network: http://0.0.0.0:${PORT}`)
  console.log(`\n  Architecture: WebRTC + Koffi (replacing WebSocket + Nut.js)\n`)
})
