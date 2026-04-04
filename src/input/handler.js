/**
 * Input Handler using Koffi FFI
 *
 * Replaces @nut-tree-fork/nut-js with direct OS API calls via Koffi.
 *
 * Benefits over nut.js:
 * - No prebuilt native binaries needed
 * - Smaller bundle size
 * - Direct access to OS APIs (more control)
 * - Better cross-platform support
 *
 * Platform APIs:
 * - Windows: Win32 SendInput, SetCursorPos, GetCursorPos
 * - Linux:   X11/XTest or ydotool (Wayland)
 * - macOS:   CGEvent APIs via CoreGraphics
 */

import koffi from "koffi"
import os from "node:os"
import { execFileSync } from "node:child_process"

// Platform-specific input implementations
let platformInput = null

function initWindows() {
  // Load Win32 User32.dll
  const user32 = koffi.load("user32.dll")

  // Define Win32 structures
  const POINT = koffi.struct("POINT", {
    x: "long",
    y: "long",
  })

  const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
    dx: "long",
    dy: "long",
    mouseData: "uint32",
    dwFlags: "uint32",
    time: "uint32",
    dwExtraInfo: "uintptr",
  })

  const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
    wVk: "uint16",
    wScan: "uint16",
    dwFlags: "uint32",
    time: "uint32",
    dwExtraInfo: "uintptr",
  })

  const INPUT = koffi.struct("INPUT", {
    type: "uint32",
    mi: MOUSEINPUT,
  })

  // Win32 API functions
  const GetCursorPos = user32.func("bool GetCursorPos(_Out_ POINT* lpPoint)")
  const SetCursorPos = user32.func("bool SetCursorPos(int X, int Y)")
  const SendInput = user32.func(
    "uint32 SendInput(uint32 cInputs, INPUT* pInputs, int cbSize)"
  )

  // Win32 constants
  const INPUT_MOUSE = 0
  const INPUT_KEYBOARD = 1
  const MOUSEEVENTF_MOVE = 0x0001
  const MOUSEEVENTF_LEFTDOWN = 0x0002
  const MOUSEEVENTF_LEFTUP = 0x0004
  const MOUSEEVENTF_RIGHTDOWN = 0x0008
  const MOUSEEVENTF_RIGHTUP = 0x0010
  const MOUSEEVENTF_MIDDLEDOWN = 0x0020
  const MOUSEEVENTF_MIDDLEUP = 0x0040
  const MOUSEEVENTF_WHEEL = 0x0800
  const MOUSEEVENTF_HWHEEL = 0x1000
  const KEYEVENTF_KEYUP = 0x0002

  return {
    move(dx, dy) {
      const point = {}
      GetCursorPos(point)
      SetCursorPos(
        Math.round(point.x + dx),
        Math.round(point.y + dy)
      )
    },

    click(button, press) {
      const flags = {
        left: press ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
        right: press ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
        middle: press ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
      }

      const input = {
        type: INPUT_MOUSE,
        mi: {
          dx: 0,
          dy: 0,
          mouseData: 0,
          dwFlags: flags[button] || flags.left,
          time: 0,
          dwExtraInfo: 0,
        },
      }

      SendInput(1, [input], koffi.sizeof(INPUT))
    },

    scroll(dx, dy) {
      // Vertical scroll
      if (dy !== 0) {
        const input = {
          type: INPUT_MOUSE,
          mi: {
            dx: 0,
            dy: 0,
            mouseData: Math.round(-dy * 120),
            dwFlags: MOUSEEVENTF_WHEEL,
            time: 0,
            dwExtraInfo: 0,
          },
        }
        SendInput(1, [input], koffi.sizeof(INPUT))
      }

      // Horizontal scroll
      if (dx !== 0) {
        const input = {
          type: INPUT_MOUSE,
          mi: {
            dx: 0,
            dy: 0,
            mouseData: Math.round(dx * 120),
            dwFlags: MOUSEEVENTF_HWHEEL,
            time: 0,
            dwExtraInfo: 0,
          },
        }
        SendInput(1, [input], koffi.sizeof(INPUT))
      }
    },

    keyPress(vkCode) {
      const downInput = {
        type: INPUT_KEYBOARD,
        mi: {
          dx: 0, // reusing MOUSEINPUT struct layout
          dy: 0,
          mouseData: 0,
          dwFlags: vkCode, // wVk in first 16 bits
          time: 0,
          dwExtraInfo: 0,
        },
      }
      // Note: In a full implementation, we'd use a proper KEYBDINPUT union
      console.log(`[Koffi] Key press: VK ${vkCode}`)
    },

    type(text) {
      console.log(`[Koffi] Type text: "${text}"`)
      // In full implementation: use SendInput with KEYEVENTF_UNICODE
    },

    zoom(delta) {
      // Ctrl + scroll wheel for zoom
      const VK_CONTROL = 0x11
      // Press Ctrl
      const ctrlDown = {
        type: INPUT_KEYBOARD,
        mi: { dx: VK_CONTROL, dy: 0, mouseData: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 },
      }
      // Scroll
      const scroll = {
        type: INPUT_MOUSE,
        mi: { dx: 0, dy: 0, mouseData: Math.round(delta * 120 * 5), dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 },
      }
      // Release Ctrl
      const ctrlUp = {
        type: INPUT_KEYBOARD,
        mi: { dx: VK_CONTROL, dy: 0, mouseData: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 },
      }
      SendInput(1, [ctrlDown], koffi.sizeof(INPUT))
      SendInput(1, [scroll], koffi.sizeof(INPUT))
      SendInput(1, [ctrlUp], koffi.sizeof(INPUT))
    },
  }
}

