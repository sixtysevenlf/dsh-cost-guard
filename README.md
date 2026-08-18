# dsh-cost-guard — DeepSeek V4-Flash-0731 纯 API 省钱守卫

面向「只用 API、不自部署」场景的成本插件，装配在 router / mode-boost 之上，**不碰 persona**
（路由归它们），只做「钱」的事。定价口径 = DeepSeek 官方 2026-08-17 峰谷分级（¥/百万 token）：

| Flash-0731 | 缓存命中 | 未命中 | 输出 |
|---|---|---|---|
| 空闲（每日非 09:00/14:00） | ¥0.05 | ¥1.5 | ¥4.5 |
| 高峰（每日 09:00、14:00） | ¥0.10 | ¥3.0 | ¥9.0 |

同请求「命中:未命中 = 1:30」；高峰 = 空闲 × 2；Pro 为 Flash 的 3 倍。插件按 model id 自动选档。

## 启动即生效（运行时热装，免重启）

```
dev_inject_plugin D:\DSH\测试\优化\dsh-cost-guard
```

持久化（重启后自动恢复）：`dsh plugin --profile web add <此目录>` 或 `dev_install_package`。

## 工具

| 工具 | 作用 |
|---|---|
| `cost_status` | 当前项目仪表盘：模型/峰谷/费率/累计用量（输入/输出/缓存命中/缓存写/推理）/已花 ¥/命中率/全命中可省金额/预算 |
| `cost_budget {budget}` | 设当前项目 ¥ 预算（0 清除）；超支自动注入一次「收敛交付」近场引导 |
| `cost_peak` | 当前峰谷状态、下一切换点、错峰建议 |
| `cost_defer {task, maxTokens?}` | 把一次 LLM 任务登记进错峰队列；高峰排队、空闲 daemon 自动执行（10 分钟粒度），结果落 `~/.dsh/cost-guard/results/<id>.json` |
| `cost_deferred` | 队列状态：queued/running/done/failed + 结果路径 |
| `cost_guide {target}` | 手动注入收敛/深度/错峰/预算引导（近场、前缀缓存中性） |

## 原理（一句话）

- **用量**：从 durable `assistant/message` 事件里 `data.usage` 折叠（`TokenUsage`：inputTokens /
  outputTokens / cacheReadTokens / cacheWriteTokens / reasoningTokens），resume 后仍准确；
- **成本**：`cached×hit + (input+write)×miss + (output+reasoning)×out`（推理按输出价，保守口径）；
- **缓存纪律**：persona 不碰（保持 30× 前缀缓存红利）；引导只走 `inbox next-step` 近场（离散事件触发，
  不刷屏、不改 system 前缀）；
- **错峰**：`isPeakHour()` = 时区小时 ∈ {9,14}；daemon 用 `ctx.setInterval` 每 10 分钟只跑队列里的
  queued 项且仅在空闲时段。

## 提示词包（与插件互补，任选）

1. system 静态区（只加一次，放最前、别随会话变）：
   ```
   Cost discipline: every tool call is billed work — batch reads, reuse prior
   results, stop when enough information exists, never run environment checks
   or exhaustive scans; finish each task with a one-line delivery note.
   ```
2. 每条任务末尾的收敛后缀：
   ```
   (converge) 用能确定完成的最少步骤工作；不重复已做的读取；信息足够就交付。
   ```
3. 高峰时段的高价值任务前：
   ```
   It is peak pricing now. Do this in the fewest steps — one deep pass, no
   revert loops; register anything deferrable via cost_defer.
   ```

> 与 mode-boost/router 的分工：它们管「用哪种思维模式/风格」；cost-guard 管「钱包」。
> 不要向 system 注入动态内容（会整会话缓存 miss，吞噬 30× 红利）——动态信号一律走消息尾。

## 开局收敛（输入框按钮）

**消息输入框右侧新增「收敛」按钮**（发送按钮旁）：点击立即对当前会话注入一次收敛引导
（"用最少的额外步骤完成当前目标——批量读取、复用上下文已有信息、现在就产出。每次工具调用都是计费动作"），
按钮短暂变绿显示「已收敛 ✓」。手动控制、随时可点，与守卫开关无关。

