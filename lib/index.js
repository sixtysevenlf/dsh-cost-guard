/**
 * dsh-cost-guard: 对 DeepSeek V4-Flash-0731（纯 API 计价）的成本守卫插件。
 *
 * 只做「钱」的事，不碰 persona/sections（路由/模式归 router / mode-boost 管）：
 *   1. 用量采集：从 durable 会话事件折叠 provider 用量（输入/输出/缓存命中/缓存写/推理）。
 *   2. 定价核算：按官方 2026-08-17 峰谷分级费率（Flash/Pro 自动选档、高峰自动切换）。
 *   3. 预算守卫：按项目（工作目录）设 ¥ 预算，超支时注入一次「收敛交付」近场引导（前缀缓存中性）。
 *   4. 峰谷感知 + 错峰队列：cost_defer 登记，daemon 空闲时段自动执行。
 *   5. 图形界面：client 面板（conversation.view slot）读 /cost-guard/api 监控数据、
 *      切换 enabled 开关（~/.dsh/cost-guard/config.json），可看队列与结果。
 *
 * 零外部依赖（内联 schema 编译器 + node:fs）。近场引导只在离散事件（超支/用户调用）触发。
 */

import {
  appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  ZERO, addUsage, usageOf, totalsOfEventsDedup, lastTurnOf, ratesFor, isPeakHour, nextWindow,
  costOf, savingsOf, hitRate, fmtYuan, fmtPct,
  GUIDE_CONVERGE, GUIDE_BUDGET, GUIDE_DEEP, GUIDE_OFFPEAK,
} from './core.js?v=3' // v=3：ESM 按 URL 缓存，热重载须换 query

/** 设置预算上限时向用户解释「收敛」与「预算上限」的关系（面板 note + 工具返回共用）。 */
const BUDGET_RELATION_NOTE = '收敛与预算的关系：预算=目标线，超支时自动注入一次「收敛交付」引导（最少步骤直接交付）；收敛不硬中断会话，是超支后的止损兜底。建议配合首轮收敛（Router Flash + 成本守卫 预设或任务收敛后缀）——先收敛少花、超支再止损。仅设预算但未开启守卫时不生效。'
/** 每天第一次设置预算时才提醒一次（跨 API/工具共享，先到先得）。 */
const budgetNoteDue = () => {
  const d = new Date()
  const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  const file = join(BASE, 'budget-note-day.txt')
  try {
    const last = existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
    if (last === today) return false
    writeFileSync(file, today, 'utf8')
    return true
  } catch { return true }
}

export const name = 'cost-guard'

export const inject = ['tools', 'llm', 'webServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const BASE = join(DSH_HOME, 'cost-guard')
const CONFIG_FILE = join(BASE, 'config.json')
const QUEUE_FILE = join(BASE, 'queue.json')
const ROUTE_FILE = join(BASE, 'route.json')
const LEDGER_FILE = join(BASE, 'ledger.json')
const RESULTS_DIR = join(BASE, 'results')

/** Minimal spec → JSON Schema（defineTool 子集）。 */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function log(entry) {
  try {
    appendFileSync(join(BASE, 'activity.jsonl'), `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`, 'utf8')
  } catch { /* best-effort */ }
}

function loadConfig() {
  try { return { enabled: false, ...(existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) : {}) } }
  catch { return { enabled: false } }
}
function saveConfig(config) {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8') } catch {}
}

function loadQueue() {
  try {
    const parsed = JSON.parse(existsSync(QUEUE_FILE) ? readFileSync(QUEUE_FILE, 'utf8') : '{"items":[]}')
    return { items: Array.isArray(parsed.items) ? parsed.items : [] }
  } catch { return { items: [] } }
}
function saveQueue(q) {
  try { writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2), 'utf8') } catch {}
}
function saveRoute(route) {
  try { if (!existsSync(ROUTE_FILE)) writeFileSync(ROUTE_FILE, JSON.stringify(route, null, 2), 'utf8') } catch {}
}
function readRoute() {
  try { return existsSync(ROUTE_FILE) ? JSON.parse(readFileSync(ROUTE_FILE, 'utf8')) : null } catch { return null }
}
function loadLedger() {
  try { return JSON.parse(existsSync(LEDGER_FILE) ? readFileSync(LEDGER_FILE, 'utf8') : '{}') } catch { return {} }
}
function saveLedger(ledger) {
  try { writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2), 'utf8') } catch {}
}
/** 按窗口聚合 ledger：本周（近 7 天）/ 本月（当前自然月）/ 今日。 */
function aggregatePeriods(ledger) {
  const now = new Date()
  const nowMs = now.getTime()
  const weekAgo = nowMs - 7 * 864e5
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const agg = (fromMs) => {
    let cost = 0, cached = 0, uncached = 0, output = 0, sessions = 0
    for (const e of Object.values(ledger)) {
      if (new Date(e.updatedAt).getTime() < fromMs) continue
      cost += e.cost ?? 0
      cached += e.tokens?.cached ?? 0
      uncached += (e.tokens?.input ?? 0) + (e.tokens?.write ?? 0)
      output += (e.tokens?.output ?? 0) + (e.tokens?.reasoning ?? 0)
      sessions += 1
    }
    const billed = cached + uncached
    return { cost, sessions, output, hitRate: billed > 0 ? cached / billed : 0 }
  }
  return { week: agg(weekAgo), month: agg(monthStart), today: agg(dayStart) }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    if (req && typeof req[Symbol.asyncIterator] === 'function') {
      (async () => { for await (const chunk of req) buf += chunk })().catch(() => {}).then(() => resolve(buf))
      return
    }
    req.on?.('data', (c) => { buf += c })
    req.on?.('end', () => resolve(buf))
    req.on?.('error', () => resolve(buf))
    setTimeout(() => resolve(buf), 1500)
  })
}

