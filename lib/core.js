/**
 * cost-guard core: pricing model + durable usage folding + guidance texts
 * (zero dependencies, single source of truth, unit-testable).
 *
 * Pricing = DeepSeek official valley/peak tiered pricing, effective
 * 2026-08-17 (元/百万 tokens):
 *   - 空闲时段（每天 09:00 与 14:00 之外）→ offPeak
 *   - 高峰时段（每天 09:00、14:00 两个整点小时档）→ peak（= 空闲 × 2）
 *   - 输入·缓存命中（cacheRead）最便宜；输入·未命中 + 缓存写（cacheWrite
 *     视作未命中）为 miss；输出 + 推理按 out 计费。
 * Flash ≈ Pro 的 1/3；按 model id 自动选档（/pro/i → pro）。
 */

export const RATES = {
  flash: {
    offPeak: { hit: 0.05, miss: 1.5, out: 4.5 },
    peak: { hit: 0.1, miss: 3.0, out: 9.0 },
  },
  pro: {
    offPeak: { hit: 0.15, miss: 4.5, out: 13.5 },
    peak: { hit: 0.3, miss: 9.0, out: 27.0 },
  },
}

/** 高峰小时档（本地时区）：每日 09:00 与 14:00。 */
export const PEAK_HOURS = new Set([9, 14])

export function isPeakHour(date = new Date()) {
  return PEAK_HOURS.has(date.getHours())
}

export function isProModel(modelId) {
  return typeof modelId === 'string' && /pro/i.test(modelId)
}

/** 当前生效的费率表（¥/M）。 */
export function ratesFor(modelId, date = new Date()) {
  const family = RATES[isProModel(modelId) ? 'pro' : 'flash']
  return isPeakHour(date) ? family.peak : family.offPeak
}

/** 会话累计用量桶（所有字段自增）。 */
export const ZERO = { input: 0, cached: 0, write: 0, output: 0, reasoning: 0 }

export function addUsage(total, usage) {
  total.input += usage.inputTokens ?? 0
  total.output += usage.outputTokens ?? 0
  total.cached += usage.cacheReadTokens ?? 0
  total.write += usage.cacheWriteTokens ?? 0
  total.reasoning += usage.reasoningTokens ?? 0
  return total
}

/** 从 durable 会话事件里取出某条事件的 provider 用量（若有）。 */
export function usageOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage) return event.data.usage
  if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
    return event.data.chunk.usage
  }
  return null
}

/** 一次性折叠整段 durable 事件列表 → 用量桶（resume/reload 正确）。 */
export function totalsOfEvents(events) {
  const total = { ...ZERO }
  for (const event of events || []) {
    const usage = usageOf(event)
    if (usage) addUsage(total, usage)
  }
  return total
}

/** 按 (turn,step) 去重收集 usage（同一 step 的流式锚点被最终 assistant/message 覆盖，防双计）。 */
function usageByStep(events) {
  const byStep = new Map()
  for (const event of events || []) {
    const usage = usageOf(event)
    if (!usage) continue
    const turn = event.data && event.data.turn != null ? event.data.turn : -1
    const step = event.data && event.data.step != null ? event.data.step : 0
    byStep.set(`${turn}:${step}`, usage)
  }
  return byStep
}

/**
 * 折叠整段 durable 事件 → 用量桶（步级去重，语义对齐 token-meter：
 * 同 (turn,step) 的流式 usage 锚点被最终 assistant/message 覆盖）。
 * 取代上方简单求和版本（防流式锚点 + 终值双计）。
 */
export function totalsOfEventsDedup(events) {
  const total = { ...ZERO }
  for (const usage of usageByStep(events).values()) addUsage(total, usage)
  return total
}

/** 最后一条用户消息往返（= 最大 turn 的所有 step 用量求和）；无则 null。 */
export function lastTurnOf(events) {
  const byStep = usageByStep(events)
  let last = -1
  for (const key of byStep.keys()) {
    const turn = Number(key.split(':')[0])
    if (turn > last) last = turn
  }
  if (last < 0) return null
  const totals = { ...ZERO }
  for (const [key, usage] of byStep) {
    if (Number(key.split(':')[0]) === last) addUsage(totals, usage)
  }
  return { turn: last, totals }
}

