# issue #6 阶段A — Planner 目标呈现 · 验收记录（2026-08-02）

> 驱动 Claude Code 实现。
> 依据：GitHub issue #6（LUI展示优化V2）阶段A —— Planner 目标呈现。
> 定位：诊断过程更贴近真实的 Planner 工作方式，LUI 突出
> 「目标资源 / 目标故障模式 / 为什么验证 / 期望发现什么 / 当前诊断范围」，
> 重规划时展示「原范围 → 新范围扩展、新增目标 vs 暂停目标」差异。

## 一、验收结果总览

| 项 | 需求 | 结果 | 验证方式 |
|---|---|---|---|
| P0 | LUI 出现 Planner 目标区：目标资源+故障模式+验证问题+期望发现+当前范围 | ✅ | e2e P0-001/002；截图 01-early-active.png |
| P1 | 当前位置（active 目标）高亮并随诊断推进移动 | ✅ | e2e P1-001（task 推进时 #4→#1/#3→#5） |
| P2 | task-check-pool 触发重规划：出现「重新规划」横幅 + storage-pool-01 新增目标 | ✅ | e2e P2-001；截图 02-replan.png |
| P3 | 终态目标状态裁决（命中故障/已排除/已验证） | ✅ | e2e P3-001；截图 03-terminal-statuses.png |
| P4 | 诊断推进中目标状态随动、重规划区可见 | ✅ | e2e 全程 + 无 JS 错误（P0-003） |

## 二、回归（全部保持）
- typecheck 0 错误
- vitest 172/172（原 166 + 新增 6 项 planner-targets.test.ts）
- verify-v2 5 Case ALL PASS + 三基线路由 confident=true
- issue#4/5 不破坏：3D 分层拓扑、LUI 五层、红逻辑链（activeDiagnosisPath 未改动）

## 三、关键实现
- **Case 数据**（`cases/*/diagnosis/planner_plan.json`）：新增 PlannerPlan 结构，
  每项含 `seq/target_resource/target_fault_mode/verify_question/expected_finding/topo_path/scope/round`，
  controller 案例 5 目标（lun-db01→db-host-01→fc-port-0a→controller-0a→storage-pool-01，round2 重规划新增），
  noisy_neighbor 6 目标（round2 新增施压者 host-a），其余 Case 简版对齐结构。
- **case-adapter**：glob 加载 planner_plan.json → `AdaptedCase.plannerPlan`；
  同时把 KPI 任务 `series_ids` 反查为真实资源 id，使 target_object_refs 反映 CMDB 对象。
- **diagnosis-runtime**：PLAN_CREATED 携带 round-1 目标；重规划改为数据驱动
  （`planner_plan.replans[].trigger_task_id` 锚定，兼容旧 task.stage 机制），
  PLAN_REPLANNED 携带目标全量 + `replan` 差异；`SKILL_STARTED` 的
  reason/expected 由目标 `verify_question`/`expected_finding` 生成（无目标匹配回退 skill 泛化）。
- **event-reducer**：快照新增 `planner_targets / planner_replans / planner_original_scope`。
- **projection-store**：`plannerTargets()` 纯函数推导每目标状态
  （active / verified_abnormal / excluded / verified_ok / pending），
  「当前验证中」取自最近 RUNNING 任务，随诊断推进移动。
- **LuiPanel**：诊断态势下方新增 Planner 目标区 —— 目标资源加粗高亮、
  故障模式、为什么验证、期望发现、scope 标签、状态徽标、重规划新增/暂停标记，
  以及「重新规划 R2：原范围 → 扩展，新增目标 A/B，暂停目标 C」横幅。

## 四、证据
- `e2e/issue6-planner.mjs`（6 项浏览器断言）
- `src/v2/planner-targets.test.ts`（6 项 vitest）
- `business-acceptance/issue6-phaseA/01-early-active.png`（早期 #4 高亮）
- `business-acceptance/issue6-phaseA/02-replan.png`（重规划横幅 + storage-pool-01）
- `business-acceptance/issue6-phaseA/03-terminal-statuses.png`（终态状态裁决）
- `business-acceptance/issue6-phaseA/crops/`（LUI 区域放大截图）

## 五、待龙哥人工视觉确认
- Planner 目标区信息密度与配色（目标资源高亮、active 光环、排除降暗）
- 重规划横幅文案长度在小宽度 LUI（448px）下的折行表现
