import { api, ApiError } from "./api.ts"
import { pairOrder, selectProbes, type PingData, type PingRow } from "./ping.ts"
import type { MinuteSeries, RedesignData } from "./probeRedesign"

/**
 * 参考实现的「数据层」：把 hub 的延迟记录变成每条线路按分钟的 { lat, loss }，
 * 覆盖 [START, NOW)。渲染和交互（probeRedesign.js）按分钟聚合，不知道 hub 的分桶。
 *
 * hub 只能按「从现在往前 N 小时」取，每次最多 1440 个桶：
 * - 最近 24 小时：1 分钟一桶，就是每分钟的原始结果；
 * - 最近 7 天：7 分钟一桶（hub 保留 7 天分钟数据）；
 * - 更早到 30 天：1 小时一桶（hub 的小时汇总）。
 * 由粗到细依次铺：细的一层先把自己覆盖的时段清空再写入，所以每一段用的都是能拿到的最细数据。
 *
 * 一个桶展开成它覆盖的每一分钟：
 * - 延迟：都用桶的中位数；桶有最低–最高（band）时，第 1 分钟写最低、第 2 分钟写最高，
 *   这样参考实现算出的平均约等于中位数、最低 / 最高和 hub 一致；
 * - 丢包：按桶的丢包率算出丢了几分钟，均匀分布在桶内，记 loss = 1；
 * - 整桶全丢（latency 为 null）：参考实现只统计 lat 不为 null 的分钟，空着就算不进丢包，
 *   所以这些分钟的 lat 沿用前一个有效延迟（开头没有就用后一个），loss 记 1。
 * 30 天档读小时汇总，hub 给每小时的丢包率已经向上取整，那一档的丢包可能偏高最多约 1 个百分点。
 */

const M = 60_000
const MAX_DAYS = 30

type Tier = { rows: PingRow[]; step: number; since: number }

async function read(id: number, hours: number, points: number): Promise<PingData> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<PingData>(`/nodes/${id}/metrics?series=ping&hours=${hours}&points=${points}`)
    } catch (e) {
      // hub 同时只受理 4 个历史查询，满了返回 503，稍等再问
      if (e instanceof ApiError && e.status === 503 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      throw e
    }
  }
}

/** 一条线路：由粗到细的几层桶 → 每分钟。纯函数，便于测试。 */
export function minuteSeries(tiers: Tier[], taskId: number, START: number, TOT: number): MinuteSeries {
  const lat: (number | null)[] = new Array(TOT).fill(null)
  const loss: number[] = new Array(TOT).fill(0)
  const blank: boolean[] = new Array(TOT).fill(false)
  for (const tier of tiers) {
    const from = Math.max(0, Math.floor((tier.since * 1000 - START) / M))
    for (let k = from; k < TOT; k++) { lat[k] = null; loss[k] = 0; blank[k] = false }
    const per = Math.max(1, Math.round(tier.step / 60))
    for (const r of tier.rows) {
      if (r.task_id !== taskId) continue
      const at = Math.round((r.ts * 1000 - START) / M)
      const lostN = r.latency === null ? per : Math.round(((r.loss ?? 0) / 100) * per)
      for (let j = 0; j < per; j++) {
        const k = at + j
        if (k < 0 || k >= TOT) continue
        const lost = Math.floor(((j + 1) * lostN) / per) > Math.floor((j * lostN) / per)
        loss[k] = lost ? 1 : 0
        if (r.latency === null) { blank[k] = true; continue }
        lat[k] = r.band && per > 1 && j === 0 ? r.band[0] : r.band && per > 1 && j === 1 ? r.band[1] : r.latency
      }
    }
  }
  // 整桶全丢的分钟：沿用前一个有效延迟，开头的用后一个
  let last: number | null = null
  for (let k = 0; k < TOT; k++) {
    if (lat[k] !== null) last = lat[k]
    else if (blank[k] && last !== null) lat[k] = last
  }
  let next: number | null = null
  for (let k = TOT - 1; k >= 0; k--) {
    if (lat[k] !== null && !blank[k]) next = lat[k]
    else if (blank[k] && lat[k] === null && next !== null) lat[k] = next
  }
  return { lat, loss }
}

export async function loadRedesignData(nodeId: number, historyDays: number): Promise<RedesignData> {
  const NOW = Math.floor(Date.now() / M) * M
  const DAYS = Math.max(1, Math.min(MAX_DAYS, Math.floor(historyDays)))
  const TOT = DAYS * 1440
  const START = NOW - TOT * M
  const hours = DAYS * 24

  // 由粗到细；保留期本身不到 7 天 / 1 天时少读几层
  const plan: [number, number][] = []
  if (hours > 168) plan.push([hours, 720])
  if (hours > 24) plan.push([Math.min(168, hours), 1440])
  plan.push([24, 1440])

  const tiers: Tier[] = []
  const probes: Record<string, string> = {}
  for (const [h, points] of plan) {
    const d = await read(nodeId, h, points)
    Object.assign(probes, d.probes ?? {})
    const step = d.step ?? 60
    tiers.push({ rows: d.ping ?? [], step, since: Math.floor((NOW / 1000 - h * 3600) / step) * step })
  }

  const order = pairOrder(selectProbes(probes, []))
  return {
    NOW, START, TOT,
    LINES: order.map((p) => p.name),
    // 下面的延迟曲线显示哪几条（下标指向 LINES）：全部线路各一行
    CHART_LINES: order.map((_, i) => i),
    DATA: order.map((p) => minuteSeries(tiers, p.id, START, TOT)),
  }
}
