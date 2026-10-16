import { useMemo } from "react"

import { Blocks, LatencyValue, LossValue } from "@/components/PingPanel"
import { fmtMs, pairOrder, probeStats, type PingData, type PingRow } from "@/lib/ping"
import { cn } from "@/lib/utils"

type Series = { id: number; name: string; points: PingRow[]; loss: number }

const SLOTS = 40

const Muted = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] text-muted-foreground">{children}</span>
)

/**
 * The node page's line list, one probe per row with each IPv6 twin right under
 * its IPv4 one: newest latency, the window's mean and spread, the window's loss,
 * and the window as two block strips, latency over loss. Each row is also the
 * chart's legend: its swatch is the line, and pressing it hides the line.
 */
export function PingTable({ series, hours, styleOf, hidden, onToggle }: {
  series: Series[]
  hours: number
  styleOf: (id: number) => { stroke: string; dash?: string }
  hidden: number[]
  onToggle: (id: number) => void
}) {
  const rows = useMemo(() => {
    const until = Date.now() / 1000
    const since = until - hours * 3600
    const data: PingData = {
      ping: series.flatMap((s) => s.points),
      probes: Object.fromEntries(series.map((s) => [s.id, s.name])),
      loss: Object.fromEntries(series.map((s) => [s.id, s.loss])),
    }
    return pairOrder(series).map((s) => probeStats(data, s, since, until, SLOTS))
  }, [series, hours])

  const window = hours >= 24 ? `${Math.round(hours / 24)} 天` : `${hours} 小时`

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="hidden grid-cols-[minmax(9rem,1.1fr)_4.5rem_4.5rem_6.5rem_4rem_minmax(10rem,2fr)] items-center gap-x-4 border-b bg-muted/40 px-4 py-2 sm:grid">
        <Muted>线路</Muted>
        <Muted>最新</Muted>
        <Muted>平均</Muted>
        <Muted>波动</Muted>
        <Muted>丢包</Muted>
        <div className="flex justify-between">
          <Muted>近 {window} · 延迟 / 丢包</Muted>
          <Muted>现在</Muted>
        </div>
      </div>
      <ul className="divide-y">
        {rows.map((p) => {
          const off = hidden.includes(p.id)
          const { stroke, dash } = styleOf(p.id)
          return (
            <li key={p.id}>
              <button
                aria-pressed={!off}
                title={off ? "在图中显示" : "在图中隐藏"}
                onClick={() => onToggle(p.id)}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-[opacity,background-color] hover:bg-muted/50",
                  "sm:grid-cols-[minmax(9rem,1.1fr)_4.5rem_4.5rem_6.5rem_4rem_minmax(10rem,2fr)]",
                  off && "opacity-45",
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <svg width="16" height="8" className="shrink-0" aria-hidden>
                    <line x1="0" y1="4" x2="16" y2="4" stroke={stroke} strokeDasharray={dash} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <span className="truncate text-sm font-medium">{p.base}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide",
                      p.family === "v6" ? "bg-foreground text-background" : "border text-muted-foreground",
                    )}
                  >
                    {p.family === "v6" ? "IPv6" : "IPv4"}
                  </span>
                </span>

                <span className="text-right sm:text-left">
                  <Muted><span className="mr-1 sm:hidden">延迟</span></Muted>
                  <LatencyValue probe={p} className="text-sm" />
                </span>
                <span className="hidden text-sm tnum sm:block">
                  {p.avg === null ? "—" : fmtMs(p.avg)}
                  {p.avg !== null && <small className="ml-0.5 text-[10px] text-muted-foreground">ms</small>}
                </span>
                <span className="hidden text-sm tnum text-muted-foreground sm:block">
                  {p.min === null || p.max === null ? "—" : `${fmtMs(p.min)}–${fmtMs(p.max)}`}
                </span>
                <span className="text-right sm:order-none sm:text-left">
                  <Muted><span className="mr-1 sm:hidden">丢包</span></Muted>
                  <LossValue probe={p} className="text-sm" />
                </span>

                <span className="col-span-full grid gap-[3px] sm:col-span-1">
                  <Blocks slots={p.slots} metric="latency" className="h-2.5" />
                  <Blocks slots={p.slots} metric="loss" className="h-1.5 opacity-80" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
