import { ArrowDown, ArrowUp } from "lucide-react"

import { Card } from "@/components/ui/card"
import { speedHistory, type Node } from "@/lib/api"
import { bytes, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * A bare polyline with no axes or tooltips: at this size only the shape is
 * legible, and recharts would bring a full chart's machinery for it. Series share
 * one scale so the two throughput lines remain comparable.
 */
function Spark({ series }: { series: { values: number[]; className: string }[] }) {
  const top = Math.max(...series.flatMap((s) => s.values), 1)
  const width = Math.max(...series.map((s) => s.values.length), 2) - 1
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      {series.map((s, i) => (
        <polyline
          key={i}
          className={s.className}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          points={s.values.map((v, x) => `${(x / width) * 100},${23 - (v / top) * 22}`).join(" ")}
        />
      ))}
    </svg>
  )
}

/** A labelled pair of figures, one segment of the bar. */
function Segment({ label, down, up, className }: { label: string; down: string; up: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1">
        <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
        {down}
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
        {up}
      </span>
    </div>
  )
}

/**
 * One slim bar rather than three tiles: how many are up, today's traffic, the
 * throughput now with its recent shape. Wraps to two lines on a phone.
 * `group` picks the throughput series: null for every node, else the tab's group.
 */
export function Summary({ nodes, group }: { nodes: Node[]; group: string | null }) {
  const online = nodes.filter((n) => n.online)
  const offline = nodes.length - online.length
  const sum = (pick: (n: Node) => number) => nodes.reduce((total, n) => total + pick(n), 0)

  // The same push produced `nodes` and this sample, so the figure is that
  // line's last point.
  const history = speedHistory.get(group) ?? []
  const now = history.at(-1) ?? { rx: 0, tx: 0 }

  // Four cells on the same grid as the cards below (same gap, same 16px inset),
  // so on a wide screen each figure starts where a card's content starts and
  // the sparkline fills the last column. A phone keeps one wrapping row.
  return (
    <Card className="tnum flex flex-row flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid sm:grid-cols-2 sm:gap-x-3 sm:px-0 lg:grid-cols-4">
      <div className="flex items-center gap-2 sm:px-4">
        <span className={cn("size-2 rounded-full", offline ? "bg-offline" : "bg-online")} />
        <span className="font-medium">{online.length} / {nodes.length}</span>
        <span className="text-xs text-muted-foreground">{offline ? `${offline} 个离线` : "在线"}</span>
      </div>
      <Segment label="今日" down={bytes(sum((n) => n.day_rx))} up={bytes(sum((n) => n.day_tx))} className="sm:px-4" />
      <Segment label="实时" down={rate(now.rx)} up={rate(now.tx)} className="sm:px-4" />
      <div className="min-w-0 flex-1 basis-24 sm:px-4">
        <Spark
          series={[
            { values: history.map((s) => s.rx), className: "text-foreground" },
            { values: history.map((s) => s.tx), className: "text-muted-foreground" },
          ]}
        />
      </div>
    </Card>
  )
}
