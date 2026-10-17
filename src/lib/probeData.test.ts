/// <reference types="node" />
import assert from "node:assert/strict"
import { minuteSeries } from "./probeData.ts"

const M = 60_000
const START = 1_760_000_000_000 - (1_760_000_000_000 % M)
const s = START / 1000

// 1 分钟一桶：原样；全丢的分钟沿用前一个延迟，记丢包
const fine = minuteSeries([{ since: s, step: 60, rows: [
  { task_id: 1, ts: s, latency: 150 },
  { task_id: 1, ts: s + 60, latency: null, loss: 100 },
  { task_id: 1, ts: s + 120, latency: 160 },
  { task_id: 2, ts: s, latency: 999 },
] }], 1, START, 4)
assert.deepEqual(fine.lat, [150, 150, 160, null])
assert.deepEqual(fine.loss, [0, 1, 0, 0])
console.log("minute buckets map one to one; a lost minute is counted")

// 7 分钟一桶，丢包 29%（2 / 7），带 band：第 1、2 分钟写最低 / 最高
const mid = minuteSeries([{ since: s, step: 420, rows: [{ task_id: 1, ts: s, latency: 170, band: [160, 190], loss: 29 }] }], 1, START, 7)
assert.deepEqual(mid.lat, [160, 190, 170, 170, 170, 170, 170])
assert.equal(mid.loss.reduce((a, b) => a + b, 0), 2)
console.log("coarse buckets spread over their minutes with band and loss share")

// 细的一层覆盖粗的：粗层整段 200，细层从第 3 分钟起只有一个点
const layered = minuteSeries([
  { since: s, step: 300, rows: [{ task_id: 1, ts: s, latency: 200 }] },
  { since: s + 120, step: 60, rows: [{ task_id: 1, ts: s + 180, latency: 150 }] },
], 1, START, 5)
assert.deepEqual(layered.lat, [200, 200, null, 150, null])
// 开头就全丢：用后一个有效延迟
const lead = minuteSeries([{ since: s, step: 60, rows: [
  { task_id: 1, ts: s, latency: null, loss: 100 }, { task_id: 1, ts: s + 60, latency: 155 },
] }], 1, START, 2)
assert.deepEqual(lead.lat, [155, 155])
console.log("finer tiers replace coarser ones; leading lost minutes borrow the next latency")
