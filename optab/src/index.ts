/**
 * @dsh-external/dsh-optab — DSH 成本优化（终版：前缀瘦身 + 双层工具输出压缩）
 *   ① 前缀瘦身        : system-prompt/assemble 滤除 denylist 工具（减未命中前缀）
 *   ② 投影压缩（即时） : tools/execute 把当步模型可见的大工具结果换成确定性预览
 *   ③ 持久压缩（落库） : session/event 观察大 tool/result →
 *                        维护 active surface 折叠 → setImmediate 延迟（防重入）→
 *                        append('tool/result', 预览, { surfaceOp:{op:'replace',start,end}, sourceEventSeqs:[原seq] })
 *                        让 derive/replay 只见压缩字节（全文落 artifact）
 *
 * DSH 源码实证(为什么是这三个钩子)：
 *  - agent/request 的 resolved.tools 为空 → 瘦身走 assemble。
 *  - tools/execute 返回替换只在当步模型投影生效，durable tool/result 仍全文 → 故再加 ③ 持久 replace，
 *    这是 SurfaceIntent 正式支持的 compaction 语义（{op:'replace',start,end}+sourceEventSeqs 盖住被阴影节点）。
 *  - compaction/start…end 括号事件为 host 私有（不在本版 SessionEventMap），先跳过，仅做合法 replace。
 * 缓存纪律：全部确定性；replace 一次性；失败软降级（记 error log，不阻断 agent）。
 */
import type { Context } from 'cordis'
import z from 'schemastery'
import fs from 'node:fs'
import path from 'node:path'

export const name = '@dsh-external/dsh-optab'
export const inject: string[] = []

export interface Config {
  slimTools: string[]
  compress: boolean
  wrapTools: string[]
  /** 持久压缩（落库 replace）开关 */
  durableCompress: boolean
  maxChars: number
  maxLines: number
  headChars: number
  tailChars: number
  metricsDir: string
  /** 实验用：强制每请求 reasoningEffort（如 'low'/'high'），空=不干预 */
  forceReasoningEffort: string
  /** 档位模式：off=不干预 / auto=关键词+滚动推理自动定档 / force=用 forceReasoningEffort */
  effortMode: 'off' | 'auto' | 'force'
  /** 常规默认档（gateway 默认是 max，这里降到 high 为主） */
  defaultEffort: 'high' | 'max'
  /** 命中即升 max 的任务关键词（开放式视觉/3D/系统开发等） */
  maxKeywords: string[]
  /** 滚动窗口大小（最近 N 条请求） */
  maxRollingReqs: number
  /** 窗口内每请求平均推理 token ≥ 该值 → 升 max */
  maxRollingThreshold: number
  /** ── 成本守卫配合 ── */
  /** 峰时窗口（本机时间为准，HHMM-HHMM，多段），命中且 peakMax=high 时把 max 封顶为 high */
  peakWindows: string[]
  /** 本机时区偏移（小时），用于把"本机时刻"换算判定峰谷；默认 +8（北京） */
  peakTzOffsetHours: number
  /** 峰时封顶档：'high'=峰时 max→high；'max'=峰时不封顶 */
  peakMax: 'high' | 'max'
  /** 成本守卫超支信号文件（JSON）：存在且判为超支 → 进入收紧模式 */
  budgetSignalPath: string
  /** 信号文件新鲜度 TTL(ms)；0=只要存在即生效 */
  budgetSignalTtlMs: number
  /** 收紧模式票据 */
  tightEffort: 'high' | 'max'
  tightMaxChars: number
  tightHeadChars: number
  tightTailChars: number
  /** 成本守卫托管：非空=由守卫的 optab.json(enabled) 控制本插件开关（空=一直启用） */
  guardStatePath: string
}

