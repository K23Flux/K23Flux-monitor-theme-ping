import { useEffect, useSyncExternalStore } from "react"
import { api, ApiError } from "./api.ts"

/**
 * Latency probes, as the hub answers `/api/nodes/{id}/metrics?series=ping`:
 * bucketed rows (`latency` the bucket's median, null when nothing answered;
 * `loss` the bucket's percentage, absent when nothing was lost) and the whole
 * window's loss per probe in `loss`. Only that window figure may be shown as
 * "the" loss -- averaging the bucket percentages divides by the wrong count.
 */
export type PingRow = { task_id: number; ts: number; latency: number | null; loss?: number; band?: [number, number] }
export type PingData = {
  ping: PingRow[]
  probes: Record<string, string>
  loss?: Record<string, number>
  step?: number
}

export type Family = "v4" | "v6"

/** One block of a strip: the buckets that fell in it, or null for none. */
export type Slot = { ts: number; latency: number | null; loss: number } | null

export type ProbeStats = {
  id: number
  name: string
  /** The name without its IP-family suffix, shared by a v4 probe and its v6 twin. */
  base: string
  family: Family
  /** The newest bucket's median, null when it timed out or there is none. */
  latest: number | null
  timedOut: boolean
  /** Mean, lowest and highest of the answered buckets in the window. */
  avg: number | null
  min: number | null
  max: number | null
  /** Window loss in percent, null without samples. */
  loss: number | null
  slots: Slot[]
  hasData: boolean
}

export const WINDOWS = ["1", "3", "6", "24"] as const

const V6 = /^(.*?)[\s\-_·./]*[(（]?\s*(?:ipv6|v6)\s*[)）]?$/i
const V4 = /^(.*?)[\s\-_·./]*[(（]?\s*(?:ipv4|v4)\s*[)）]?$/i

/** "电信-IPv6" → 电信 / v6; "电信" → 电信 / v4. */
export function splitFamily(name: string): { base: string; family: Family } {
  const six = name.match(V6)
  if (six && six[1].trim()) return { base: six[1].trim(), family: "v6" }
  const four = name.match(V4)
  if (four && four[1].trim()) return { base: four[1].trim(), family: "v4" }
  return { base: name.trim(), family: "v4" }
}

/** The operator's list: names or ids, one per line or separated by commas. */
export function parseSelection(text: string): string[] {
  return text.split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
}

/** Probes in display order: the operator's list when it names any, else every probe by id. */
export function selectProbes(probes: Record<string, string>, selection: string[]): { id: number; name: string }[] {
  const all = Object.entries(probes)
    .map(([id, name]) => ({ id: Number(id), name }))
    .filter((p) => Number.isFinite(p.id))
    .sort((a, b) => a.id - b.id)
  if (!selection.length) return all
  const seen = new Set<number>()
  const out: { id: number; name: string }[] = []
  for (const token of selection) {
    for (const p of all.filter((p) => p.name === token || String(p.id) === token)) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        out.push(p)
      }
    }
  }
  return out
}

/**
 * Folds a probe's buckets into `count` blocks across the window. A block's
 * latency is the mean of its answered buckets, null when none answered; its
 * loss the mean of its buckets' loss. That mean is exact at the short windows,
 * where a bucket is a single probe, and only colours a block, never a figure.
 */
export function buildSlots(rows: PingRow[], since: number, until: number, count: number): Slot[] {
  const sums = Array.from({ length: count }, () => ({ ts: 0, n: 0, answered: 0, latency: 0, loss: 0 }))
  const width = Math.max(1, until - since) / count
  for (const row of rows) {
    if (row.ts < since || row.ts > until) continue
    const s = sums[Math.min(count - 1, Math.floor((row.ts - since) / width))]
    s.ts = Math.max(s.ts, row.ts)
    s.n++
    s.loss += row.latency === null ? 100 : (row.loss ?? 0)
    if (row.latency !== null) {
      s.answered++
      s.latency += row.latency
    }
  }
  return sums.map((s) => (s.n ? { ts: s.ts, latency: s.answered ? s.latency / s.answered : null, loss: s.loss / s.n } : null))
}

export function probeStats(
  data: PingData, probe: { id: number; name: string }, since: number, until: number, slots: number,
): ProbeStats {
  const rows = data.ping.filter((r) => r.task_id === probe.id).sort((a, b) => a.ts - b.ts)
  const answered = rows.flatMap((r) => (r.latency === null ? [] : [r.latency]))
  const last = rows.at(-1)
  return {
    ...probe,
    ...splitFamily(probe.name),
    latest: last?.latency ?? null,
    timedOut: Boolean(last && last.latency === null),
    avg: answered.length ? answered.reduce((a, b) => a + b, 0) / answered.length : null,
    min: answered.length ? Math.min(...answered) : null,
    max: answered.length ? Math.max(...answered) : null,
    loss: rows.length ? (data.loss?.[probe.id] ?? 0) : null,
    slots: buildSlots(rows, since, until, slots),
    hasData: rows.length > 0,
  }
}