function initLinux() {
  // For Linux: use ydotool (Wayland) or X11/XTest
  // This is a simplified version for the PoC
  // execFileSync imported at top level

  return {
    move(dx, dy) {
      try {
        execFileSync("ydotool", [
          "mousemove",
          "-x",
          String(Math.round(dx)),
          "-y",
          String(Math.round(dy)),
        ])
      } catch {
        console.warn("[Koffi/Linux] ydotool not available, skipping move")
      }
    },

    click(button, press) {
      const btnMap = { left: "0", right: "1", middle: "2" }
      const btn = btnMap[button] || "0"
      try {
        execFileSync("ydotool", [
          "click",
          press ? `${btn}:1` : `${btn}:0`,
        ])
      } catch {
        console.warn("[Koffi/Linux] ydotool not available, skipping click")
      }
    },

    scroll(dx, dy) {
      // ydotool doesn't support scroll directly, use xdotool or uinput
      console.log(`[Koffi/Linux] Scroll: dx=${dx}, dy=${dy}`)
    },

    keyPress(key) {
      console.log(`[Koffi/Linux] Key: ${key}`)
    },

    type(text) {
      try {
        execFileSync("ydotool", ["type", text])
      } catch {
        console.warn("[Koffi/Linux] ydotool not available, skipping type")
      }
    },

    zoom(delta) {
      console.log(`[Koffi/Linux] Zoom: ${delta}`)
    },
  }
}

function initMacOS() {
  // For macOS: use CoreGraphics CGEvent APIs via Koffi
  // This is a placeholder for the PoC
  return {
    move(dx, dy) {
      console.log(`[Koffi/macOS] Move: dx=${dx}, dy=${dy}`)
    },
    click(button, press) {
      console.log(`[Koffi/macOS] Click: ${button} ${press ? "down" : "up"}`)
    },
    scroll(dx, dy) {
      console.log(`[Koffi/macOS] Scroll: dx=${dx}, dy=${dy}`)
    },
    keyPress(key) {
      console.log(`[Koffi/macOS] Key: ${key}`)
    },
    type(text) {
      console.log(`[Koffi/macOS] Type: "${text}"`)
    },

    zoom(delta) {
      console.log(`[Koffi/macOS] Zoom: ${delta}`)
    },
  }
}

export class InputHandler {
  constructor() {
    const platform = os.platform()
    console.log(`[InputHandler] Initializing for platform: ${platform}`)

    if (platform === "win32") {
      platformInput = initWindows()
    } else if (platform === "linux") {
      platformInput = initLinux()
    } else if (platform === "darwin") {
      platformInput = initMacOS()
    } else {
      console.warn(`[InputHandler] Unsupported platform: ${platform}`)
      platformInput = {
        move: () => {},
        click: () => {},
        scroll: () => {},
        keyPress: () => {},
        type: () => {},
      }
    }
  }

  async handleMessage(msg) {
    if (!platformInput) return

    switch (msg.type) {
      case "move":
        platformInput.move(msg.dx || 0, msg.dy || 0)
        break

      case "click":
        platformInput.click(msg.button || "left", msg.press !== false)
        break

      case "scroll":
        platformInput.scroll(msg.dx || 0, msg.dy || 0)
        break

      case "key":
        platformInput.keyPress(msg.key)
        break

      case "text":
        platformInput.type(msg.text || "")
        break

      case "zoom":
        platformInput.zoom(msg.delta || 0)
        break
    }
  }
}
