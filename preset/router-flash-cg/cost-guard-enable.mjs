/**
 * cost-guard-enable: 选择「Router Flash + 成本守卫」预设 = 从第一轮起启用成本守卫。
 *
 * 机制：首轮 system-prompt/assemble 时向 host 冒泡
 * `cost-guard/session-set(sessionId, true, projectKey)` 事件（cordis 事件沿 scope 链上浮，
 * host 平面已注入的 dsh-cost-guard 监听该事件并写入项目级开关）。
 * 零依赖、不改装配结果（纯观测）。
 */
export const name = 'cost-guard-enable'

export function apply(ctx) {
  const done = new Set()
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent !== undefined && agent.session !== undefined && !done.has(agent.session.id)) {
      done.add(agent.session.id)
      try {
        const project = agent.session.header?.cwd || agent.session.cwd || agent.session.id
        ctx.emit('cost-guard/session-set', agent.session.id, true, project)
      } catch { /* host 侧未加载时静默降级 */ }
    }
    return assembled
  })
}
