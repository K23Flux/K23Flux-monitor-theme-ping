import { useEffect, useMemo, useState } from "react"
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type DotItemDotProps,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Country, Status } from "@/components/NodeCard"
import { ProbeRedesign } from "@/components/ProbeRedesign"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, cycle, quarters, cpuName, FOREVER, money, osName, rate, RATE_FLOOR,
  rateAxis, tickClock, timeTicks, windows, withGaps,
} from "@/lib/format"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  // The highest rate the agent measured over one report interval within the
  // bucket, never below its mean. Absent from hubs predating it.
  net_rx_max?: number
  net_tx_max?: number
}
const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }

// A resource chart's series. A row with a gap on either side has no neighbour to
// draw a line to, so it is marked with a dot; without one, a node back for a
// single bucket after a stretch offline would not show at all.
const RESOURCE_SERIES = {
  ...SERIES,
  dot: ({ cx, cy, index, points, stroke }: DotItemDotProps) =>
    cy == null || points[index - 1]?.y != null || points[index + 1]?.y != null ? null : (
      <circle cx={cx} cy={cy} r={2} fill={stroke} />
    ),
}

// Nor does the tooltip slide. Entering a chart at its right edge, it appears
// beside the cursor first and would glide 400 ms back within the chart,
// overhanging the page by up to 140 px and flashing a horizontal scrollbar.
const TOOLTIP = {
  isAnimationActive: false,
  labelFormatter: (ts: unknown) => new Date(Number(ts)).toLocaleString("zh-CN"),
  contentStyle: { fontSize: 12 },
}

// One width for every stacked panel's value axis. Sized to their own labels --
// 40px under "100%", 68px under "172 MB" -- the four plot areas would be offset by
// 28px, placing a CPU spike and the network spike that caused it at different x.
//
// Every listed tick is drawn: the lists are spaced to fit, while recharts' own
// collision pass would nudge the top label 5 px inward, drop the tick beneath it,
// and thin the gridlines separately -- the CPU axis would lose its 30% gridline,
// and a rate axis of 1 KB/s to 100 MB/s its 10 MB/s label and two gridlines.
// Room above the plot: the top tick label is centred on the top gridline and
// would otherwise lose its upper half to the panel edge.
const CHART_MARGIN = { top: 10, right: 4, bottom: 0, left: 0 }
const VALUE_AXIS = { ...AXIS, width: 80, interval: 0 }

// The two directions of the network chart. Told apart by hue, not by shade: in
// the dark theme white and light grey are hard to separate.
const RX = "#3b82f6"
const TX = "#f59e0b"

function Swatch({ color, dash, width = 18 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg width={width} height="8" className="shrink-0" aria-hidden>
      <line x1="1" y1="4" x2={width - 1} y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  )
}

/** What the network chart's lines are, drawn rather than described. */
function RateLegend() {
  const item = "inline-flex items-center gap-1.5"
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className={item}><Swatch color={RX} />下行</span>
      <span className={item}><Swatch color={TX} />上行</span>
      <span className="hidden h-3 w-px bg-border sm:block" />
      <span className={item}><Swatch color="currentColor" />平均</span>
      <span className={item}><Swatch color="currentColor" dash="3 3" />峰值（一分钟内最高）</span>
      <span className="opacity-70">对数刻度</span>
    </div>
  )
}

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

function Panel({ title, legend, children, short = false }: { title: string; legend?: React.ReactNode; children: React.ReactNode; short?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        {legend}
      </div>
      <div className={`${short ? "h-20" : "h-40"} w-full text-muted-foreground`}>{children}</div>
    </div>
  )
}

// `narrow` tightens the padding on a phone, so the seven windows of a year of
// history fit one row of a 360px screen.
function Tab({ active, onClick, narrow = false, children }: {
  active: boolean
  onClick: () => void
  narrow?: boolean
  children: string
}) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md py-1 text-xs transition-colors ${narrow ? "px-1.5 sm:px-2.5" : "px-2.5"} ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

/**
 * `historyDays` is how far back the hub keeps history. Both tabs offer every
 * window within it: up to a day each ping is on the latency chart, and past it a
 * point is a bucket -- its median, the range its answers spanned and the share
 * lost -- which over a month shows a route's evening pattern a day cannot.
 */
