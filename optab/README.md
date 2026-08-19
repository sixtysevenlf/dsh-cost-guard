# dsh-optab — DSH 成本优化插件（瘦身 + 双层压缩 + 自动档位）

DSH 插件：在 agent 层做成本优化，全配置驱动、确定性、默认关闭（按 patch 启用），不碰主 profile。

## 功能（三层）
1. **前缀瘦身**：`system-prompt/assemble` 里滤除零调用的 delegation/subagent/goal/skill/search 工具（默认 21 个），每请求少 ~12.5k 字符（≈3–4k token）。
2. **工具输出压缩（双层）**：
   - 投影：`tools/execute` 把当步模型可见的大结果换成确定性头尾预览；
   - 持久：`session/event` 观察大 tool/result → `surfaceOp replace` 落库替换（`assertToolResultRewrite` 契约：start/end=seq、sourceEventSeqs 盖全、只改 content），全文进 artifact → derive/replay 只见压缩字节，**跨重启几何**（见 test-reports/optab-ab-report.md §7）。
3. **推理档位自动定档**：`agent/request` 里
   - 关键词命中（开放式 3D/视觉/系统类，如 黑洞/Three.js/WebGL…）→ `max`；
   - 滚动窗口最近 N 条请求平均推理 ≥ 阈值 → 自动升 `max`（依赖供应商上报 reasonTokens；headless/deepseek-v4-flash 不上报单独推理，web 侧生效）；
   - 否则 → `high`（默认档）。
   - 实测：三任务 × {high,max} 质量全对、输出 -56%（effort-quality-ab.md）。
4. **成本守卫配合**（与 dsh-cost-guard 分层正交、可叠加）：
   - **峰时封顶**：`peakWindows`(默认北京 09-12/14-18)+`peakMax:high` → 峰时把关键词/滚动升上的 `max` 封顶为 `high`（省 2× 峰价）；
   - **超支/收敛收紧**：`budgetSignalPath` 指向守卫信号文件（`~/.dsh/cost-guard/session-budgets.json`），数值超支 `cost>=budget`（全局）或 `converged` 命中**当前会话**（按会话）→ 强制 `tightEffort` + 阈值收紧；
   - **「收敛」按钮配合**：点收敛 → 会话进 `converged` → optab **只收紧该会话**（effort→high、预览/阈值更短），别会话不受影响；收敛=行为引导、optab=结构性减量，双保险互补；
   - **托管开关**：`guardStatePath` 非空 → 由 `~/.dsh/cost-guard/optab.json` 的 `enabled` 门控（输入框「优化」按钮）。
   - 实测：峰时 `kw+peak`、超支/收敛 `kw+budget`、非本会话收敛 `kw→max`（不误伤）——均 PASS。
   > 生效：宿主/optab 改动需**重启 web**；客户端由磁盘下发、刷新即见。

## 安装 & 启用
```sh
# 依赖已装/或在 build 后再装：
dsh plugin --profile headless add file:D:\DSH\测试\新优化思路\plugins\dsh-optab
# 临时隔离验证（推荐 --patch 挂载，不落主 profile）：
dsh --profile headless --patch D:\DSH\测试\新优化思路\test-reports\ab-final.yml "<task>"
```
启用配置见 `test-reports/ab-final.yml`；自动档位示例见 `test-reports/effort-auto.yml`。

## 关键配置项
| 键 | 默认 | 说明 |
|---|---|---|
| `slimTools` | 零调用组(21) | 前缀滤除名单 |
| `compress` / `durableCompress` | true / true | 双层压缩开关 |
| `wrapTools` | [] | 空=压缩所有文本型工具；或 `["read"]` |
| `maxChars` / `maxLines` | 8000 / 240 | 压缩阈值 |
| `headChars`/`tailChars` | 4000/2000 | 确定性预览头尾 |
| `effortMode` | off | off/auto/force |
| `defaultEffort` / `maxKeywords` / `maxRollingReqs` / `maxRollingThreshold` | high / 列表 / 5 / 800 | 自动档位 |
| `metricsDir` | '' | 度量/artifact 目录 |

## 构建 & 打包
```sh
dev_build_plugin (dir=plugins/dsh-optab)   # 产物 tgz
```
缓存纪律：所有替换确定性；失效风险=前缀漂移（非确定性摘要/同一 epoch 反复改工具），会让 31× 缓存反噬。

## 实测结果速览（详见 test-reports/）
- 全量语料量化：插件（全工具+8k）≈ 省 9.4%；叠加推理档 high ≈ 15–18%（quantified-savings.md）
- 持久压缩 A/B：同任务成本 -75%（~4×），跨重启回放 PASS（optab-ab-report.md §6/§7）
- 档位质量 A/B：high vs max 客观全对、输出 -56%（effort-quality-ab.md）
