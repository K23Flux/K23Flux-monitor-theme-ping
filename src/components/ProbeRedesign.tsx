import { useEffect, useRef, useState } from "react"

import { loadRedesignData } from "@/lib/probeData"
import { mount } from "@/lib/probeRedesign"
import "./probe-redesign.css"

/**
 * 详情页「网络延迟」：线路质量 + 延迟曲线，外观和交互照 probe-redesign-reference.html。
 * 下面的结构是参考文件 <body> 里的原样；数据由 probeData.ts 读 hub 后交给 mount()。
 */
export function ProbeRedesign({ nodeId, historyDays }: { nodeId: number; historyDays: number }) {
  const root = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "empty" | string>("loading")

  useEffect(() => {
    let active = true
    let unmount: (() => void) | undefined
    loadRedesignData(nodeId, historyDays)
      .then((data) => {
        if (!active || !root.current) return
        if (!data.LINES.length) { setState("empty"); return }
        setState("ready")
        unmount = mount(root.current, data)
      })
      .catch((e: Error) => { if (active) setState(e.message || "读取失败") })
    return () => { active = false; unmount?.() }
  }, [nodeId, historyDays])

  return (
    <>
      {state === "loading" && <p className="py-8 text-center text-sm text-muted-foreground">正在读取延迟…</p>}
      {state === "empty" && <p className="py-8 text-center text-sm text-muted-foreground">这台服务器没有延迟探测</p>}
      {state !== "loading" && state !== "empty" && state !== "ready" && (
        <p className="py-8 text-center text-sm text-destructive" role="alert">读取延迟失败：{state}</p>
      )}
      <div ref={root} className="pr" hidden={state !== "ready"}>
        <div className="card" id="q">
          <div className="head"><span className="title">线路质量</span><div className="btns" id="qb"></div></div>
          <div className="info" id="qi"></div>
          <div id="qrows"></div>
          <div className="ticks-row"><span></span><div className="ticks" id="qt"></div></div>
          <div className="legend">柱高 延迟　颜色 丢包<span className="sw" style={{ background: "var(--l0)" }}></span>0<span className="sw" style={{ background: "var(--l1)" }}></span>&lt;1%<span className="sw" style={{ background: "var(--l2)" }}></span>&lt;5%<span className="sw" style={{ background: "var(--l3)" }}></span>≥5%</div>
        </div>

        <div className="card">
          <div className="head"><span className="info" id="rd" style={{ padding: 0, minHeight: 18 }}></span><div className="btns" id="lb"></div></div>
          <svg id="sv"></svg>
        </div>
      </div>
    </>
  )
}