export function NodeDetail({ node, historyDays }: { node: Node; historyDays: number }) {
  const ranges = useMemo(() => windows(historyDays), [historyDays])
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  // The resources tab's range. The latency tab's two panels each carry their own.
  const [hours, setHours] = useState(6)
  const [data, setData] = useState<{ metrics: Point[] } | null>(null)
  // Retained rather than folded into an empty result: a refused request and an
  // empty window are different answers, and the hub has reason to refuse this one
  // -- it caps how many history windows it builds concurrently. Rendered as an
  // empty window, a 503 would misdirect the reader.
  const [failed, setFailed] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    // The charts must not continue drawing the old range while the new one is in
    // flight.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed("")
    // What this screen can resolve, in device pixels, which is the unit the line
    // is drawn in: a 1280-wide retina panel has 2560 of them for a day of minutes.
    // Read here rather than from a ref, since the hub only thins further, an
    // approximate figure suffices, and the viewport is known before layout. A
    // rotation keeps whatever it fetched with.
    //
    // The tab determines which half is requested; the other accounted for a third
    // to two thirds of every response and was never drawn.
    const points = Math.round(globalThis.innerWidth * (globalThis.devicePixelRatio || 1))
    api<{ metrics: Point[] }>(`/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=metrics`)
      .then((next) => { if (active) setData(next) })
      .catch((e: Error) => {
        if (active) { setFailed(e.message); setData({ metrics: [] }) }
      })
    return () => { active = false }
  }, [node.id, hours, attempt])

  const m = node.metrics
  // The hub answers in seconds; the time axis requires milliseconds. Each rate
  // also spans from its mean to its peak, which is the band drawn behind the
  // line; without a peak the band has no height. The rates drawn are lifted to
  // the floor of their log axis, which has no zero, while `net_rx` and `net_tx`
  // keep the hub's figures for the tooltip.
  const metricRows = useMemo(() => {
    const lift = (v: number) => Math.max(v, RATE_FLOOR)
    return (data?.metrics ?? []).map((p) => ({
      ...p,
      ts: p.ts * 1_000,
      rx: lift(p.net_rx),
      tx: lift(p.net_tx),
      rx_band: [lift(p.net_rx), lift(p.net_rx_max ?? p.net_rx)],
      tx_band: [lift(p.net_tx), lift(p.net_tx_max ?? p.net_tx)],
    }))
  }, [data])
  // What the four panels draw: the rows above, broken where the node was silent.
  // The axes are fitted to the rows alone.
  const chartRows = useMemo(() => withGaps(metricRows), [metricRows])
  // The window's highest rate each way, or null from a hub that sends no peak:
  // a maximum of the means would be labelled a peak it is not.
  const peak = useMemo(() => {
    const rows = data?.metrics ?? []
    if (!rows.some((m) => m.net_rx_max !== undefined)) return null
    const max = (pick: (m: Point) => number | undefined) => rows.reduce((hi, m) => Math.max(hi, pick(m) ?? 0), 0)
    return { rx: max((m) => m.net_rx_max), tx: max((m) => m.net_tx_max) }
  }, [data])

  // Axes for the two panels with no capacity to measure against. CPU and a
  // transfer rate do not express fullness: against a fixed 0-100, a machine
  // sitting at 0.4% draws as a line along the panel's floor. Memory and disk keep
  // their totals as tops, where fullness is the entire question.
  const axes = useMemo(() => {
    const max = (pick: (m: (typeof metricRows)[number]) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
    // 0-0.4 and render every scheduler blip as a peak. Capped at 100.
    const cpu = axisTop(max((m) => m.cpu), 4, 100)
    return {
      cpu: { domain: [0, cpu], ticks: quarters(cpu) },
      // From the slowest rate drawn to the highest peak, so the band stays
      // within the panel.
      rate: rateAxis(
        metricRows.reduce((lo, m) => Math.min(lo, m.rx, m.tx), Infinity),
        max((m) => Math.max(m.rx_band[1], m.tx_band[1])),
      ),
    }
  }, [metricRows])

  // A real time axis rather than the category axis recharts defaults to: on a
  // category axis ticks are selected by index, so a period the agent was offline
  // for collapses to nothing.
  const timeAxis = (rows: { ts: number }[], from = 0, to = rows.length - 1) => {
    // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
    // are dropped by `minTickGap`.
    const ticks = rows.length ? timeTicks(rows[from].ts, rows[to].ts) : []
    return {
      dataKey: "ts",
      type: "number" as const,
      domain: ["dataMin", "dataMax"] as const,
      ticks,
      tickFormatter: tickClock(ticks, hours),
      minTickGap: hours > 24 ? 72 : 40,
      ...AXIS,
    }
  }

  return (
    <div className="space-y-4">
      {/* Wraps below the name on a phone, where the badges beside it would
          leave a 320px screen two characters of it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Country node={node} />
          <h2 className="truncate text-lg font-medium" title={node.name}>{node.name}</h2>
        </div>
        <Status node={node} />
        {node.agent_version && (
          <Badge className="font-normal">
            agent {node.agent_version}
          </Badge>
        )}
      </div>

      {/* One flat grid of facts: one machine's spec sheet, where a box around
          a single topic would be just a box. Three across at lg, two at md, one
          on a phone -- a kernel version or a CPU model needs about 270px to
          stay whole. */}
      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
        <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
        <Fact
          label="CPU"
          value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
        />
        <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Fact
          label="架构"
          value={[node.arch, node.virt !== "none" ? node.virt : "", m ? `${m.procs} 进程` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact
          label="续费"
          value={[
            node.price > 0
              ? `${money(node.price, node.currency)} / ${cycle(node.billing_cycle)}`
              : "免费",
            node.expires_at ? `${node.expires_at} 到期` : FOREVER,
          ].join(" · ")}
        />
      </dl>

      {node.remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{node.remark}</p>
      )}

      <div className="space-y-2 border-t pt-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        {tab === "resources" && (
          /* Wraps on a screen narrower than the seven windows of a year. */
          <div className="flex flex-wrap gap-1">
            {ranges.map((r) => (
              <Tab key={r.hours} narrow active={hours === r.hours} onClick={() => setHours(r.hours)}>
                {r.label}
              </Tab>
            ))}
          </div>
        )}
      </div>

      {tab === "latency" ? (
        <ProbeRedesign key={node.id} nodeId={node.id} historyDays={historyDays} />
      ) : !data ? (
        <Skeleton className="h-40 w-full" />
      ) : failed ? (
        <p className="py-8 text-center text-sm text-destructive" role="alert">
          读取历史数据失败：{failed}
          <button className="ml-2 underline" onClick={() => setAttempt((n) => n + 1)}>重试</button>
        </p>
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : (
        <div className="space-y-5">
          <Panel title="CPU">
            <ResponsiveContainer>
              <AreaChart data={chartRows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(chartRows)} />
                <YAxis {...axes.cpu} unit="%" {...VALUE_AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => [`${Number(v).toFixed(1)}%`, "CPU"]} />
                <Area dataKey="cpu" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...RESOURCE_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* The axis top is the machine's memory, so the line's height is the
              fraction in use whatever range is picked. Tracking the window's
              own maximum, which is what an area chart does by default, puts
              127 MB of a 457 MB box at the top of the panel. The size is in the
              title because the axis top is claiming it. */}
          <Panel title={`内存 · ${bytes(node.mem_total)}`}>
            <ResponsiveContainer>
              <AreaChart data={chartRows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(chartRows)} />
                <YAxis domain={[0, node.mem_total]} ticks={quarters(node.mem_total)} tickFormatter={axisBytes} {...VALUE_AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => bytes(Number(v))} />
                <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} {...RESOURCE_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* A rate has no total to be a fraction of, and its range spans orders
              of magnitude: a week of one node runs from 0.2 KB/s idle to bursts
              of 70 MB/s. Fitted to the bursts, a linear axis would draw the
              median minute less than a pixel above the floor on seven of nine
              nodes at the day window, so this one is logarithmic, each tenfold
              step the same height.

              The line is the bucket's mean, so it integrates to the traffic
              totals, and a 15-second speed test averaged over its minute draws
              at a quarter of the rate it ran at. The band behind it reaches the
              highest rate measured within the bucket, and is edged because a
              one-minute burst on a day's axis is narrower than a pixel, where
              a fill alone does not show. The edge is dashed rather than faded:
              the rates are told apart by shade, and a faded edge of one would
              take the shade of the other's line. Its lower edge lies under the
              line. */}
          <Panel title={peak ? `网络速率 · 窗口内峰值 ↓ ${rate(peak.rx)} · ↑ ${rate(peak.tx)}` : "网络速率"} legend={<RateLegend />}>
            <ResponsiveContainer>
              <ComposedChart data={chartRows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(chartRows)} />
                <YAxis scale="log" {...axes.rate} tickFormatter={axisBytes} unit="/s" {...VALUE_AXIS} />
                <Tooltip
                  {...TOOLTIP}
                  // The hub's figures rather than `v`, which is lifted to the
                  // axis floor.
                  formatter={(_, name, item) => {
                    const mean = item?.payload?.[`net_${item.dataKey}`]
                    const top = item?.payload?.[`net_${item.dataKey}_max`]
                    return [top === undefined ? rate(mean) : `平均 ${rate(mean)} · 峰值 ${rate(top)}`, name]
                  }}
                />
                {[
                  { key: "rx", stroke: RX },
                  { key: "tx", stroke: TX },
                ].map((s) => (
                  <Area
                    key={s.key}
                    dataKey={`${s.key}_band`}
                    stroke={s.stroke}
                    strokeWidth={1}
                    strokeOpacity={0.55}
                    strokeDasharray="3 3"
                    fill={s.stroke}
                    fillOpacity={0.1}
                    isAnimationActive={false}
                    tooltipType="none"
                    legendType="none"
                  />
                ))}
                <Line dataKey="rx" name="下行" stroke={RX} {...RESOURCE_SERIES} />
                <Line dataKey="tx" name="上行" stroke={TX} {...RESOURCE_SERIES} />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          {/* The disk it is filling, for the same reason as memory: a node
              using 2.7% of its disk draws along the top of the panel when the
              axis tracks the window's own maximum. */}
          <Panel title={`硬盘 · ${bytes(node.disk_total)}`} short>
            <ResponsiveContainer>
              <AreaChart data={chartRows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(chartRows)} />
                <YAxis domain={[0, node.disk_total]} ticks={[0, node.disk_total / 2, node.disk_total]} tickFormatter={axisBytes} {...VALUE_AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => bytes(Number(v))} />
                <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} {...RESOURCE_SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  )
}
