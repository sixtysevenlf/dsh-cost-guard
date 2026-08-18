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

## 新会话选择启用（预设方式）

成本守卫支持**项目级开关**（项目 = 会话的工作目录 `cwd`，同一目录下的所有会话共享开关/预算），
可在建会话时选定：

1. 把随插件附带的预设复制到用户目录（只需一次）：
   ```powershell
   Copy-Item -Recurse 'D:\DSH\测试\优化\dsh-cost-guard\preset\router-flash-cg' "$env:USERPROFILE\.dsh\.agent-presets\router-flash-cg"
   ```
2. 重启 DSH，新建会话时选择 **「Router Flash + 成本守卫 (opencode-go)」** —— 该预设 = router-flash
   （Flash w7 路由）+ `cost-guard-enable` 行：首轮 assemble 即 emit 项目级启用事件，**从第一轮起**
   预算守卫/峰谷/错峰队列/近场引导全部生效。选原 router-flash = 不开。

**项目级开关的优先级**：项目显式设置（预设行 / 面板「项目」开关 / `cost_enable` 工具）> 全局默认
（面板「全局」开关，持久化 `config.json` 的 `projects` 字段）。面板标题栏现在是两个开关：「项目」+「全局」；
工具 `cost_enable {mode: on|off|auto}` 可在会话中途切换（auto = 清除该项目设置，回落全局默认）。
每个项目可独立设置 `cost_budget`，互不影响。

## 图形控制界面（client 面板）

注入后，会话视图（conversation.view）会出现「成本守卫」标签页：

- **监控卡片**：模型 / 峰谷徽标 / 已花 ¥ / 缓存命中率条 / 全命中可省 ¥ / 预算；
- **预算输入框**：设置当前项目 ¥ 预算（0=清除），每个项目独立，超支自动注入收敛引导；
- **错峰队列**：queued/running/done/failed 状态实时刷新；
- **延期结果**：cost_defer 产出的结果摘要（前 160 字符 + 用量）；
- **启用开关**：每个项目一键切换 `enabled`（持久化到 `~/.dsh/cost-guard/config.json` 的 `projects` 字段），停用时该项目引导/队列/daemon 全部静默。

面板数据源：`GET /cost-guard/api/state`（同源 fetch，8s 轮询）；开关调 `POST /cost-guard/api/enable`。

> ⚠️ **首次启用面板需重启一次 web**：client-modules 的 `pkgMeta` 会缓存解析失败结果
> （Map 常驻、无失效入口）。若在加 `dsh.client` 声明前注入过，该 `null` 缓存会拦住面板注册，
> 直到 host 重启清零。重启后注入器 autoRestore 重新 create + 补扫，面板即注册；再刷新页面即可见。


## 测试报告与使用说明

- 两轮对比测试报告（成本守卫 vs 无守卫，含收敛省钱原理与分轮数据）：[docs/测试报告.md](docs/测试报告.md)
- 安装与使用说明：[INSTALL.md](INSTALL.md)
- 可分发的安装包：GitHub Release 附件 \dsh-external-dsh-cost-guard-0.1.0.tgz\（npm pack 产物，\dsh plugin --profile web add <tgz>\ 安装）