/** 计费口径：未命中的输入 = input + 缓存写。 */
export function billedOf(total) {
  return { uncached: total.input + total.write, cached: total.cached }
}

/** 按费率折算人民币成本。 */
export function costOf(total, rates) {
  const { uncached } = billedOf(total)
  const yuan =
    (total.cached / 1e6) * rates.hit +
    (uncached / 1e6) * rates.miss +
    ((total.output + total.reasoning) / 1e6) * rates.out
  return { yuan, uncached, cached: total.cached, output: total.output + total.reasoning }
}

/** 若整段输入都能命中缓存（同一费率下的下界），可省多少。 */
export function savingsOf(total, rates) {
  const now = costOf(total, rates)
  const allHit =
    ((total.input + total.write + total.cached) / 1e6) * rates.hit +
    ((total.output + total.reasoning) / 1e6) * rates.out
  return Math.max(0, now.yuan - allHit)
}

/** 缓存命中率 = 命中输入 / 计费输入。 */
export function hitRate(total) {
  const billed = total.input + total.write + total.cached
  return billed > 0 ? total.cached / billed : 0
}

export function fmtYuan(yuan) {
  return `¥${yuan.toFixed(4)}`
}

export function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`
}

/** 下一个高峰/空闲切换点的本地时间（用于提示错峰）。 */
export function nextWindow(date = new Date()) {
  const d = new Date(date)
  d.setSeconds(0, 0)
  const h = d.getHours()
  const nowPeak = isPeakHour(d)
  // 高峰小时为 [9,10) 与 [14,15)：若当前恰在高峰首分，切换到下一档
  if (nowPeak) {
    if (h === 9) { d.setHours(10); return { now: 'peak', next: d, nextIs: 'offPeak' } }
    if (h === 14) { d.setHours(15); return { now: 'peak', next: d, nextIs: 'offPeak' } }
  }
  // 空闲中：找下一个高峰整点
  const candidates = [9, 14].map((hh) => {
    const t = new Date(d); t.setHours(hh, 0, 0, 0)
    if (t <= d) t.setDate(t.getDate() + 1)
    return t
  }).sort((a, b) => a - b)
  const next = candidates[0]
  return { now: 'offPeak', next, nextIs: 'peak' }
}

// ── 近场引导文本（固定字符串 = 缓存中性，与 mode-boost/router 同原则）─────
export const GUIDE_CONVERGE =
  '\n\n[cost-guard] 收敛：用最少的额外步骤完成当前目标——批量读取、复用上下文已有信息、现在就产出。每次工具调用都是计费动作。'

export const GUIDE_BUDGET =
  '\n\n[cost-guard] 预算已超：立即以最少步骤完成当前目标，停止探索、不做环境检查、不做穷举扫描，直接交付。'

export const GUIDE_DEEP =
  '\n\n[cost-guard] 这是高价值复杂任务：值得多花几步做对。一次性做足架构/边界/集成点的思考再动手，避免返工（返工 = 重复计费）。'

export const GUIDE_OFFPEAK =
  '\n\n[cost-guard] 当前是高峰时段。若当前任务可延时，请登记为成本待办（cost_defer）留到空闲时段自动执行；若必须现在做，请收敛到最少步数。'

/** 可写进 system 静态区的固定成本纪律句（可选，preset 之外只读消费）。 */
export const PERSONA_COST =
  'Cost discipline: every tool call is billed work — batch reads, reuse prior results, stop when enough information exists, never run environment checks or exhaustive scans; finish each task with a one-line delivery note.'

/** 加在每条任务末尾的收敛后缀（可选，用户自带提示词用）。 */
export const TASK_CONVERGE =
  '\n\n(converge) 用能确定完成的最少步骤工作；不重复已做的读取；信息足够就交付。'