export function apply(ctx) {
  const agents = new Map()       // session id -> Agent
  const liveUsage = new Map()    // session id -> 运行时增量用量桶
  const overrunNotified = new Set() // project key -> 已提醒
  const lastConvergeMsg = new Map() // session id -> 最近一次「收敛」按钮注入的 inbox 消息 id（可取消）
  const convergeInjected = new Set() // session id -> 已注入过「开局首轮收敛」引导（每会话一次）
  let config = loadConfig()
  // 项目级开关/预算（持久化在 config.projects，key = 工作目录 cwd）：
  // 显式项目设置 > 全局默认。全局默认关（enabled=false）→ 只有选了成本守卫预设 /
  // 面板逐项目打开 / cost_enable 的项目开启。
  config.projects ??= {}
  const projectFlags = new Map()
  const projectBudgets = new Map()
  for (const [project, value] of Object.entries(config.projects)) {
    if (value && typeof value === 'object') {
      if ('enabled' in value) projectFlags.set(project, Boolean(value.enabled))
      if ('budget' in value) projectBudgets.set(project, Number(value.budget))
    }
  }
  const sessionProject = new Map() // session id -> project key
  const pendingSessionFlags = new Map() // session id -> bool（预设事件早于 agent 捕获时暂存）
  const projectOfSession = (session) => {
    const key = (session && (session.header?.cwd || session.cwd)) || session?.id
    if (session?.id) sessionProject.set(session.id, key)
    return key
  }
  const projectOfId = (sessionId) => {
    const agent = agents.get(sessionId)
    if (agent?.session) return projectOfSession(agent.session)
    const cached = sessionProject.get(sessionId)
    if (cached) return cached
    const ledger = loadLedger()
    return ledger[sessionId]?.project || sessionId
  }
  const projectName = (project) => {
    if (!project) return '?'
    const parts = String(project).replace(/\\/g, '/').split('/').filter(Boolean)
    return parts.at(-1) || project
  }
  const enabledForProject = (project) => (projectFlags.has(project) ? projectFlags.get(project) : config.enabled)
  const enabledForSession = (session) => enabledForProject(projectOfSession(session))
  const enabledForId = (sessionId) => enabledForProject(projectOfId(sessionId))
  const budgetForProject = (project) => (projectBudgets.has(project) ? projectBudgets.get(project) : undefined)
  const writeProject = (project, patch) => {
    const current = config.projects[project] && typeof config.projects[project] === 'object' ? { ...config.projects[project] } : {}
    Object.assign(current, patch)
    for (const key of Object.keys(current)) if (current[key] === undefined) delete current[key]
    if (Object.keys(current).length === 0) delete config.projects[project]
    else config.projects[project] = current
    saveConfig(config)
  }
  const setProjectFlag = (project, value) => {
    if (value === null || value === undefined) {
      projectFlags.delete(project)
      writeProject(project, { enabled: undefined })
      return
    }
    const v = Boolean(value)
    projectFlags.set(project, v)
    writeProject(project, { enabled: v })
  }
  const setProjectBudget = (project, value) => {
    const v = Number(value)
    if (!Number.isFinite(v) || v <= 0) {
      projectBudgets.delete(project)
      writeProject(project, { budget: undefined })
      return
    }
    projectBudgets.set(project, v)
    writeProject(project, { budget: v })
  }
  // ── 会话级预算 / 下一个新会话预算（独立于项目级预算，持久化到 session-budgets.json）──
  // 层级：会话级（sessionId）> 新会话预置（next，一次性消费给该目录下一个新建的顶层会话）> 项目级（目录）。
  const SESSION_BUDGETS_FILE = join(BASE, 'session-budgets.json')
  const loadSessionBudgets = () => {
    try { return JSON.parse(existsSync(SESSION_BUDGETS_FILE) ? readFileSync(SESSION_BUDGETS_FILE, 'utf8') : '{}') } catch { return {} }
  }
  const saveSessionBudgets = (data) => {
    try { writeFileSync(SESSION_BUDGETS_FILE, JSON.stringify(data, null, 2), 'utf8') } catch {}
  }
  const sbData = loadSessionBudgets()
  const sessionBudgets = new Map(Object.entries(sbData.sessions ?? {})) // sessionId -> ¥
  const convergedSessions = new Set(Array.isArray(sbData.converged) ? sbData.converged : []) // sessionId -> 会话级收敛开关（持久）
  let pendingNextBudget = null // {project, budget}：下一个在该目录新建的顶层会话生效一次
  if (sbData.next && typeof sbData.next.project === 'string' && Number.isFinite(Number(sbData.next.budget)) && Number(sbData.next.budget) > 0) {
    pendingNextBudget = { project: sbData.next.project, budget: Number(sbData.next.budget) }
  }
  const persistSessionBudgets = () => {
    saveSessionBudgets({ next: pendingNextBudget, sessions: Object.fromEntries(sessionBudgets), converged: [...convergedSessions] })
  }
  /** 会话的有效预算：会话级 > 项目级；返回 {budget, scope, project}。 */
  const budgetOf = (session) => {
    const project = projectOfSession(session)
    const sb = session?.id ? sessionBudgets.get(session.id) : undefined
    if (sb !== undefined) return { budget: sb, scope: 'session', project }
    const pb = budgetForProject(project)
    if (pb !== undefined) return { budget: pb, scope: 'project', project }
    return { budget: undefined, scope: 'none', project }
  }
  /** 把会话当前快照写入 ledger（跨会话/跨重启聚合用），并裁剪 31 天前的旧会话。 */
  function upsertLedger(session) {
    const ledger = loadLedger()
    const model = modelOf(session)
    const totals = sessionTotals(session)
    const now = new Date()
    const rates = ratesFor(model, now)
    const c = costOf(totals, rates)
    const billed = totals.input + totals.write + totals.cached
    ledger[session.id] = {
      model,
      project: projectOfSession(session),
      cost: c.yuan,
      saved: savingsOf(totals, rates),
      hitRate: billed > 0 ? totals.cached / billed : 0,
      tokens: { input: totals.input, cached: totals.cached, write: totals.write, output: totals.output, reasoning: totals.reasoning },
      updatedAt: now.toISOString(),
    }
    const cutoff = Date.now() - 31 * 864e5
    for (const key of Object.keys(ledger)) {
      if (new Date(ledger[key].updatedAt).getTime() < cutoff) delete ledger[key]
    }
    saveLedger(ledger)
    return ledger
  }
  const activityAt = new Map() // session id -> 最近活动时间（决定「当前项目」展示）
  mkdirSync(RESULTS_DIR, { recursive: true })

  // 项目级开关事件：agent 平面预设插件（cost-guard-enable.mjs）在首轮 assemble 时
  // emit('cost-guard/session-set', sessionId, true, projectKey) —— cordis 事件沿
  // scope 链冒泡到 host。若 project 未随事件传来，则暂存到 agent 捕获后再落项目。
  ctx.on('cost-guard/session-set', (sessionId, enabled, project) => {
    if (typeof sessionId !== 'string') return
    const agent = agents.get(sessionId)
    const key = typeof project === 'string' && project
      ? project
      : (agent?.session ? projectOfSession(agent.session) : null)
    if (key) {
      setProjectFlag(key, Boolean(enabled))
      log({ event: 'session-set', session: sessionId.slice(0, 8), project: key, enabled: Boolean(enabled) })
    } else {
      pendingSessionFlags.set(sessionId, Boolean(enabled))
      log({ event: 'session-set-pending', session: sessionId.slice(0, 8), enabled: Boolean(enabled) })
    }
  })

  // ── 会话句柄捕获（可靠来源：assemble 一定触发）───────────────────────────
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent !== undefined && agent.session !== undefined) {
      const firstCapture = !agents.has(agent.session.id)
      agents.set(agent.session.id, agent)
      activityAt.set(agent.session.id, Date.now())
      const project = projectOfSession(agent.session)
      if (pendingSessionFlags.has(agent.session.id)) {
        setProjectFlag(project, pendingSessionFlags.get(agent.session.id))
        pendingSessionFlags.delete(agent.session.id)
      }
      // 「新会话预算」一次性消费：只给该目录下一个新建的顶层会话（排除子代理）
      if (firstCapture && pendingNextBudget && pendingNextBudget.project === project && agent.session.header?.meta?.origin !== 'subagent') {
        sessionBudgets.set(agent.session.id, pendingNextBudget.budget)
        pendingNextBudget = null
        persistSessionBudgets()
        log({ event: 'session-budget-consumed', session: agent.session.id.slice(0, 8), project, budget: sessionBudgets.get(agent.session.id) })
      }
      if (agent.options?.provider && agent.options?.model) saveRoute(agent.options)
      if (enabledForSession(agent.session)) checkBudget(agent.session)
    }
    return assembled
  })

  // ── 用量采集 + 预算守卫（补充）───────────────────────────────────────────
  ctx.on('session/event', (session, event) => {
    activityAt.set(session.id, Date.now())
    const usage = usageOf(event)
    if (usage) {
      const total = liveUsage.get(session.id) ?? { ...ZERO }
      addUsage(total, usage)
      liveUsage.set(session.id, total)
    }
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      if (enabledForSession(session)) checkBudget(session)
      maybeAutoDeep(session)
    }
  })

  function checkBudget(session) {
    const project = projectOfSession(session)
    const eff = budgetOf(session)
    if (eff.budget === undefined) return
    const notifiedKey = eff.scope === 'session' ? `s:${session.id}` : `p:${project}`
    const totals = sessionTotals(session)
    const { yuan } = costOf(totals, ratesFor(modelOf(session)))
    if (yuan > eff.budget && !overrunNotified.has(notifiedKey)) {
      overrunNotified.add(notifiedKey)
      injectGuide(session, GUIDE_BUDGET)
      log({ event: 'budget-overrun', session: session.id, project, yuan, budget: eff.budget, scope: eff.scope })
    }
  }

  // ── 自动深度分流（可选保险，默认关）：config.json 里 config.autoDeep.enabled=true 开启 ──
  // 复杂度关键词命中 + 消息够长 + 本会话未注入过深度引导 + 用户未手动点「收敛」→ 注入一次 GUIDE_DEEP
  const DEEP_KEYWORDS = ['重构', '架构', '设计方案', '系统设计', '评审', '迁移', '集成', '性能', '复杂', '大规模', '分布式', '微服务', '并发', '安全', '数据库', '算法', '从零构建', '框架', '长期', '拆解', '兼容', '边界情况', '单元测试', '设计文档', '方案']
  const deepInjectedId = new Set() // session id -> 已注入过自动深度引导（每会话一次）
  function lastUserText(session) {
    const events = session && session.events ? session.events : []
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (ev.type !== 'user/message' || ev.data?.source?.kind !== 'user') continue
      const c = ev.data?.message?.content
      if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('')
      return ''
    }
    return ''
  }
  function maybeAutoDeep(session) {
    const cfg = config.autoDeep
    if (!cfg || !cfg.enabled) return
    if (deepInjectedId.has(session.id)) return
    const text = lastUserText(session)
    if (!text) return
    if (text.length < Number(cfg.minChars ?? 40)) return
    const kws = Array.isArray(cfg.keywords) && cfg.keywords.length ? cfg.keywords : DEEP_KEYWORDS
    const hit = kws.find((k) => text.includes(k))
    if (hit === undefined) return
    // 用户本会话手动点过「收敛」或会话处于收敛模式 → 尊重手动选择，不叠加矛盾的深度指令
    if (lastConvergeMsg.has(session.id) || convergedSessions.has(session.id)) return
    const msgId = injectGuide(session, GUIDE_DEEP, true)
    if (msgId !== null) {
      deepInjectedId.add(session.id)
      log({ event: 'auto-deep', session: session.id.slice(0, 8), project: projectOfId(session.id), keyword: hit, chars: text.length })
    }
  }

  /** force=true 时无视守卫开关（输入框「收敛」按钮 = 用户显式意图，守卫未开也注入）。返回注入消息的 id（可取消），失败返回 null。 */
  function injectGuide(session, text, force = false) {
    if (!force && !enabledForSession(session)) return null
    try {
      const agent = currentAgent()
      const target = agent !== undefined && agent.session === session ? agent : [...agents.values()].find((a) => a.session === session)
      if (target === undefined || target.inbox === undefined || target.inbox.append === undefined) return null
      const message = {
        id: `cost-guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        source: { kind: 'plugin', plugin: 'cost-guard' },
        content: [{ type: 'text', text }],
      }
      target.inbox.append('next-step', message)
      return message.id
    } catch { return null }
  }

  function sessionTotals(session) {
    const durable = totalsOfEventsDedup(session.events)
    const live = liveUsage.get(session.id)
    if (!live) return durable
    return {
      input: Math.max(durable.input, live.input),
      cached: Math.max(durable.cached, live.cached),
      write: Math.max(durable.write, live.write),
      output: Math.max(durable.output, live.output),
      reasoning: Math.max(durable.reasoning, live.reasoning),
    }
  }

  function modelOf(session) {
    const agent = [...agents.values()].find((a) => a.session === session)
    return agent?.options?.model ?? readRoute()?.model ?? null
  }

  function currentSession() {
    const agent = ctx.get('agent')
    if (agent !== undefined && agent.session !== undefined) return agent.session
    return [...agents.values()].at(-1)?.session
  }
  function currentAgent() {
    const session = currentSession()
    return session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
  }

  /** 汇总快照（UI 与 cost_status 共用）。 */
  function stateSnapshot(forceSessionId) {
    const now = new Date()
    const peak = isPeakHour(now)
    const sessions = []
    for (const [id, agent] of agents) {
      const project = projectOfSession(agent.session)
      const model = agent.options?.model ?? null
      const totals = sessionTotals(agent.session)
      const rates = ratesFor(model, now)
      const c = costOf(totals, rates)
      const lt = lastTurnOf(agent.session.events)
      sessions.push({
        id: id.slice(0, 8),
        fullId: id,
        project,
        projectName: projectName(project),
        enabled: enabledForProject(project),
        override: projectFlags.has(project),
        model,
        status: peak ? 'peak' : 'off-peak',
        rates,
        totals,
        cost: c.yuan,
        hitRate: hitRate(totals),
        savings: savingsOf(totals, rates),
        budget: budgetForProject(project) ?? null,
        sessionBudget: sessionBudgets.get(id) ?? null,
        lastMessage: lt ? {
          turn: lt.turn,
          cost: costOf(lt.totals, rates).yuan,
          tokens: lt.totals,
          hitRate: hitRate(lt.totals),
        } : null,
      })
    }
    const ledger = upsertLedgerSafe(sessions, agents)
    // 历史会话（ledger 里非活跃的）也列出：按项目归组后可单独看/单独切开关（开关持久化）
    for (const [id, e] of Object.entries(ledger)) {
      if (sessions.some((s) => s.fullId === id)) continue
      const project = e.project || id
      sessionProject.set(id, project)
      sessions.push({
        id: id.slice(0, 8),
        fullId: id,
        project,
        projectName: projectName(project),
        enabled: enabledForProject(project),
        override: projectFlags.has(project),
        model: e.model ?? null,
        archived: true,
        cost: e.cost ?? 0,
        hitRate: e.hitRate ?? 0,
        tokens: e.tokens ?? null,
        savings: e.savings ?? 0,
        budget: budgetForProject(project) ?? null,
        sessionBudget: sessionBudgets.get(id) ?? null,
      })
    }
    sessions.sort((a, b) => b.cost - a.cost)

    // 按项目聚合（一个工作目录 = 一个项目，所有会话共享同一开关/预算）
    const projectMap = new Map()
    for (const s of sessions) {
      let p = projectMap.get(s.project)
      if (!p) {
        p = {
          key: s.project,
          name: s.projectName,
          enabled: s.enabled,
          override: s.override,
          budget: s.budget,
          nextBudget: pendingNextBudget && pendingNextBudget.project === s.project ? pendingNextBudget.budget : null,
          sessions: [],
          cost: 0,
          hitRate: 0,
          model: s.model ?? null,
          totals: { input: 0, cached: 0, write: 0, output: 0, reasoning: 0 },
          rates: s.rates ?? null,
          savings: 0,
          lastMessage: null,
          status: s.status ?? (peak ? 'peak' : 'off-peak'),
        }
        projectMap.set(s.project, p)
      }
      p.sessions.push({ id: s.id, fullId: s.fullId, archived: s.archived, cost: s.cost ?? 0, hitRate: s.hitRate ?? 0, savings: s.savings ?? 0, tokens: s.totals ?? s.tokens ?? null, sessionBudget: s.sessionBudget ?? null })
      p.sessions.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      p.cost += s.cost ?? 0
      p.savings += s.savings ?? 0
      if (s.totals) {
        p.totals.input += s.totals.input ?? 0
        p.totals.cached += s.totals.cached ?? 0
        p.totals.write += s.totals.write ?? 0
        p.totals.output += s.totals.output ?? 0
        p.totals.reasoning += s.totals.reasoning ?? 0
      }
      if (s.lastMessage && !p.lastMessage) p.lastMessage = s.lastMessage
      if (s.model) p.model = s.model
      if (s.rates) p.rates = s.rates
    }
    for (const p of projectMap.values()) {
      const billed = p.totals.input + p.totals.write + p.totals.cached
      p.hitRate = billed > 0 ? p.totals.cached / billed : 0
      if (p.rates) p.savings = savingsOf(p.totals, p.rates)
    }
    const projects = [...projectMap.values()].sort((a, b) => b.cost - a.cost)

    // 「当前项目」：优先客户端指定的会话（forceSessionId），否则取最近活动会话
    let latestId = forceSessionId ?? null
    if (!latestId) {
      let latestAt = -1
      for (const [id, at] of activityAt) if (at > latestAt) { latestAt = at; latestId = id }
      if (!latestId) latestId = currentSession()?.id ?? null
    }
    const latestProjectKey = latestId ? projectOfId(latestId) : (projects[0]?.key ?? null)
    const latest = latestProjectKey ? projects.find((p) => p.key === latestProjectKey) ?? null : projects[0] ?? null
    return {
      enabled: config.enabled,
      sessionEnabled: latest ? latest.enabled : config.enabled,
      sessionOverride: latest ? latest.override : false,
      autoDeep: Boolean(config.autoDeep?.enabled),
      sessionConverged: latestId ? convergedSessions.has(latestId) : false,
      config: { ...config },
      now: now.toISOString(),
      peak,
      latest,
      projects,
      sessions: sessions.slice(0, 50),
      periods: aggregatePeriods(ledger),
      queue: loadQueue().items,
      results: listResults(),
    }
  }

  /** 轮询快照时把活动会话写入 ledger（节流：每会话 60s 最多写一次）。 */
  const ledgerAt = new Map()
  function upsertLedgerSafe(sessions, agentsMap) {
    for (const [id, agent] of agentsMap) {
      const last = ledgerAt.get(id) ?? 0
      if (Date.now() - last < 60e3) continue
      ledgerAt.set(id, Date.now())
      upsertLedger(agent.session)
    }
    return loadLedger()
  }

  function listResults(limit = 20) {
    const out = []
    try {
      const names = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'))
      names.sort((a, b) => statSync(join(RESULTS_DIR, b)).mtimeMs - statSync(join(RESULTS_DIR, a)).mtimeMs)
      for (const f of names.slice(0, limit)) {
        try {
          const d = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8'))
          out.push({ id: d.id ?? f, finishedAt: d.finishedAt, peak: d.peak, chars: d.text?.length ?? d.chars ?? 0, usage: d.usage ?? null, head: (d.text ?? '').slice(0, 160) })
        } catch { /* skip broken */ }
      }
    } catch { /* results dir unavailable */ }
    return out
  }

  // ── 图形界面 host API：/cost-guard/api ───────────────────────────────────
  // GET  /api/state                       → 监控快照
  // POST /api/enable   {enabled:boolean}  → 启用/停用成本守卫（持久化）
  // POST /api/budget   {budget:number}    → 设最近项目预算（0 = 清除）
  // POST /api/project/remove {project[,sessionId]} → 删除项目统计（带 sessionId 时仅删该会话）
  // POST /api/converge {sessionId?}      → 输入框「收敛」按钮：立即对当前会话注入一次收敛引导
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/cost-guard/api',
    handler: async (req, res) => {
      const send = (obj) => {
        try {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(obj))
        } catch { /* socket closed */ }
      }
      const path = String(req.url || '').split('?')[0].replace(/^\/cost-guard\/api/, '') || '/'
      const method = String(req.method || 'GET').toUpperCase()
      try {
        if (method === 'GET' || method === 'POST') {
          // 输入框「收敛」按钮 = 会话级收敛开关：开 → 注入一次收敛引导并进入收敛模式（持续）；再点 → 关闭并撤回未消费的引导
          if (path === '/converge' && method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            let sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : currentSession()?.id
            if (!sessionId) return send({ ok: false, error: 'no session' })
            const agent = agents.get(sessionId)
            if (!agent?.session) return send({ ok: false, error: 'session not captured' })
            const project = projectOfSession(agent.session)
            if (convergedSessions.has(sessionId)) {
              // 关闭：撤回未消费的收敛引导，退出会话收敛模式
              const msgId = lastConvergeMsg.get(sessionId)
              if (msgId && agent.inbox && typeof agent.inbox.remove === 'function') {
                try { agent.inbox.remove(msgId) } catch { /* 已消费则忽略 */ }
              }
              lastConvergeMsg.delete(sessionId)
              convergedSessions.delete(sessionId)
              persistSessionBudgets()
              log({ event: 'converge-off', session: sessionId.slice(0, 8), project })
              return send({ ok: true, converged: false, sessionId, project })
            }
            // 开：注入一次收敛引导并进入收敛模式（持久，上下文残留持续施加收敛压力）
            const msgId = injectGuide(agent.session, GUIDE_CONVERGE, true)
            if (msgId === null) return send({ ok: false, error: 'inbox unavailable' })
            lastConvergeMsg.set(sessionId, msgId)
            convergedSessions.add(sessionId)
            persistSessionBudgets()
            log({ event: 'converge-on', session: sessionId.slice(0, 8), project, msgId })
            return send({ ok: true, converged: true, convergeMsgId: msgId, sessionId, project })
          }
          // 兼容旧调用：取消收敛 = 关闭会话收敛开关
          if (path === '/converge/cancel' && method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            let sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : currentSession()?.id
            if (!sessionId) return send({ ok: false, error: 'no session' })
            const agent = agents.get(sessionId)
            const msgId = lastConvergeMsg.get(sessionId)
            if (msgId && agent?.inbox && typeof agent.inbox.remove === 'function') {
              try { agent.inbox.remove(msgId) } catch { /* 已消费则忽略 */ }
            }
            lastConvergeMsg.delete(sessionId)
            convergedSessions.delete(sessionId)
            persistSessionBudgets()
            log({ event: 'converge-cancel', session: sessionId.slice(0, 8) })
            return send({ ok: true, converged: false, sessionId })
          }
          if (path === '/' || path === '/state') {
            // 客户端把「当前正在查看的会话」经 query 传过来 → 面板即时跟随切换，
            // 不再依赖「最近活动会话」推断（新会话无活动时会推断失败/延迟）。
            let forced = null
            try {
              const u = new URL(String(req.url || ''), 'http://x')
              const sid = u.searchParams.get('session')
              if (sid) {
                forced = String(sid)
                const projectParam = u.searchParams.get('project')
                if (agents.has(forced) || sessionProject.has(forced) || loadLedger()[forced]) {
                  activityAt.set(forced, Date.now())
                } else if (projectParam) {
                  sessionProject.set(forced, String(projectParam))
                  activityAt.set(forced, Date.now())
                }
              }
            } catch { /* 非法 query 忽略，回落活动推断 */ }
            return send({ ok: true, ...stateSnapshot(forced) })
          }
          if (path === '/enable' && method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const value = Boolean(body.enabled)
            if (body.scope === 'project' || body.scope === 'session') {
              let project = typeof body.project === 'string' && body.project ? body.project : null
              if (!project) {
                const sessionId = typeof body.sessionId === 'string' && body.sessionId
                  ? body.sessionId
                  : currentSession()?.id
                if (sessionId) project = projectOfId(sessionId)
              }
              if (!project) return send({ ok: false, error: 'no project' })
              setProjectFlag(project, value)
              log({ event: 'ui-enable-project', project, enabled: value })
              return send({ ok: true, enabled: value, scope: 'project', project })
            }
            config = { ...config, enabled: value }
            saveConfig(config)
            log({ event: 'ui-enable', enabled: value })
            return send({ ok: true, enabled: value, scope: 'global' })
          }
          if (path === '/budget' && method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const value = Number(body.budget)
            if (!Number.isFinite(value) || value < 0) return send({ ok: false, error: `invalid budget ${body.budget}` })
            const scope = String(body.scope ?? 'project')
            if (scope === 'session') {
              let sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : currentSession()?.id
              if (!sessionId) return send({ ok: false, error: 'no session' })
              if (value === 0) sessionBudgets.delete(sessionId)
              else sessionBudgets.set(sessionId, value)
              overrunNotified.delete('s:' + sessionId)
              persistSessionBudgets()
              log({ event: 'ui-budget-session', session: sessionId.slice(0, 8), budget: value })
              return send({ ok: true, budget: value, scope: 'session', sessionId, ...(budgetNoteDue() ? { note: BUDGET_RELATION_NOTE } : {}) })
            }
            if (scope === 'next') {
              let project = typeof body.project === 'string' && body.project ? body.project : null
              if (!project) {
                const session = currentSession()
                if (session) project = projectOfSession(session)
              }
              if (!project) return send({ ok: false, error: 'no project' })
              if (value === 0) pendingNextBudget = null
              else pendingNextBudget = { project, budget: value }
              persistSessionBudgets()
              log({ event: 'ui-budget-next', project, budget: value })
              return send({ ok: true, budget: value, scope: 'next', project, ...(budgetNoteDue() ? { note: BUDGET_RELATION_NOTE } : {}) })
            }
            let project = typeof body.project === 'string' && body.project ? body.project : null
            if (!project) {
              const session = currentSession()
              if (session) project = projectOfSession(session)
            }
            if (!project) return send({ ok: false, error: 'no project' })
            setProjectBudget(project, value)
            overrunNotified.delete('p:' + project)
            return send({ ok: true, budget: value, project, ...(budgetNoteDue() ? { note: BUDGET_RELATION_NOTE } : {}) })
          }
          // POST /autodeep {enabled} → 自动深度分流全局开关（持久化 config.json）
          if (path === '/autodeep' && method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const value = Boolean(body.enabled)
            config.autoDeep = { ...(config.autoDeep ?? {}), enabled: value }
            saveConfig(config)
            deepInjectedId.clear()
            log({ event: 'ui-autodeep', enabled: value })
            return send({ ok: true, autoDeep: value })
          }
          // POST /project/remove {project} → 从统计中彻底删除一个项目（清除该目录全部会话的 ledger 历史、
          // 项目级开关/预算配置与缓存）；带 {sessionId} 时只删除该会话一条统计（目录下按会话细分删除）。
          if (path === '/project/remove' && method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const project = typeof body.project === 'string' && body.project ? body.project : null
            const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null
            if (!project) return send({ ok: false, error: 'no project' })
            const ledger = loadLedger()
            let removed = 0
            if (sessionId) {
              if (ledger[sessionId]) { delete ledger[sessionId]; removed = 1 }
              saveLedger(ledger)
              sessionProject.delete(sessionId)
              sessionBudgets.delete(sessionId)
              overrunNotified.delete('s:' + sessionId)
              persistSessionBudgets()
              log({ event: 'session-remove', project, session: sessionId.slice(0, 8), removed })
              return send({ ok: true, removed, project, sessionId })
            }
            for (const key of Object.keys(ledger)) {
              if (ledger[key].project === project) { delete ledger[key]; removed += 1; sessionBudgets.delete(key) }
            }
            saveLedger(ledger)
            if (config.projects && config.projects[project]) {
              delete config.projects[project]
              saveConfig(config)
            }
            projectFlags.delete(project)
            projectBudgets.delete(project)
            overrunNotified.delete('p:' + project)
            if (pendingNextBudget && pendingNextBudget.project === project) pendingNextBudget = null
            persistSessionBudgets()
            for (const [sid, key] of sessionProject) if (key === project) sessionProject.delete(sid)
            log({ event: 'project-remove', project, sessions: removed })
            return send({ ok: true, removed, project })
          }
        }
        send({ ok: false, error: `no route ${method} ${path}` })
      } catch (error) {
        send({ ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'cost-guard: web api')

  // ── 错峰队列 daemon ─────────────────────────────────────────────────────
  async function runQueued() {
    const q = loadQueue()
    const item = q.items.find((i) => i.status === 'queued')
    if (!item) return
    if (item.project && !enabledForProject(item.project)) {
      item.status = 'failed'
      item.error = 'cost-guard disabled for project'
      saveQueue(q)
      log({ event: 'defer-skip-disabled', id: item.id, project: item.project })
      return
    }
    if (!String(item.task ?? '').trim()) {
      item.status = 'failed'
      item.error = 'empty task'
      saveQueue(q)
      log({ event: 'defer-skip-empty', id: item.id })
      return
    }
    if (!item.project && !config.enabled) return
    if (isPeakHour()) { log({ event: 'defer-waiting', id: item.id }); return }
    item.status = 'running'
    saveQueue(q)
    const route = readRoute()
    const provider = item.provider ?? route?.provider
    const model = item.model ?? route?.model
    if (!provider || !model) {
      item.status = 'failed'
      item.error = 'no provider/model route'
      saveQueue(q)
      return
    }
    try {
      const stream = ctx.llm.stream({
        provider, model,
        messages: [{ role: 'user', content: [{ type: 'text', text: String(item.task) }] }],
        maxTokens: Number(item.maxTokens ?? 8000),
      })
      let text = ''
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text
      }
      writeFileSync(join(RESULTS_DIR, `${item.id}.json`), JSON.stringify({
        id: item.id, task: item.task, text,
        finishedAt: new Date().toISOString(), peak: isPeakHour(),
        usage: stream.usage ?? null,
      }, null, 2), 'utf8')
      item.status = 'done'
      item.chars = text.length
      item.result = `results/${item.id}.json`
      log({ event: 'defer-done', id: item.id, chars: text.length })
    } catch (error) {
      item.status = 'failed'
      item.error = String(error?.message ?? error)
      log({ event: 'defer-failed', id: item.id, error: item.error })
    }
    saveQueue(q)
  }
  try { ctx.setInterval(() => { void runQueued().catch(() => {}) }, 10 * 60 * 1000) } catch { /* timer 降级 */ }

  function addQueued(task, maxTokens, project) {
    const q = loadQueue()
    const item = { id: `defer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, task, maxTokens, project, createdAt: new Date().toISOString(), status: 'queued' }
    q.items.push(item)
    saveQueue(q)
    return item
  }

  // ── 工具注册 ─────────────────────────────────────────────────────────────
  const register = (tool) => ctx.effect(() => ctx.tools.register({
    ...tool,
    parameters: toJsonSchema(tool.parameters),
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
  }))

  register({
    name: 'cost_status',
    description: '成本守卫仪表盘：模型与峰谷、费率、当前项目累计用量、估算费用 ¥、缓存命中率、全命中可省金额、enabled 状态。',
    parameters: {},
    execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const model = modelOf(session)
      const totals = sessionTotals(session)
      const now = new Date()
      const peak = isPeakHour(now)
      const rates = ratesFor(model, now)
      const { yuan, uncached, cached, output } = costOf(totals, rates)
      const saved = savingsOf(totals, rates)
      const window = nextWindow(now)
      const lt = lastTurnOf(session.events)
      const lastMsg = lt ? `本消息 ${fmtYuan(costOf(lt.totals, rates).yuan)} (turn ${lt.turn}, hit=${fmtPct(hitRate(lt.totals))})` : '本消息 —'
      upsertLedger(session)
      const periods = aggregatePeriods(loadLedger())
      const project = projectOfSession(session)
      const scopeOn = enabledForSession(session)
      const scope = projectFlags.has(project) ? (scopeOn ? 'project-on' : 'project-off') : (config.enabled ? 'global-on' : 'global-off')
      const eff = budgetOf(session)
      const budget = eff.budget
      const budgetTxt = budget !== undefined ? `${fmtYuan(budget)} (${eff.scope === 'session' ? '会话级' : '项目级'})` : 'unset'
      const next = pendingNextBudget && pendingNextBudget.project === project ? fmtYuan(pendingNextBudget.budget) : null
      return [
        `enabled=${scopeOn ? 'on' : 'OFF'}  scope=${scope}  (default=${config.enabled ? 'on' : 'off'})`,
        `project=${projectName(project)}  ${project}`,
        `session=${session.id.slice(0, 8)}  model=${model ?? 'unknown'}`,
        `time=${now.toLocaleTimeString()}  status=${peak ? 'PEAK (×2)' : 'off-peak'}`,
        `rates(¥/M)  hit=${rates.hit}  miss=${rates.miss}  out=${rates.out}`,
        `tokens  input(uncached)=${uncached}  cacheRead=${cached}  cacheWrite=${totals.write}  output(+reasoning)=${output}`,
        `cache-hit-rate=${fmtPct(hitRate(totals))}  (缓存命中比未命中便宜 30×)`,
        `cost-so-far=${fmtYuan(yuan)}  (若全命中可降到 ${fmtYuan(yuan - saved)})`,
        `savings-if-all-cached=${fmtYuan(saved)}`,
        lastMsg,
        `period  week=${fmtYuan(periods.week.cost)} (${periods.week.sessions} 会话)  month=${fmtYuan(periods.month.cost)} (${periods.month.sessions})  today=${fmtYuan(periods.today.cost)}`,
        `next ${window.nextIs === 'peak' ? 'peak' : 'off-peak'} at ${window.next.toLocaleTimeString()}`,
        `budget=${budgetTxt}${next ? `  next-session=${next}` : ''}`,
      ].join('\n')
    },
  })

  register({
    name: 'cost_budget',
    description: '设置费用预算（¥），超支时自动注入一次「收敛交付」引导。scope=project 项目级（默认，该目录全部会话共享）/ session 当前会话级（只限本会话）/ next 下一个新会话（在该目录新建的下一个顶层会话生效一次）。budget=0 清除对应层级。',
    parameters: {
      budget: { type: 'number', required: true, description: '预算金额 ¥，0 表示清除' },
      scope: { type: 'string', enum: ['project', 'session', 'next'], description: '作用域：project（默认）/ session / next' },
    },
    execute(args) {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const project = projectOfSession(session)
      const value = Number(args.budget)
      if (!Number.isFinite(value) || value < 0) return `invalid budget "${args.budget}"`
      const scope = String(args.scope ?? 'project')
      if (scope === 'session') {
        if (value === 0) sessionBudgets.delete(session.id)
        else sessionBudgets.set(session.id, value)
        overrunNotified.delete('s:' + session.id)
        persistSessionBudgets()
        return `session=${session.id.slice(0, 8)}  budget=${value === 0 ? 'cleared' : fmtYuan(value)} (会话级，仅本会话)${budgetNoteDue() ? '\n提醒：' + BUDGET_RELATION_NOTE : ''}`
      }
      if (scope === 'next') {
        if (value === 0) pendingNextBudget = null
        else pendingNextBudget = { project, budget: value }
        persistSessionBudgets()
        return `next-session budget=${value === 0 ? 'cleared' : fmtYuan(value)} @ ${projectName(project)}（下一个新会话生效一次）${budgetNoteDue() ? '\n提醒：' + BUDGET_RELATION_NOTE : ''}`
      }
      setProjectBudget(project, value)
      overrunNotified.delete('p:' + project)
      const totals = sessionTotals(session)
      const { yuan } = costOf(totals, ratesFor(modelOf(session)))
      return `project=${projectName(project)}  budget=${fmtYuan(value)}  spent=${fmtYuan(yuan)}  remaining=${fmtYuan(Math.max(0, value - yuan))}${budgetNoteDue() ? '\n提醒：' + BUDGET_RELATION_NOTE : ''}`
    },
  })

  register({
    name: 'cost_peak',
    description: '报告当前峰谷状态、高峰时段（每日 09:00-12:00 / 14:00-18:00，=空闲×2）、下一个切换点与错峰建议。',
    parameters: {},
    execute() {
      const now = new Date()
      const window = nextWindow(now)
      const rates = ratesFor(readRoute()?.model ?? 'flash', now)
      return [
        `now=${now.toLocaleTimeString()}  ${isPeakHour(now) ? 'PEAK（高峰，单价×2）' : 'off-peak（空闲，半价）'}`,
        'peak windows: 每日 09:00-12:00 / 14:00-18:00（本地时区）',
        `next ${window.nextIs === 'peak' ? '高峰' : '空闲'} at ${window.next.toLocaleTimeString()}`,
        `rates(¥/M) hit=${rates.hit} miss=${rates.miss} out=${rates.out}`,
        '建议：批量/非交互重活登记 cost_defer 让 daemon 在空闲时段自动跑。',
      ].join('\n')
    },
  })

  register({
    name: 'cost_defer',
    description: '把一次 LLM 任务登记进错峰队列：高峰排队、空闲 daemon 自动执行（10 分钟粒度），结果写到 ~/.dsh/cost-guard/results/<id>.json，可用 cost_deferred 查看。',
    parameters: {
      task: { type: 'string', required: true, description: '要交给模型的任务文本' },
      maxTokens: { type: 'number', description: '输出上限（默认 8000）' },
    },
    execute(args) {
      const session = currentSession()
      const sid = session?.id
      if (sid && !enabledForSession(session)) return 'cost-guard disabled for this project（cost_enable on 或选带成本守卫的预设）'
      const project = session ? projectOfSession(session) : null
      const taskText = String(args.task ?? '')
      // 空任务在入队前拦截：避免残留 queued 条目被 daemon 用空提示词执行（浪费调用）
      if (!taskText.trim()) return 'queue item ignored: empty task'
      const item = addQueued(taskText, args.maxTokens, project)
      if (!isPeakHour()) void runQueued().catch(() => {})
      return `queued ${item.id} (${isPeakHour() ? 'PEAK → 空闲时段自动跑' : 'off-peak → 立即执行'})`
    },
  })

  register({
    name: 'cost_deferred',
    description: '列出错峰队列全部任务：状态（queued/running/done/failed）、结果文件路径与摘要。',
    parameters: {},
    execute() {
      const q = loadQueue()
      if (q.items.length === 0) return 'queue empty'
      return q.items.map((i) => {
        const head = i.chars !== undefined ? ` chars=${i.chars}` : (i.error ? ` err=${i.error}` : '')
        return `- ${i.id} [${i.status}]${head}${i.result ? ` -> ${i.result}` : ''} @${i.createdAt}`
      }).join('\n')
    },
  })

  register({
    name: 'cost_enable',
    description: '设置当前项目的成本守卫开关：on / off / auto（auto=清除项目级设置，回落全局默认）。新项目要默认开启，请在建会话时选择带「成本守卫」的预设。',
    parameters: { mode: { type: 'string', enum: ['on', 'off', 'auto'], required: true, description: 'on / off / auto' } },
    execute(args) {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const project = projectOfSession(session)
      const m = String(args.mode ?? '')
      if (m === 'auto') setProjectFlag(project, null)
      else setProjectFlag(project, m === 'on')
      const on = enabledForSession(session)
      return `project=${projectName(project)}  cost-guard=${on ? 'on' : 'off'}${projectFlags.has(project) ? ' (project override)' : ' (global default)'}`
    },
  })

  register({
    name: 'cost_guide',
    description: '立即向当前会话注入一条成本引导（近场、前缀缓存中性）。target: converge（默认）/ deep / offpeak / budget。',
    parameters: {
      target: { type: 'string', enum: ['converge', 'deep', 'offpeak', 'budget'], description: '引导类型（默认 converge）' },
    },
    execute(args) {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const text = { converge: GUIDE_CONVERGE, deep: GUIDE_DEEP, offpeak: GUIDE_OFFPEAK, budget: GUIDE_BUDGET }[args.target ?? 'converge']
      return `inject: ${injectGuide(session, text) ? 'ok' : 'no-inbox'}`
    },
  })

  // ── client 面板注册策略（兼容性优化 v0.1.17）──────────────────────────────
  // 旧版曾越权访问 dsh-client-modules 的 private 成员（processOne/table/composed/
  // notifyGraphChanged）做「开机自愈」，会手动重算并广播整个 client 图，时序不可控，
  // 可能把 window.__DSH_BOOT__ 打乱、导致其他 UI 插件消失。已移除该越权自愈。
  //
  // 正确机制：dsh.client 声明由 harness 的 ClientModuleRegistry 在 bundle 装配时
  // 自动扫描注册（internal/plugin 事件驱动增量扫描）；插件集变化需重启 web 生效
  // （harness 设计，client-modules 对包元数据按名缓存、永不过期）。正常安装（
  // dsh plugin add / dev_install_package + 重启）后面板即注册；热注入（dev_inject_plugin）
  // 场景若面板未出现，请重启 web 一次。
  log({ event: 'apply', plugin: name })
}
