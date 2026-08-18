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

		function Cell({ k, v }) {
			return h("div", { className: "cg-cell" }, h("span", { className: "k" }, k), h("span", { className: "v" }, v));
		}

		function CostGuardPanel() {
			const [state, setState] = useState(null);
			const [error, setError] = useState(null);
			const [budget, setBudget] = useState("");
			const [budgetInputs, setBudgetInputs] = useState({});
			const [nextInputs, setNextInputs] = useState({});
			const [confirmKey, setConfirmKey] = useState(null);
			const [actionMsg, setActionMsg] = useState(null);
			const [actionOk, setActionOk] = useState(true);

			const load = () => fetcher("/state").then((d) => {
				if (d && d.ok) { setState(d); setError(null); }
				else setError("state api: " + JSON.stringify(d));
			});
			useEffect(() => {
				load();
				const timer = window.setInterval(load, 8e3);
				return () => window.clearInterval(timer);
			}, []);

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
					if (d && d.ok) load();
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
					if (d && d.ok) { setNextInputs((prev) => ({ ...prev, [projectKey]: "" })); load(); }
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
				),
				h("div", { className: "cg-card" },
					h("div", { className: "cg-row" },
						h("span", { className: "cg-muted" }, s ? `当前项目：${s.name || "?"}` : "—"),
						h("span", { className: "cg-muted" }, s ? s.key : "")),
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