## 启用（项目级开关）

成本守卫支持**项目级开关**（项目 = 会话的工作目录 `cwd`，同一目录下的所有会话共享开关/预算）：
面板「项目」开关 / 工具 `cost_enable {mode: on|off|auto}` / 直接编辑 `~/.dsh/cost-guard/config.json` 的 `projects` 字段。

**项目级开关的优先级**：项目显式设置（面板「项目」开关 / `cost_enable` 工具）> 全局默认
（面板「全局」开关，持久化 `config.json` 的 `projects` 字段）。面板标题栏现在是两个开关：「项目」+「全局」；
工具 `cost_enable {mode: on|off|auto}` 可在会话中途切换（auto = 清除该项目设置，回落全局默认）。
每个项目可独立设置 `cost_budget`，互不影响。

## 图形控制界面（client 面板）

注入后，会话视图（conversation.view）会出现「成本守卫」标签页：

- **监控卡片**：模型 / 峰谷徽标 / 已花 ¥ / 缓存命中率条 / 全命中可省 ¥ / 预算；
- **预算（三级作用域）**：① **项目级**（默认，面板「预算 ¥」行）——该目录全部会话共享；② **会话级**——只限当前会话（`cost_budget` 加 `scope=session`），会话明细行带「预 ¥X」标记；③ **新会话预算**——在**项目分组每行的「新会话」栏**设置/显示（`scope=next`）：预置给该目录**下一个新建的顶层会话**，一次性消费（子代理不会消费）。超支自动注入收敛引导；会话级与预置持久化在 `~/.dsh/cost-guard/session-budgets.json`。
- **错峰队列**：queued/running/done/failed 状态实时刷新；
- **延期结果**：cost_defer 产出的结果摘要（前 160 字符 + 用量）；
- **启用开关**：每个项目一键切换 `enabled`（持久化到 `~/.dsh/cost-guard/config.json` 的 `projects` 字段），停用时该项目引导/队列/daemon 全部静默。
- **项目分组（按会话细分）**：每个目录项目下展开列出各会话（短 id、归档/活跃、独立花费、命中率、token 量），可**单独删除某条会话统计**，也可整项目删除。删除按钮为**两步确认**（点击一次变「确认？」再点一次执行，3 秒未确认自动还原）——面板运行在沙箱 iframe 中，`window.confirm` 会被静默拦截，故不用系统弹窗。
- **删除项目**：项目分组中每行右侧红色「删除」按钮——从统计中彻底移除该项目：清除该目录全部会话的 ledger 历史（今日/本周/本月统计随之减少）、项目级开关与预算配置，并清空相关缓存。注意：项目 = 工作目录，删除后在该目录新开的会话会重新出现在分组中；操作结果（成功/失败原因）会显示在分组标题下方。

面板数据源：`GET /cost-guard/api/state`（同源 fetch，8s 轮询）；开关调 `POST /cost-guard/api/enable`。

> ⚠️ **面板注册靠重启**：client-modules 对包元数据按名缓存、**永不过期**——插件集变化需**重启 web** 生效（harness 设计）。正常安装（`dsh plugin add` / `dev_install_package` + 重启）后面板与「收敛」按钮自动注册；热注入（`dev_inject_plugin`）场景如未出现，请重启 web 一次。
>
> ✅ **兼容性（v0.1.17）**：移除旧版基于越权访问 `dsh-client-modules` 私有 API（`processOne`/`composed`/`notifyGraphChanged`）的「开机自愈」——它会在运行时手动重算并广播整个 client 插件图，时序不可控，可能打乱 `window.__DSH_BOOT__`、导致**其他 UI 插件消失**。现在只依赖 harness 的标准装配，不再触碰任何内部状态。


## 测试报告与使用说明

- 两轮对比测试报告（成本守卫 vs 无守卫，含收敛省钱原理与分轮数据）：[docs/测试报告.md](docs/测试报告.md)
- 安装与使用说明：[INSTALL.md](INSTALL.md)
- 可分发的安装包：GitHub Release 附件 `dsh-external-dsh-cost-guard-0.1.17.tgz`（npm pack 产物，`dsh plugin --profile web add <tgz>` 安装）

