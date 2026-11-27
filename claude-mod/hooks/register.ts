import type { Register } from 'claude-code'

const FILE = '.cache/code-notch-bar/claude-rate-limits.json'

type Window = { kind: string; percentUsed: number; resetsAt: string | null }

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN)

// Usage only grows inside a window, and a later reset means a later window, so
// an older session never beats what a newer one already wrote. A window whose
// reset has passed, or that has none recorded, is superseded by any reading.
function isNewer(next: Window, old: Window | undefined, now: number): boolean {
  if (!old) return true
  const oldReset = time(old.resetsAt)
  if (Number.isNaN(oldReset) || oldReset <= now) return true
  const nextReset = time(next.resetsAt)
  if (Number.isNaN(nextReset)) return false
  if (nextReset !== oldReset) return nextReset > oldReset
  return next.percentUsed >= old.percentUsed
}

async function parseWindows(read: Promise<unknown>): Promise<Window[]> {
  try {
    const saved = JSON.parse(String(await read))
    return Array.isArray(saved?.windows) ? saved.windows : []
  } catch {
    return []
  }
}

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      const home = await $.env.get('HOME')
      if (home) {
        const path = `${home}/${FILE}`
        const now = await $.clock.now()
        const saved = await parseWindows($.fs.read(path))
        const merged: Window[] = []
        let isChanged = false

        for (const w of e.rateLimits) {
          const incoming: Window = {
            kind: w.kind,
            percentUsed: w.percentUsed,
            resetsAt: w.resetsAt ?? null,
          }
          const old = saved.find(s => s.kind === w.kind)
          if (isNewer(incoming, old, now)) {
            merged.push(incoming)
            isChanged = true
          } else if (old) {
            merged.push(old)
          }
        }
        for (const old of saved) {
          if (!merged.some(m => m.kind === old.kind)) merged.push(old)
        }

        if (isChanged) {
          const snapshot = { fetchedAt: new Date(now).toISOString(), windows: merged }
          await $.fs.write(path, JSON.stringify(snapshot)).catch(() => {})
        }
      }
    }
    return next(e)
  })
}
