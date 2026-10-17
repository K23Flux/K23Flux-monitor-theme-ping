/** 每条线路按分钟的数据：lat 延迟 ms（缺数据为 null），loss 0 / 1。 */
export type MinuteSeries = { lat: (number | null)[]; loss: number[] }

export type RedesignData = {
  /** 毫秒，对齐到分钟 */
  NOW: number
  START: number
  /** 分钟数，START + TOT 分钟 = NOW */
  TOT: number
  LINES: string[]
  CHART_LINES: number[]
  DATA: MinuteSeries[]
}

/** 在 root 里渲染线路质量和延迟曲线，返回卸载函数。 */
export function mount(root: HTMLElement, data: RedesignData): () => void