/**
 * The homepage rows: what the operator listed, or, with nothing listed, every
 * IPv4 probe -- a card has room for one family, and the v6 twins are on the
 * node's page.
 */
export function cardProbes(data: PingData, selection: string[], hours: number, now = Date.now() / 1000): ProbeStats[] {
  const chosen = selectProbes(data.probes ?? {}, selection)
  const shown = selection.length ? chosen : chosen.filter((p) => splitFamily(p.name).family === "v4")
  return shown.map((p) => probeStats(data, p, now - hours * 3600, now, 20))
}

/** Every probe, each IPv6 one right after its IPv4 twin. */
export function pairOrder<T extends { name: string }>(probes: T[]): T[] {
  const bases: string[] = []
  for (const p of probes) {
    const { base } = splitFamily(p.name)
    if (!bases.includes(base)) bases.push(base)
  }
  const rank = (p: T) => {
    const { base, family } = splitFamily(p.name)
    return bases.indexOf(base) * 2 + (family === "v6" ? 1 : 0)
  }
  return [...probes].sort((a, b) => rank(a) - rank(b))
}

/**
 * Glassmorphism's five steps: 1 is the best, 5 the worst, 0 no data. From
 * Jiangsu, 60 ms is Japan or Hong Kong, 200 ms the US West Coast.
 */
const STEPS = { latency: [60, 100, 160, 200], loss: [1, 3, 6, 9] }

export function signal(value: number | null, metric: "latency" | "loss"): number {
  if (value === null) return 0
  const i = STEPS[metric].findIndex((t) => value <= t)
  return i < 0 ? 5 : i + 1
}

/** A figure's ink: the step's colour, pulled toward the text so it stays readable. */
export const signalText = (step: number) =>
  step ? `color-mix(in oklab, var(--signal-${step}) 65%, var(--foreground))` : "var(--muted-foreground)"

export const fmtMs = (ms: number) => (ms < 10 ? ms.toFixed(1) : Math.round(ms).toString())
export const fmtLoss = (pct: number) => (pct === 0 ? "0" : pct < 0.1 ? "<0.1" : pct < 10 ? pct.toFixed(1) : Math.round(pct).toString())

// ---- fetching ----------------------------------------------------------------

type Entry = { data: PingData | null; error: string; at: number }

const cache = new Map<string, Entry>()
const inflight = new Set<string>()
const listeners = new Map<string, Set<() => void>>()

/**
 * The hub refuses a fifth concurrent history query with 503 rather than
 * queueing it, and every card on the page asks at once, so the cards queue
 * here instead: two at a time.
 */
const CONCURRENCY = 2
const queue: (() => Promise<void>)[] = []
let running = 0
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!
    running++
    void job().finally(() => {
      running--
      pump()
    })
  }
}

function publish(key: string, entry: Entry) {
  cache.set(key, entry)
  listeners.get(key)?.forEach((fn) => fn())
}

export function fetchPing(id: number, hours: number, attempt = 0) {
  const key = `${id}:${hours}`
  if (inflight.has(key) && attempt === 0) return
  inflight.add(key)
  queue.push(async () => {
    try {
      const data = await api<PingData>(`/nodes/${id}/metrics?series=ping&hours=${hours}&points=60`)
      inflight.delete(key)
      publish(key, { data, error: "", at: Date.now() })
    } catch (e) {
      // Busy: the hub's history gate was full. Try again shortly, a few times.
      if (e instanceof ApiError && e.status === 503 && attempt < 3) {
        setTimeout(() => fetchPing(id, hours, attempt + 1), 2000 * (attempt + 1))
        return
      }
      inflight.delete(key)
      const prev = cache.get(key)
      // `at` set so the next try comes in about 15 s rather than a minute.
      publish(key, { data: prev?.data ?? null, error: e instanceof Error ? e.message : "读取失败", at: Date.now() - 45_000 })
    }
  })
  pump()
}

const FRESH = 60_000

export function useNodePing(id: number, hours: number, enabled: boolean): Entry | undefined {
  const key = `${id}:${hours}`
  const entry = useSyncExternalStore(
    (notify) => {
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(notify)
      return () => set.delete(notify)
    },
    () => cache.get(key),
  )
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (document.hidden) return
      const e = cache.get(key)
      if (!e || Date.now() - e.at >= FRESH) fetchPing(id, hours)
    }
    tick()
    const timer = setInterval(tick, 10_000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [id, hours, key, enabled])
  return entry
}
