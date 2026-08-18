# dsh-cost-guard 安装包说明

**文件**：`dsh-external-dsh-cost-guard-0.1.3.tgz`（30 kB，npm 标准 tarball）
**内容**：成本守卫插件（lib/ + cordis.patch.yml）+ 「Router Flash + 成本守卫」预设（preset/router-flash-cg）
**兼容**：@deepseek-ai/dsh ≥ 0.1.0-rc.7；模型计价针对 DeepSeek V4-Flash（Pro 自动按 3× 选档）

---

## 1. 安装插件（二选一）

**方式 A：dsh CLI 安装（推荐，重启后自动装配）**

```bash
dsh plugin --profile web add /path/to/dsh-external-dsh-cost-guard-0.1.3.tgz
```

然后在 profile 的 `package.json` 的 `dsh.profile.bundles` 中追加包名 `@dsh-external/dsh-cost-guard`，重启 dsh 生效。

**方式 B：运行时热注入（免重启，适合测试）**

```bash
dev_inject_plugin /解压后的插件目录
```

## 2. 安装「成本守卫」预设（可选但推荐）

新会话选择该预设 = 从第一轮起自动启用成本守卫（项目级开关自动写入）：

```bash
# 把 tarball 里的 preset/router-flash-cg 目录复制到用户预设目录：
#   ~/.dsh/.agent-presets/router-flash-cg/
```

复制后新会话的预设列表会出现「Router Flash + 成本守卫」，选中即可。

## 3. 启用与预算

- 预设选中即启用（推荐）；或任一会话里调用工具 `cost_enable on`；或直接编辑 `~/.dsh/cost-guard/config.json`：

```json
{
  "enabled": false,
  "projects": {
    "D:\\你的\\项目目录": { "enabled": true, "budget": 1.0 }
  }
}
```

- 预算超支时插件自动注入一次「收敛交付」近场引导；也可随时手动注入：`cost_guide converge|deep|offpeak|budget`。

## 4. 可用工具

| 工具 | 作用 |
|---|---|
| `cost_status` | 项目仪表盘：模型/峰谷/费率/用量/已花 ¥/命中率/可省金额/预算 |
| `cost_budget {budget}` | 设项目 ¥ 预算（0 清除），超支自动收敛引导 |
| `cost_peak` | 峰谷状态与下一切换点 |
| `cost_defer {task}` / `cost_deferred` | 错峰队列：高峰排队、空闲 daemon 自动执行 |
| `cost_guide {target}` | 手动注入收敛/深度/错峰/预算引导（近场、前缀缓存中性） |

## 5. 环境要求与已知限制

- 插件 `inject` 依赖 `tools / llm / webServer`：标准 **web profile 开箱即用**（监控面板在 `/cost-guard/api`）。
- **headless profile 无 webServer**：插件不会激活；如需 headless 使用，需在装配中提供一个最小 `webServer` 服务桩（register 为 no-op）。
- headless 单条任务下「超支自动引导」触发有限（依赖用户消息事件），预算兜底建议外部监控。
- 不碰 persona / system 前缀，前缀缓存红利保持；所有引导走 inbox next-step 近场注入。

## 6. 验证

安装后新开一个会话，调用 `cost_status`，应返回 enabled 状态、项目路径、费率与用量统计；GUI 左下角/监控面板可见 `成本守卫` 面板。
