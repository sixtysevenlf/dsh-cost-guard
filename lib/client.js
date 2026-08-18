window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-cost-guard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client.tsx
		const React = require("react");
		const { useState, useEffect } = React;
		const h = React.createElement;
		const inject = ["slots"];
		const API = "/cost-guard/api";

		const styles = `
.cg-page{font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;padding:14px 16px;max-width:760px;color:var(--theme-text,#ddd)}
.cg-h{display:flex;align-items:center;gap:10px;margin:0 0 12px}
.cg-h h3{margin:0;font-size:13px;color:var(--theme-text,#e8e8e8)}
.cg-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.cg-switch{width:34px;height:18px;border-radius:10px;background:#3a3a3a;position:relative;transition:background .15s}
.cg-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#999;transition:left .15s,background .15s}
.cg-toggle.on .cg-switch{background:var(--theme-accent,#4a9eff)}
.cg-toggle.on .cg-switch::after{left:18px;background:#fff}
.cg-badge{font-size:10px;padding:2px 8px;border-radius:10px}
.cg-badge.peak{background:rgba(255,193,7,.16);color:#ffcf4d}
.cg-badge.off{background:rgba(46,204,113,.15);color:#4be38a}
.cg-card{border:1px solid var(--theme-border,#333);border-radius:8px;padding:10px 12px;margin-bottom:10px;background:var(--theme-input-bg,#111)}
.cg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.cg-cell{display:flex;flex-direction:column;gap:2px}
.cg-cell .k{color:var(--theme-text-secondary,#888);font-size:10px}
.cg-cell .v{font-size:13px;font-weight:600}
.cg-bar{height:6px;border-radius:3px;background:#2a2a2a;overflow:hidden;margin-top:6px}
.cg-bar i{display:block;height:100%;background:var(--theme-accent,#4a9eff)}
.cg-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;border-bottom:1px dashed #262626}
.cg-row:last-child{border-bottom:none}
.cg-muted{color:var(--theme-text-secondary,#aaa)}
.cg-ok{color:#4be38a}.cg-err{color:#ff6b6b}
.cg-head{white-space:pre-wrap;color:var(--theme-text-secondary,#aaa);font-size:11px;max-height:120px;overflow:auto;background:#0c0c0c;border:1px solid #222;border-radius:6px;padding:6px 8px;margin:6px 0}
.cg-input{background:var(--theme-input-bg,#111);color:var(--theme-text,#ddd);border:1px solid var(--theme-border,#333);border-radius:6px;padding:4px 8px;font-size:12px;width:110px}
.cg-btn{background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
.cg-btn-danger{background:rgba(255,107,107,.15);color:#ff6b6b;padding:2px 9px;font-size:11px;margin-left:6px}
.cg-btn-danger:hover{background:rgba(255,107,107,.3)}
.cg-btn-danger.cg-confirm{background:rgba(255,107,107,.45);color:#fff}
.cg-btn-xs{padding:0 6px;font-size:10px}
.cg-sub{padding:2px 0 2px 14px}
.cg-subrow{font-size:11px;padding:1px 0;border-bottom:none}
.cg-nextrow{background:rgba(74,158,255,.08);padding:2px 4px;margin-bottom:2px;border-radius:4px}
.cg-input-xs{width:84px}
.cg-btn-xs2{padding:0 8px;font-size:11px}
.cg-helpbtn{background:rgba(128,128,128,.18);color:#ccc;border:none;border-radius:50%;width:20px;height:20px;line-height:20px;text-align:center;cursor:pointer;font-size:12px;font-weight:700;margin-left:auto;flex-shrink:0}
.cg-helpbtn:hover{background:rgba(74,158,255,.4);color:#fff}
.cg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px}
.cg-helpbox{background:var(--theme-input-bg,#141414);border:1px solid var(--theme-border,#333);border-radius:10px;max-width:680px;width:96%;max-height:84%;display:flex;flex-direction:column;overflow:hidden}
.cg-helphead{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #262626;font-size:13px;color:var(--theme-text,#e8e8e8)}
.cg-helpclose{background:rgba(255,107,107,.18);color:#ff6b6b;border:none;border-radius:6px;padding:2px 10px;cursor:pointer;font-size:12px}
.cg-helpclose:hover{background:rgba(255,107,107,.35)}
.cg-helpbody{padding:4px 16px 16px;overflow:auto;font-size:12px;line-height:1.65}
.cg-helpsec{font-weight:700;margin:14px 0 4px;color:var(--theme-accent,#4a9eff);border-bottom:1px dashed #2a2a2a;padding-bottom:2px}
.cg-helpline{margin:3px 0}
.cg-helpline b{color:var(--theme-text,#ddd)}
.cg-helpnote{margin:8px 0 0;color:var(--theme-text-secondary,#888);font-size:11px;border-top:1px dashed #262626;padding-top:8px}
.cg-budnote{margin:6px 0 0;font-size:11px;line-height:1.6;color:#ffcf4d;background:rgba(255,193,7,.08);border:1px solid rgba(255,193,7,.25);border-radius:6px;padding:6px 8px}
.cg-st{font-size:10px;padding:1px 7px;border-radius:10px}
.cg-st.queued{background:rgba(128,128,128,.2);color:#bbb}
.cg-st.running{background:rgba(255,193,7,.15);color:#ffcf4d}
.cg-st.done{background:rgba(46,204,113,.15);color:#4be38a}
.cg-st.failed{background:rgba(255,107,107,.15);color:#ff6b6b}
`;

		function fetcher(path, init) {
			return fetch(API + path, {
				headers: { "content-type": "application/json" },
				...init
			}).then((r) => r.json()).catch((e) => ({ err: String(e && e.message ? e.message : e) }));
		}
		const fmtYuan = (v) => "¥" + (Number.isFinite(v) ? Number(v).toFixed(4) : v == null ? "—" : v);
		const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—");

		// ── 操作说明内容（help 弹层）──────────────────────────────────────────
		const HELP_SECTIONS = [
			{ h: "顶部监控卡片（当前项目/会话）", items: [
				{ t: "当前项目", d: "你正在查看的会话所属工作目录（项目 = 会话的 cwd）。切到别的会话时面板会立即跟随，卡片左上角显示「会话 xxxx」短 id 便于核对。" },
				{ t: "已花 ¥", d: "该目录全部会话的累计费用。按 DeepSeek 官方峰谷费率实时折算：命中输入 0.05、未命中输入 1.5、输出+推理 4.5 ¥/百万 token（高峰时段 ×2）。" },
				{ t: "缓存命中率", d: "命中输入 ÷ 计费输入。命中价是未命中的 1/30，所以命中率越高越省；前缀缓存红利由「不碰 persona、引导走近场」保住，两组对比实测都在 89–98%。" },
				{ t: "全命中可省 ¥", d: "如果本次所有输入都能命中缓存，理论上还能再省多少（同费率下界，仅供参考）。" },
				{ t: "本消息 ¥", d: "当前项目最后一次消息往返的花费（turn 号 + 命中率），用来感知单轮开销。" },
				{ t: "预算", d: "当前生效的预算金额（项目级）；「未设」= 该目录没有预算。" },
				{ t: "今日/本周/本月", d: "按 ledger 历史统计的周期花费与会话数；删除项目/会话后这里会相应减少。" },
				{ t: "会话预算", d: "当前项目下各会话自己设置的会话级预算汇总（短 id + 金额）。" },
				{ t: "token 明细行", d: "input(未命中)/cacheRead(命中)/cacheWrite(缓存写)/output+reasoning(输出+推理)，以及当前费率。" },
			]},
			{ h: "预算（三级作用域）", items: [
				{ t: "项目级（默认）", d: "在「预算 ¥」行设置：该目录全部会话共享一个预算。超支时自动注入一次收敛引导；一个项目只提醒一次，改预算后重新开放提醒。" },
				{ t: "会话级", d: "cost_budget 工具加 scope=session，只限当前会话。会话明细行带「预 ¥X」标记的就是设置了会话级预算的会话。" },
				{ t: "新会话预置", d: "在项目分组每行的「新会话」栏设置：预置给该目录下一个新建的顶层会话，一次性消费（子代理不会消费）。消费后该新会话自动带上会话级预算。" },
				{ t: "生效优先级", d: "会话级 > 新会话预置（消费后变成会话级）> 项目级。只有预算没有开关不生效：超支检测要求该项目成本守卫开启。" },
				{ t: "超支行为", d: "已花 > 预算时向会话注入「预算已超：立即以最少步骤交付」的近场引导（前缀缓存中性，不污染 system），并写 activity.jsonl 留痕。是软性引导不是硬中断。" },
			]},
			{ h: "启用开关", items: [
				{ t: "项目开关", d: "面板标题栏左侧：当前项目的成本守卫开关（持久化到 ~/.dsh/cost-guard/config.json 的 projects 字段）。" },
				{ t: "全局默认", d: "标题栏右侧：未单独设置的项目使用该默认值（默认关）。" },
				{ t: "优先级", d: "项目显式设置 > 全局默认。选「Router Flash + 成本守卫」预设 = 新会话从第一轮自动开启本项目。" },
			]},
			{ h: "项目分组（按会话细分）", items: [
				{ t: "为什么按目录聚合", d: "项目 = 工作目录，同一目录下所有会话共享开关/预算并合并统计；新开的会话会自动并入该目录分组。" },
				{ t: "会话明细行", d: "每个会话的短 id、活跃/归档、独立花费、命中率、token 量；带「预 ¥X」的表示该会话有自己的会话级预算。" },
				{ t: "新会话栏", d: "在会话明细行之后：为该目录下一个新会话预置预算（0=清除）。" },
				{ t: "+N 更多", d: "会话超过 20 条时折叠，只展示花费最高的 20 条。" },
			]},
			{ h: "删除操作（两步确认）", items: [
				{ t: "删除会话", d: "会话明细行右侧「删」：只清除该条会话的统计（含会话级预算）。活跃会话删除后仍会显示（实时统计）。" },
				{ t: "删除项目", d: "项目行右侧红色「删除」：清除该目录全部会话的 ledger 历史（周期统计随之减少）、项目级开关/预算与预置。" },
				{ t: "为什么两步", d: "面板运行在沙箱 iframe 中 window.confirm 会被静默拦截，故用「点击一次变确认？→ 再点一次执行」代替，3 秒不点自动还原。" },
			]},
			{ h: "错峰队列（cost_defer）", items: [
				{ t: "作用", d: "把一次独立 LLM 任务登记进队列：高峰时段（每日 09:00/14:00，单价 ×2）排队，空闲时段由 daemon 自动执行（10 分钟粒度）。" },
				{ t: "状态", d: "queued（排队中）/ running（执行中）/ done（完成）/ failed（失败，含原因）。" },
				{ t: "结果", d: "执行结果写到 ~/.dsh/cost-guard/results/<id>.json，可在「延期任务结果」卡片预览前 160 字符。" },
				{ t: "限制", d: "需要本项目守卫开启；空任务会在入队前拦截。" },
			]},
			{ h: "核心概念", items: [
				{ t: "峰谷费率", d: "空闲档：命中 0.05 / 未命中 1.5 / 输出+推理 4.5 ¥/M；高峰档（每日 09:00-10:00、14:00-15:00）全部 ×2。按模型自动选档（Pro = Flash ×3）。" },
				{ t: "近场引导", d: "成本守卫的收敛/预算/错峰提示都通过 inbox next-step 注入（离散事件触发、固定字符串），不改变 system 前缀 → 不破坏前缀缓存（30× 价差）。" },
				{ t: "收敛为什么省钱", d: "输出+推理是最贵单价项（命中输入的 90 倍），收敛 = 少写 token、少做多余工具往返；实测相同提示词下平均省 25%（见仓库 docs/测试报告.md）。" },
			]},
		];

		function Cell({ k, v }) {
			return h("div", { className: "cg-cell" }, h("span", { className: "k" }, k), h("span", { className: "v" }, v));
		}

		function CostGuardPanel(props) {
			// 当前正在查看的会话（客户端 store 直接给出，替代服务端「最近活动」推断，
			// 解决切换项目时面板跟随慢/跟不过去的问题）
			const useSessions = props && props.useSessions;
			const curSessionId = useSessions ? useSessions((s) => s.current) : undefined;
			const curCwd = useSessions && curSessionId ? useSessions((s) => s.byId[curSessionId]?.cwd) : undefined;
			const curRef = React.useRef({ id: curSessionId, cwd: curCwd });
			curRef.current = { id: curSessionId, cwd: curCwd };
			const [state, setState] = useState(null);
			const [error, setError] = useState(null);
			const [budget, setBudget] = useState("");
			const [budgetInputs, setBudgetInputs] = useState({});
			const [nextInputs, setNextInputs] = useState({});
			const [confirmKey, setConfirmKey] = useState(null);
			const [actionMsg, setActionMsg] = useState(null);
			const [actionOk, setActionOk] = useState(true);
			const [showHelp, setShowHelp] = useState(false);
			const [budgetNote, setBudgetNote] = useState(null);

			const load = () => {
				const c = curRef.current;
				const qs = c.id ? "?session=" + encodeURIComponent(c.id) + (c.cwd ? "&project=" + encodeURIComponent(c.cwd) : "") : "";
				return fetcher("/state" + qs).then((d) => {
					if (d && d.ok) { setState(d); setError(null); }
					else setError("state api: " + JSON.stringify(d));
				});
			};
			useEffect(() => {
				load();
				const timer = window.setInterval(load, 8e3);
				return () => window.clearInterval(timer);
			}, []);
			// 会话切换 → 立即刷新（不必等下一个 8s 轮询）
			useEffect(() => { if (curSessionId) load(); }, [curSessionId]);

			const s = state && state.latest ? state.latest : null;
			const enabled = state ? Boolean(state.sessionEnabled) : null; // 当前项目级
			const globalOn = state ? Boolean(state.enabled) : null; // 全局默认
			const currentKey = s ? s.key : undefined;
			const currentBudgetDraft = currentKey ? (budgetInputs[currentKey] ?? "") : budget;

			const toggleEnabled = () => {
				const next = !enabled;
				const project = state && state.latest ? state.latest.key : undefined;
				fetcher("/enable", { method: "POST", body: JSON.stringify({ enabled: next, scope: "project", project }) }).then((d) => {
					if (d && d.ok) load();
				});
			};
			const toggleProject = (projectKey) => {
				const row = (state.projects || []).find((x) => x.key === projectKey);
				const next = !(row ? row.enabled : false);
				fetcher("/enable", { method: "POST", body: JSON.stringify({ enabled: next, scope: "project", project: projectKey }) }).then((d) => {
					if (d && d.ok) load();
				});
			};
			const toggleGlobal = () => {
				const next = !globalOn;
				fetcher("/enable", { method: "POST", body: JSON.stringify({ enabled: next, scope: "global" }) }).then((d) => {
					if (d && d.ok) load();
				});
			};
			const applyBudget = (projectKey) => {
				const key = projectKey || currentKey;
				const raw = projectKey ? (budgetInputs[projectKey] ?? "") : (budgetInputs[currentKey] ?? budget);
				const v = parseFloat(raw);
				if (Number.isNaN(v) || !key) return;
				fetcher("/budget", { method: "POST", body: JSON.stringify({ budget: v, project: key }) }).then((d) => {
					if (d && d.ok) {
						setBudgetNote(v === 0 ? "预算已清除。" : `预算 ${fmtYuan(v)} 已设置。${d.note ? " " + d.note : ""}`);
						load();
					}
				});
			};
			const setDraft = (projectKey, value) => {
				setBudgetInputs((prev) => ({ ...prev, [projectKey]: value }));
				if (!projectKey || projectKey === currentKey) setBudget(value);
			};
			// 「新会话」栏预算：给该目录下一个新建的顶层会话预置（一次性消费）
			const applyNextBudget = (projectKey) => {
				const v = parseFloat(nextInputs[projectKey] ?? "");
				if (Number.isNaN(v) || !projectKey) return;
				fetcher("/budget", { method: "POST", body: JSON.stringify({ budget: v, scope: "next", project: projectKey }) }).then((d) => {
					if (d && d.ok) {
						setNextInputs((prev) => ({ ...prev, [projectKey]: "" }));
						setBudgetNote(v === 0 ? "新会话预算已清除。" : `已为该目录下一个新会话预置预算 ${fmtYuan(v)}。${d.note ? " " + d.note : ""}`);
						load();
					}
				});
			};
			const setNextInput = (projectKey, value) => setNextInputs((prev) => ({ ...prev, [projectKey]: value }));
			// 两步确认删除（window.confirm 在沙箱 iframe 中会被静默拦截，故用按钮二次点击确认）
			const doRemove = (payload, label) => {
				fetcher("/project/remove", { method: "POST", body: JSON.stringify(payload) }).then((d) => {
					setActionOk(Boolean(d && d.ok));
					setActionMsg(d && d.ok ? `${label}已删除 ${d.removed} 条统计` : `${label}删除失败: ` + JSON.stringify(d));
					if (d && d.ok) load();
				});
			};
			const askRemove = (payload, label, ck) => {
				if (confirmKey === ck) { setConfirmKey(null); doRemove(payload, label); }
				else { setConfirmKey(ck); window.setTimeout(() => setConfirmKey((c) => (c === ck ? null : c)), 3000); }
			};

			const t = (s && s.totals) || {};
			const tokText = state ? (s
				? `项目会话 ${(s.sessions || []).length} 个 · input(nocache) ${t.input ?? 0} · cacheRead ${t.cached ?? 0} · cacheWrite ${t.write ?? 0} · output+reasoning ${((t.output ?? 0) + (t.reasoning ?? 0))}    rates(¥/M) hit=${s.rates ? s.rates.hit : "—"} miss=${s.rates ? s.rates.miss : "—"} out=${s.rates ? s.rates.out : "—"}`
				: "（尚无已跟踪项目——先跑一条用户消息）")
				: "连接 /cost-guard/api/state …";

			return h("div", { className: "cg-page" },
				h("style", null, styles),
				h("div", { className: "cg-h" },
					h("h3", null, "成本守卫 · cost-guard（V4-Flash 计价）"),
					h("label", { className: "cg-toggle" + (enabled ? " on" : ""), onClick: toggleEnabled, title: "当前项目开关（预设选择 = 从第一轮起）" },
						h("span", { className: "cg-switch" }),
						h("span", { className: "cg-muted" }, enabled == null ? "…" : "项目:" + (enabled ? "开" : "关"))),
					h("label", { className: "cg-toggle" + (globalOn ? " on" : ""), onClick: toggleGlobal, title: "全局默认（未单独设置的项目使用）" },
						h("span", { className: "cg-switch" }),
						h("span", { className: "cg-muted" }, globalOn == null ? "…" : "全局:" + (globalOn ? "开" : "关"))),
					h("span", { className: "cg-badge " + (state && state.peak ? "peak" : "off") },
						state ? (state.peak ? "PEAK 高峰 ×2" : "off-peak 空闲") : "…"),
					h("button", { className: "cg-helpbtn", onClick: () => setShowHelp(true), title: "操作说明" }, "?"),
				),
				h("div", { className: "cg-card" },
					h("div", { className: "cg-row" },
						h("span", { className: "cg-muted" }, s ? `当前项目：${s.name || "?"}` : "—"),
						h("span", { className: "cg-muted" }, `${curSessionId ? "会话 " + String(curSessionId).slice(0, 8) : "—"}${s ? " · " + s.key : ""}`)),
					h("div", { className: "cg-grid" },
						h(Cell, { k: "model", v: s ? s.model : "—" }),
						h(Cell, { k: "已花 ¥", v: s ? fmtYuan(s.cost) : "—" }),
						h(Cell, { k: "缓存命中率", v: s ? pct(s.hitRate) : "—" }),
						h(Cell, { k: "全命中可省 ¥", v: s ? fmtYuan(s.savings) : "—" }),
						h(Cell, { k: "本消息 ¥", v: s && s.lastMessage ? fmtYuan(s.lastMessage.cost) : "—" }),
						h(Cell, { k: "预算", v: s && s.budget != null ? fmtYuan(s.budget) : "未设" }),
					),
					h("div", { className: "cg-bar" },
						h("i", { style: { width: (s && Number.isFinite(s.hitRate) ? s.hitRate * 100 : 0).toFixed(1) + "%" } })),
					h("div", { className: "cg-row" },
						h("span", { className: "cg-muted" }, state && state.periods
							? `今日 ${fmtYuan(state.periods.today.cost)} · 本周 ${fmtYuan(state.periods.week.cost)} · 本月 ${fmtYuan(state.periods.month.cost)}（${state.periods.month.sessions || 0} 会话）`
							: "…")),
					h("div", { className: "cg-row" },
						h("span", { className: "cg-muted" }, "会话预算：" + (s && (s.sessions || []).some((sn) => sn.sessionBudget != null)
							? (s.sessions || []).filter((sn) => sn.sessionBudget != null).map((sn) => sn.id + " " + fmtYuan(sn.sessionBudget)).join(" · ")
							: "未设"))),
					h("div", { className: "cg-row" }, h("span", { className: "cg-muted" }, tokText)),
					h("div", { className: "cg-row" },
						h("span", { className: "cg-muted" }, "预算 ¥："),
						h("input", { className: "cg-input", value: currentBudgetDraft, placeholder: "5.0；0=清除",
							onChange: (e) => setDraft(currentKey, e.target.value), onKeyDown: (e) => { if (e.key === "Enter") applyBudget(currentKey); } }),
						h("button", { className: "cg-btn", onClick: () => applyBudget(currentKey) }, "设置"),
					),
					budgetNote ? h("div", { className: "cg-budnote" }, budgetNote) : null,
					error ? h("div", { className: "cg-head cg-err" }, "error: " + error) : null,
				),
				h("div", { className: "cg-card" },
					h("div", { className: "cg-cell" }, h("span", { className: "k" }, "错峰队列")),
					!state ? h("div", { className: "cg-muted" }, "…") : h("div", null,
						(!state.queue || !state.queue.length) ? h("div", { className: "cg-muted" }, "队列空 → cost_defer 排队，空闲时段自动执行省钱")
							: (state.queue || []).map((i) => h("div", { className: "cg-row", key: i.id },
								h("span", { className: "cg-muted" }, `${i.id}${i.project ? " · " + i.project : ""}${i.chars != null ? " chars=" + i.chars : i.error ? " : " + i.error : ""}`),
								h("span", { className: "cg-st " + i.status }, i.status)))),
				),
				h("div", { className: "cg-card" },
					h("div", { className: "cg-cell" }, h("span", { className: "k" }, "延期任务结果")),
					!state ? h("div", { className: "cg-muted" }, "…") : h("div", null,
						(!state.results || !state.results.length) ? h("div", { className: "cg-muted" }, "暂无结果")
							: (state.results || []).map((r) => h("div", { key: r.id },
								h("div", { className: "cg-row" },
									h("span", { className: "cg-muted" }, `${r.id} · ${r.chars} chars · peak=${r.peak ? "peak" : "off"}`),
									h("span", { className: "cg-ok" }, r.finishedAt ? String(r.finishedAt).slice(5, 19) : "")),
								r.head ? h("div", { className: "cg-head" }, r.head) : null))),
				),
				h("div", { className: "cg-card" },
					h("div", { className: "cg-cell" }, h("span", { className: "k" }, "项目分组（各项目独立开关/预算，按花费排序；目录下按会话细分，可单独删除会话统计）")),
					actionMsg ? h("div", { className: actionOk ? "cg-ok" : "cg-err", style: { fontSize: "11px", margin: "2px 0 6px" } }, actionMsg) : null,
					!state || !state.projects || !state.projects.length ? h("div", { className: "cg-muted" }, "暂无项目")
						: (state.projects || []).map((x) => h("div", { key: x.key, style: { borderBottom: "1px dashed #262626", padding: "6px 0" } },
							h("div", { className: "cg-row" },
								h("span", { className: "cg-muted" }, `${x.name || "?"} · ${(x.sessions || []).length} 会话 · hit ${pct(x.hitRate)}`),
								h("label", { className: "cg-toggle" + (x.enabled ? " on" : ""), onClick: (e) => { e.preventDefault(); e.stopPropagation(); toggleProject(x.key); }, title: "本项目成本守卫开关（持久化）" },
									h("span", { className: "cg-switch" }),
									h("span", { className: "cg-muted" }, x.enabled ? "开" : "关")),
								h("span", { className: "cg-ok" }, fmtYuan(x.cost)),
								h("button", { className: "cg-btn cg-btn-danger" + (confirmKey === "p:" + x.key ? " cg-confirm" : ""), onClick: (e) => { e.preventDefault(); e.stopPropagation(); askRemove({ project: x.key }, "项目", "p:" + x.key); }, title: "从统计中删除该项目（清除该目录全部历史会话数据）" }, confirmKey === "p:" + x.key ? "确认？" : "删除")),
							h("div", { className: "cg-row" },
								h("span", { className: "cg-muted cg-mono" }, x.key),
								h("input", { className: "cg-input", value: budgetInputs[x.key] ?? "", placeholder: x.budget != null ? fmtYuan(x.budget) : "预算；0=清除",
									onChange: (e) => setDraft(x.key, e.target.value), onKeyDown: (e) => { if (e.key === "Enter") applyBudget(x.key); } }),
								h("button", { className: "cg-btn", onClick: () => applyBudget(x.key) }, "设置")),
							h("div", { className: "cg-sub" },
								(x.sessions || []).slice(0, 20).map((sn) => h("div", { key: sn.fullId, className: "cg-row cg-subrow" },
									h("span", { className: "cg-muted" }, `${sn.id}${sn.archived ? "·归档" : "·活跃"} ${sn.cost != null ? fmtYuan(sn.cost) : "—"} hit ${sn.hitRate != null ? pct(sn.hitRate) : "—"}${sn.tokens ? " " + (((sn.tokens.input ?? 0) + (sn.tokens.cached ?? 0) + (sn.tokens.output ?? 0) + (sn.tokens.reasoning ?? 0)) / 1000 | 0) + "K tok" : ""}${sn.sessionBudget != null ? " 预" + fmtYuan(sn.sessionBudget) : ""}`),
									h("button", { className: "cg-btn cg-btn-danger cg-btn-xs" + (confirmKey === "s:" + sn.fullId ? " cg-confirm" : ""), onClick: (e) => { e.preventDefault(); e.stopPropagation(); askRemove({ project: x.key, sessionId: sn.fullId }, "会话", "s:" + sn.fullId); }, title: "删除该会话统计" }, confirmKey === "s:" + sn.fullId ? "确认？" : "删"))),
								(x.sessions || []).length > 20 ? h("div", { className: "cg-muted" }, `+${(x.sessions || []).length - 20} 更多`) : null,
								h("div", { className: "cg-row cg-subrow cg-nextrow" },
									h("span", { className: "cg-muted" }, `新会话 预算 ¥：${x.nextBudget != null ? fmtYuan(x.nextBudget) : "未设"}`),
									h("input", { className: "cg-input cg-input-xs", value: nextInputs[x.key] ?? "", placeholder: x.nextBudget != null ? "当前 " + fmtYuan(x.nextBudget) + "；0=清除" : "设置；0=清除",
										onChange: (e) => setNextInput(x.key, e.target.value), onKeyDown: (e) => { if (e.key === "Enter") applyNextBudget(x.key); } }),
									h("button", { className: "cg-btn cg-btn-xs2", onClick: () => applyNextBudget(x.key) }, "设置"))))),
				),
				showHelp ? h("div", { className: "cg-overlay", onClick: () => setShowHelp(false) },
					h("div", { className: "cg-helpbox", onClick: (e) => e.stopPropagation() },
						h("div", { className: "cg-helphead" },
							h("span", null, "成本守卫 · 操作说明"),
							h("button", { className: "cg-helpclose", onClick: () => setShowHelp(false) }, "关闭 ✕")),
						h("div", { className: "cg-helpbody" },
							HELP_SECTIONS.map((sec) => h("div", { key: sec.h },
								h("div", { className: "cg-helpsec" }, sec.h),
								sec.items.map((it) => h("div", { key: it.t, className: "cg-helpline" },
									h("b", null, it.t + "："), h("span", null, it.d)))),
							h("div", { className: "cg-helpnote" },
								"提示：鼠标悬停在各开关/按钮上也有简短的 title 说明；费率与收敛原理详见仓库 docs/测试报告.md。")))),
				) : null,
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view", id: "cost-guard-panel", order: 60, label: "成本守卫",
			}, CostGuardPanel)), "cost-guard: panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
