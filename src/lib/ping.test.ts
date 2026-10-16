/// <reference types="node" />
import assert from "node:assert/strict"
import {
  buildSlots, cardProbes, fmtLoss, fmtMs, latencySignal, lossSignal, pairOrder, parseSelection, probeStats,
  selectProbes, splitFamily,
  type PingData,
} from "./ping.ts"

assert.deepEqual(splitFamily("电信-IPv6"), { base: "电信", family: "v6" })
assert.deepEqual(splitFamily("电信 (IPv6)"), { base: "电信", family: "v6" })
assert.deepEqual(splitFamily("移动v6"), { base: "移动", family: "v6" })
assert.deepEqual(splitFamily("电信"), { base: "电信", family: "v4" })
assert.deepEqual(splitFamily("联通 IPv4"), { base: "联通", family: "v4" })
assert.deepEqual(splitFamily("IPv6"), { base: "IPv6", family: "v4" })
console.log("probe names split into base and family")

const probes = { "1": "电信", "2": "联通", "4": "电信-IPv6", "5": "联通-IPv6" }
assert.deepEqual(parseSelection(" 电信-IPv6\n,电信，2 \n"), ["电信-IPv6", "电信", "2"])
assert.deepEqual(selectProbes(probes, []).map((p) => p.id), [1, 2, 4, 5])
assert.deepEqual(selectProbes(probes, ["电信-IPv6", "电信", "2", "不存在", "1"]).map((p) => p.id), [4, 1, 2])
console.log("selection keeps the operator's order and ignores unknown names")

// Ten one-minute slots; a slot averages its answered buckets and its loss.
const since = 1000, until = since + 600
const slots = buildSlots([
  { task_id: 1, ts: since, latency: 40 },
  { task_id: 1, ts: since + 30, latency: 60 },
  { task_id: 1, ts: since + 60, latency: null, loss: 100 },
  { task_id: 1, ts: since + 90, latency: 80 },
  { task_id: 1, ts: since - 60, latency: 10 },
], since, until, 10)
assert.deepEqual(slots[0], { ts: since + 30, latency: 50, loss: 0 })
assert.deepEqual(slots[1], { ts: since + 90, latency: 80, loss: 50 })
assert.equal(slots.length, 10)
assert.equal(slots.filter(Boolean).length, 2)
console.log("slots fold their buckets")

// Latency is judged against the line's own usual, loss by the figure.
assert.deepEqual([null, 270, 337, 400, 500, 700, 1000].map((v) => latencySignal(v, 270)), [0, 1, 1, 2, 3, 4, 5])
assert.deepEqual([null, 5, 7, 15, 30].map((v) => latencySignal(v, 5)), [0, 1, 1, 2, 3])
assert.equal(latencySignal(80, null), 1)
assert.deepEqual([null, 0, 1, 2, 5, 8, 20].map(lossSignal), [0, 1, 1, 2, 3, 4, 5])
console.log("signal steps: latency against its line, loss by figure")

const data: PingData = {
  probes,
  // Window loss comes from the hub, never from averaging the rows.
  loss: { "1": 2.5 },
  ping: [
    { task_id: 1, ts: until - 120, latency: 30, loss: 50 },
    { task_id: 1, ts: until - 60, latency: 42 },
    { task_id: 4, ts: until - 60, latency: null, loss: 100 },
    { task_id: 2, ts: until - 60, latency: 55 },
  ],
}
const one = probeStats(data, { id: 1, name: "电信" }, since, until, 20)
assert.deepEqual([one.latest, one.avg, one.min, one.max, one.loss, one.family], [42, 36, 30, 42, 2.5, "v4"])
const six = probeStats(data, { id: 4, name: "电信-IPv6" }, since, until, 20)
assert.deepEqual([six.timedOut, six.latest, six.avg, six.loss, six.family], [true, null, null, 0, "v6"])
assert.equal(probeStats(data, { id: 5, name: "联通-IPv6" }, since, until, 20).loss, null)
assert.equal(one.typical, 36)
console.log("stats read the newest bucket and the hub's window loss")

// The card shows IPv4 unless told otherwise.
assert.deepEqual(cardProbes(data, [], 1, until).map((p) => p.id), [1, 2])
assert.deepEqual(cardProbes(data, ["电信-IPv6", "电信"], 1, until).map((p) => p.id), [4, 1])
console.log("cards show IPv4 by default")

assert.deepEqual(
  pairOrder(selectProbes({ ...probes, "3": "移动", "6": "移动-IPv6" }, [])).map((p) => p.id),
  [1, 4, 2, 5, 3, 6],
)
console.log("each IPv6 probe follows its IPv4 twin")

assert.deepEqual([0, 0.05, 2.325, 16.27].map(fmtLoss), ["0", "<0.1", "2.3", "16"])
assert.deepEqual([4.26, 42.4].map(fmtMs), ["4.3", "42"])
console.log("figures format")
