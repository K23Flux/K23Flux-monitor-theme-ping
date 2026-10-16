import { useMemo } from "react"

import type { Node } from "@/lib/api"
import {
  cardProbes, fmtLoss, fmtMs, latencySignal, lossSignal, parseSelection, signalText, useNodePing,
  type ProbeStats, type Slot,
} from "@/lib/ping"
import { cn } from "@/lib/utils"

export type PingOptions = { tasks: string; hours: number }

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })

function blockTitle(slot: Slot, metric: "latency" | "loss") {
  if (!slot) return "无采样"
  if (metric === "loss") return `${clock(slot.ts)} · 丢包 ${fmtLoss(slot.loss)}%`
  return `${clock(slot.ts)} · ${slot.latency === null ? "超时" : `${fmtMs(slot.latency)} ms`}`
}

/** A row of blocks, one per slot of the window, coloured by its step. */
export function Blocks({ slots, metric, typical, className }: {
  slots: Slot[]; metric: "latency" | "loss"; typical: number | null; className?: string
}) {
  return (
    <div
      className={cn("grid gap-[2px]", className)}
      style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {slots.map((slot, i) => {
        // A block where nothing answered is the worst latency there is.
        const step = !slot ? 0 : metric === "loss" ? lossSignal(slot.loss) : slot.latency === null ? 5 : latencySignal(slot.latency, typical)
        return (
          <span
            key={i}
            title={blockTitle(slot, metric)}
            className="rounded-[2px]"
            style={{ background: step ? `var(--signal-${step})` : "var(--muted)" }}
          />
        )
      })}
    </div>
  )
}

export function LatencyValue({ probe, className }: { probe: ProbeStats; className?: string }) {
  const step = probe.timedOut ? 5 : latencySignal(probe.latest, probe.typical)
  return (
    <strong className={cn("tnum font-medium", className)} style={{ color: signalText(step) }}>
      {probe.latest !== null ? fmtMs(probe.latest) : probe.timedOut ? "超时" : "—"}
      {probe.latest !== null && <small className="ml-0.5 text-[10px] font-normal text-muted-foreground">ms</small>}
    </strong>
  )
}

export function LossValue({ probe, className }: { probe: ProbeStats; className?: string }) {
  return (
    <strong className={cn("tnum font-medium", className)} style={{ color: signalText(lossSignal(probe.loss)) }}>
      {probe.loss === null ? "—" : fmtLoss(probe.loss)}
      {probe.loss !== null && <small className="ml-0.5 text-[10px] font-normal text-muted-foreground">%</small>}
    </strong>
  )
}

/**
 * The bottom of a node card, after Glassmorphism's: per probe, the newest
 * latency over a strip of the window, and the window's loss over its own.
 * IPv4 only unless the operator lists probes; the rest is on the node's page.
 */
export function PingPanel({ node, options }: { node: Node; options: PingOptions }) {
  const { hours } = options
  const entry = useNodePing(node.id, hours, true)
  const data = entry?.data
  const probes = useMemo(
    () => (data ? cardProbes(data, parseSelection(options.tasks), hours) : []),
    [data, options.tasks, hours],
  )

  if (!data) {
    return (
      <p className="mt-4 border-t pt-4 text-[11px] text-muted-foreground">
        {entry?.error ? `延迟读取失败：${entry.error}` : "正在读取延迟…"}
      </p>
    )
  }
  if (!probes.length) return null

  return (
    <div className="mt-4 space-y-2.5 border-t pt-4 text-[11px] leading-tight">
      {probes.map((p) => (
        <div key={p.id} className="grid grid-cols-2 gap-3.5" title={p.name}>
          <div className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-1.5">
              <span className="truncate text-muted-foreground">{p.name}</span>
              <LatencyValue probe={p} className="text-xs" />
            </div>
            <Blocks slots={p.slots} metric="latency" typical={p.typical} className="h-[9px]" />
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-1.5">
              <span className="text-muted-foreground" title={`近 ${hours} 小时丢包率`}>丢包</span>
              <LossValue probe={p} className="text-xs" />
            </div>
            <Blocks slots={p.slots} metric="loss" typical={null} className="h-[9px]" />
          </div>
        </div>
      ))}
    </div>
  )
}