export const Config = z.object({
  slimTools: z.array(z.string()).default([
    'create_goal', 'exit_plan_mode', 'get_goal', 'glob', 'grep',
    'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents',
    'ralph', 'read_image', 'send_message', 'skill', 'str_replace_editor',
    'subagent', 'subagent_fork', 'todo_write', 'update_goal', 'web_search', 'workflow',
  ]),
  compress: z.boolean().default(true),
  wrapTools: z.array(z.string()).default(['read']),
  durableCompress: z.boolean().default(true),
  maxChars: z.number().default(12000),
  maxLines: z.number().default(240),
  headChars: z.number().default(4000),
  tailChars: z.number().default(2000),
  metricsDir: z.string().default(''),
  forceReasoningEffort: z.string().default(''),
  effortMode: z.union([z.const('off'), z.const('auto'), z.const('force')]).default('off'),
  defaultEffort: z.union([z.const('high'), z.const('max')]).default('high'),
  maxKeywords: z.array(z.string()).default([
    '黑洞', '池核', '银河', '坎巴拉', '大摆锤', '模拟器', '沙盘', '体素', '三体',
    'three.js', 'threejs', 'webgl', 'webgpu', 'babylon', '单文件html', '可视化',
    '监控', '用量', '多代理', '宇宙', '星系', '游戏', '震撼', '惊艳',
  ]),
  maxRollingReqs: z.number().default(5),
  maxRollingThreshold: z.number().default(800),
  peakWindows: z.array(z.string()).default(['0900-1200', '1400-1800']),
  peakTzOffsetHours: z.number().default(8),
  peakMax: z.union([z.const('high'), z.const('max')]).default('high'),
  budgetSignalPath: z.string().default(''),
  budgetSignalTtlMs: z.number().default(0),
  tightEffort: z.union([z.const('high'), z.const('max')]).default('high'),
  tightMaxChars: z.number().default(4000),
  tightHeadChars: z.number().default(1500),
  tightTailChars: z.number().default(800),
  guardStatePath: z.string().default(''),
})

function countLines(text: string): number {
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function deterministicPreview(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars) return text
  const head = text.slice(0, headChars)
  const tail = text.slice(-tailChars)
  const cut = text.length - headChars - tailChars
  const marker =
    `\n… [OPTab 确定性截断预览: 原文 ${text.length} 字符 / ${countLines(text)} 行，省略 ${cut} 字符；完整内容已存 artifact，需要时用 read 工具读取] …\n`
  return head + marker + tail
}

export function apply(ctx: Context, config: Config): void {
  const slimTools = new Set(config.slimTools)
  const wrapTools = new Set(config.wrapTools)
  const metricsDir = config.metricsDir
  let artifactSeq = 0

  function record(agent: any, kind: string, data: Record<string, unknown>): void {
    if (!metricsDir) return
    try {
      fs.mkdirSync(path.join(metricsDir, 'artifacts'), { recursive: true })
      fs.appendFileSync(path.join(metricsDir, `optab-${process.pid}.jsonl`), JSON.stringify({
        t: Date.now(),
        agent: agent?.id ?? null,
        kind,
        ...data,
      }) + '\n')
    } catch (error: any) {
      try {
        fs.mkdirSync(metricsDir, { recursive: true })
        fs.appendFileSync(path.join(metricsDir, 'optab-error.log'),
          `${new Date().toISOString()} ${String(error?.stack ?? error)}\n`)
      } catch { /* ignore */ }
    }
  }
  function recordError(msg: string, error: unknown): void {
    if (!metricsDir) return
    try {
      fs.mkdirSync(metricsDir, { recursive: true })
      fs.appendFileSync(path.join(metricsDir, 'optab-error.log'),
        `${new Date().toISOString()} ${msg}: ${String((error as any)?.stack ?? error)}\n`)
    } catch { /* ignore */ }
  }
  function writeArtifact(agentId: string | null, toolName: string, callId: string, text: string): string | null {
    try {
      const dir = path.join(metricsDir, 'artifacts')
      fs.mkdirSync(dir, { recursive: true })
      artifactSeq++
      const p = path.join(dir, `${agentId ?? 'agent'}-${toolName}-${callId}-${artifactSeq}.txt`)
      fs.writeFileSync(p, text, 'utf8')
      return p
    } catch {
      return null
    }
  }

  record(null, 'boot', {
    pid: process.pid,
    slimTools: config.slimTools,
    wrapTools: config.wrapTools,
    compress: config.compress,
    durableCompress: config.durableCompress,
    thresholdChars: config.maxChars,
    forceReasoningEffort: config.forceReasoningEffort,
  })

  // ═══ 0 推理档位：force / auto（关键词 + 滚动推理量），不改全局 settings ════
  // 运行时状态由 session/event 喂入（见 ③）；agent/request 里做决定并注入。
  const sessState = new WeakMap<any, { lastUser: string; ring: number[] }>()
  const stateOf = (s: any) => {
    let st = sessState.get(s)
    if (!st) { st = { lastUser: '', ring: [] }; sessState.set(s, st) }
    return st
  }

  const wantsMax = config.effortMode === 'auto'
  const kwSet = new Set(config.maxKeywords.map((k) => k.toLowerCase()))
  const isReminder = (s: string) =>
    s.startsWith('<system-reminder') || s.startsWith('&lt;system-reminder')
    || s.startsWith('Current runtime context') || s.startsWith('<available_skills') || s.startsWith('&lt;available_skills')
  const userTextOf = (data: any) => {
    const t = (data?.content ?? []).map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join(' ').trim()
    return isReminder(t) ? '' : t
  }

  // ── 成本守卫配合：峰谷 + 超支信号 ──
  const tightCacheMap = new Map<string, { t: number; v: boolean }>()
  const isTight = (sessionId?: string | null): boolean => {
    if (!config.budgetSignalPath) return false
    try {
      const now = Date.now()
      const key = sessionId ?? ''
      const cached = tightCacheMap.get(key)
      if (cached && now - cached.t < 2000) return cached.v
      const st = fs.statSync(config.budgetSignalPath)
      if (config.budgetSignalTtlMs > 0 && now - st.mtimeMs > config.budgetSignalTtlMs) { tightCacheMap.set(key, { t: now, v: false }); return false }
      const j = JSON.parse(fs.readFileSync(config.budgetSignalPath, 'utf8'))
      // 三种超支/收敛判据：
      //  a) 数值账本超支 cost>=budget（全局）  b) 显式 over=true（全局）
      //  c) converged 会话列表：命中当前会话 = 该会话在收敛模式 → 收紧；无会话上下文时非空即全局收紧
      let over = (typeof j.cost === 'number' && typeof j.budget === 'number' && j.cost >= j.budget)
        || j.over === true
      if (!over && Array.isArray(j.converged)) {
        over = sessionId ? j.converged.includes(sessionId) : j.converged.length > 0
      }
      tightCacheMap.set(key, { t: now, v: over })
      return over
    } catch { return false }
  }
  const isPeak = (): boolean => {
    try {
      const d = new Date()
      const off = config.peakTzOffsetHours % 24
      const localMin = (((d.getUTCHours() + off) % 24 + 24) % 24) * 60 + d.getUTCMinutes()
      for (const w of config.peakWindows) {
        const [a, b] = w.split('-')
        if (a && b) {
          const s = Number(a.slice(0, 2)) * 60 + Number(a.slice(2, 4))
          const e = Number(b.slice(0, 2)) * 60 + Number(b.slice(2, 4))
          if (s <= e ? (localMin >= s && localMin < e) : (localMin >= s || localMin < e)) return true
        }
      }
    } catch { /* ignore */ }
    return false
  }
  const effMax = (sid?: string | null) => (isTight(sid) ? config.tightMaxChars : config.maxChars)
  const effHead = (sid?: string | null) => (isTight(sid) ? config.tightHeadChars : config.headChars)
  const effTail = (sid?: string | null) => (isTight(sid) ? config.tightTailChars : config.tailChars)
  // 成本守卫托管开关（会话级）：guardStatePath 非空 → 读 optab.json
  //   { enabled: 全局默认, sessions: { <sessionId>: bool } }；按当前会话命中 sessions 优先，否则回落全局默认；空 → 恒开
  const guardCacheMap = new Map<string, { t: number; v: boolean }>()
  const optabOn = (sessionId?: string | null): boolean => {
    if (!config.guardStatePath) return true
    try {
      const now = Date.now()
      const key = sessionId ?? ''
      const cached = guardCacheMap.get(key)
      if (cached && now - cached.t < 2000) return cached.v
      const j = JSON.parse(fs.readFileSync(config.guardStatePath, 'utf8'))
      const v = sessionId ? Boolean(j?.sessions?.[sessionId] ?? j?.enabled) : Boolean(j?.enabled)
      guardCacheMap.set(key, { t: now, v })
      return v
    } catch { return false }
  }
  const peakNow = isPeak()
  const tightNow = isTight()
  record(null, 'state', { peak: peakNow, tight: tightNow, signal: config.budgetSignalPath, guardOwned: Boolean(config.guardStatePath), optabOn: optabOn() })
  ctx.on('agent/request' as any, async (_payload: any, next: any) => {
    const resolved = await next()
    const agent = _payload?.agent
    if (!optabOn(agent?.session?.id)) return resolved
    const st = stateOf(agent?.session)

    let decided: string | null = null
    let reason = ''
    if (config.effortMode === 'force' && config.forceReasoningEffort) {
      decided = config.forceReasoningEffort; reason = 'force'
    } else if (wantsMax) {
      // 关键词源：状态缓存优先，否则从 session events 兜底（滤注入，取第一条真实任务文本）
      let text = st.lastUser
      if (!text && agent?.session?.events) {
        const evs = agent.session.events
        for (let i = 0; i < evs.length; i++) {
          const e = evs[i]
          if (e?.type === 'user/message') {
            const t = userTextOf(e.data)
            if (t) { text = t; st.lastUser = t; break }
          }
        }
      }
      const lower = text.toLowerCase()
      const kw = kwSet.size ? [...kwSet].find((k) => lower.includes(k)) : undefined
      if (kw) { decided = 'max'; reason = `kw:${kw}` }
      else {
        const win = st.ring.slice(-config.maxRollingReqs)
        if (win.length >= 2) {
          const avg = win.reduce((n, x) => n + x, 0) / win.length
          if (avg >= config.maxRollingThreshold) { decided = 'max'; reason = `rolling:${Math.round(avg)}` }
        }
      }
      if (!decided) { decided = config.defaultEffort; reason = 'default' }
    }
    if (!decided) return resolved
    // 成本守卫配合：超支/收敛收紧 > 峰时封顶（force 模式保持显式覆盖）
    const force = config.effortMode === 'force'
    const sid: string | null = agent?.session?.id ?? null
    if (!force && isTight(sid)) { decided = config.tightEffort; reason = `${reason}+budget` }
    else if (!force && isPeak() && config.peakMax === 'high' && decided === 'max') { decided = 'high'; reason = `${reason}+peak` }
    record(agent, 'effort', { from: resolved?.reasoningEffort ?? null, to: decided, reason, peak: isPeak(), tight: isTight(sid), user: (st.lastUser || '?').slice(0, 40), rolling: st.ring.slice(-config.maxRollingReqs) })
    return { ...resolved, reasoningEffort: decided }
  })

  // ═══ ① 前缀瘦身 ═════════════════════════════════════════════════════════
  ctx.on('system-prompt/assemble' as any, async (_assembly: any, context: any, next: any) => {
    const assembled = await next()
    const agent = context?.agent
    if (!optabOn(agent?.session?.id)) return assembled
    const tools = assembled?.tools
    if (slimTools.size === 0 || !Array.isArray(tools) || tools.length === 0) return assembled
    const removed: string[] = []
    const kept = tools.filter((t: any) => {
      const n = t?.name
      if (typeof n === 'string' && slimTools.has(n)) {
        removed.push(n)
        return false
      }
      return true
    })
    if (removed.length === 0) return assembled
    record(agent, 'slim', {
      removed,
      kept: kept.length,
      total: tools.length,
      charDelta: JSON.stringify(tools).length - JSON.stringify(kept).length,
    })
    return { ...assembled, tools: kept }
  })

  // ═══ ② 投影压缩（当步模型可见） ══════════════════════════════════════════
  ctx.on('tools/execute' as any, async (exec: any, next: any) => {
    const result = await next()
    if (!optabOn(exec?.agent?.session?.id ?? exec?.agent?.id)) return result
    const toolName: string | undefined = exec?.name
    if (!config.compress || result?.isError === true) return result
    // wrapTools 为空 = 压缩所有文本型工具的结果（生产建议空=全开）
    if (wrapTools.size > 0 && toolName !== undefined && !wrapTools.has(toolName)) return result
    const content = result?.content
    if (!Array.isArray(content) || content.length === 0) return result

    let changed = false
    let inChars = 0
    let outChars = 0
    const psid: string | null = (exec?.agent?.session?.id as string) ?? (exec?.agent?.id as string) ?? null
    const newContent = content.map((cb: any) => {
      if (!cb || cb.type !== 'text') return cb
      const text = (cb.text ?? '') as string
      if (text.length <= effMax(psid) && countLines(text) <= config.maxLines) return cb
      const preview = deterministicPreview(text, effHead(psid), effTail(psid))
      inChars += text.length
      outChars += preview.length
      changed = true
      return { ...cb, text: preview }
    })
    if (!changed) return result
    record(exec?.agent, 'compress-projection', { tool: toolName, inChars, outChars, savedChars: inChars - outChars })
    return { ...result, content: newContent }
  })

  // ═══ ③ 持久压缩（落库 replace） ═════════════════════════════════════════
  const foldMap = new WeakMap<any, Array<{ seq: number }>>()

  ctx.on('session/event' as any, (session: any, event: any) => {
    if (!optabOn(session?.id)) return
    // —— 喂入档位状态：最近 user 文本 + 滚动推理量 ——
    if (config.effortMode === 'auto') {
      const st = stateOf(session)
      if (event?.type === 'user/message') {
        const txt = userTextOf(event.data)
        if (txt) st.lastUser = txt
      } else if (event?.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
        st.ring.push(event.data.chunk.usage?.reasoningTokens ?? 0)
        if (st.ring.length > config.maxRollingReqs * 2) st.ring.splice(0, st.ring.length - config.maxRollingReqs * 2)
      }
    }
    if (!config.durableCompress) return
    const isSurface = event?.type === 'user/message' || event?.type === 'assistant/message' || event?.type === 'tool/result'
    if (!isSurface) return

    const fold = foldMap.get(session) ?? []
    const op = event.surfaceOp
    if (op === 'append') {
      fold.push({ seq: event.seq })
    } else if (op && typeof op === 'object' && op.op === 'replace') {
      // start/end 是 seq（不是索引）
      const s = fold.findIndex((n) => n.seq === op.start)
      const e = fold.findIndex((n) => n.seq === op.end)
      if (s >= 0 && e >= 0) fold.splice(s, e - s + 1, { seq: event.seq })
    }

    // 命中大 tool/result → 记录待替换（延迟执行）
    if (event.type === 'tool/result') {
      const msg = event.data?.message
      const blob = extractBigText(msg, effMax(session?.id), config.maxLines)
      if (blob !== null) {
        const idx = fold.length - 1
        record(session, 'durable-candidate', {
          seq: event.seq,
          index: idx,
          chars: blob.length,
        })
        setImmediate(() => {
          try {
            compactDurable(session, event, fold, idx, blob)
          } catch (error: any) {
            recordError('durable replace failed', error)
          }
        })
      }
    }
    foldMap.set(session, fold)
  })

  function compactDurable(session: any, oldEvent: any, fold: Array<{ seq: number }>, _oldIndex: number, fullText: string): void {
    // 重新定位：若该 seq 已被 shadow 或位置变动则放弃
    const cur = fold.findIndex((n) => n.seq === oldEvent.seq)
    if (cur < 0) {
      record(session, 'durable-skip', { reason: 'seq-not-active', seq: oldEvent.seq })
      return
    }
    const agentId: string | null = session?.id ?? null
    const oldData = oldEvent.data
    const oldMsg = oldData?.message
    const toolCallId: string | undefined = oldMsg?.content?.[0]?.toolCallId
    const preview = deterministicPreview(fullText, effHead(session?.id), effTail(session?.id))

    let artifactPath: string | null = null
    if (metricsDir) artifactPath = writeArtifact(agentId, 'tool', toolCallId ?? String(oldEvent.seq), fullText)

    // tool/result 重写契约（assertToolResultRewrite）：只允许改 message.content[0].content，
    // 其余字段必须逐项一致 → 用 structuredClone 深拷贝原 data 仅替换内层内容。
    const newData = structuredClone(oldData)
    const block: any = newData?.message?.content?.[0]
    if (!block || block.type !== 'tool-result') {
      record(session, 'durable-skip', { reason: 'not-tool-result-shape', seq: oldEvent.seq })
      return
    }
    block.content = [{
      type: 'text',
      text: preview + (artifactPath ? `\n[OPTab artifact: ${artifactPath}]` : ''),
    }]

    const surfaceOp = { op: 'replace', start: oldEvent.seq, end: oldEvent.seq } as const
    const sourceEventSeqs = [oldEvent.seq]

    const appended = session.append(
      'tool/result',
      newData,
      { surfaceOp, sourceEventSeqs },
    )
    record(session, 'durable-replaced', {
      seq: oldEvent.seq,
      replacedBySeq: appended.seq,
      index: cur,
      inChars: fullText.length,
      outChars: preview.length,
      savedChars: fullText.length - preview.length,
      artifact: artifactPath,
    })
  }

  // ═══ 生命周期 ════════════════════════════════════════════════════════════
  ctx.effect(() => () => {
    record(null, 'dispose', {})
  }, '@dsh-external/dsh-optab: dispose')
}

/** 提取工具结果里的最大文本块；超阈值返回全文，否则 null。 */
function extractBigText(
  message: any,
  maxChars: number,
  maxLines: number,
): string | null {
  try {
    const content = message?.content
    if (!Array.isArray(content)) return null
    for (const block of content) {
      if (block?.type !== 'tool-result' || !Array.isArray(block.content)) continue
      for (const cb of block.content) {
        if (cb?.type === 'text' && typeof cb.text === 'string') {
          if (cb.text.length > maxChars || countLines(cb.text) > maxLines) return cb.text
          break
        }
      }
    }
  } catch {
    return null
  }
  return null
}
