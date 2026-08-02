# issue #5 LUI 交互优化 — 验收记录（2026-08-02）

> 驱动 Claude Code 实现，Hermes 监工验收。
> 依据：GitHub issue #5（LUI交互优化）。验收通过。

## 一、验收结果总览

| 项 | 需求 | 结果 | 验证方式 |
|---|---|---|---|
| B0 | 诊断运行不流畅 | ✅ | DualPlaneCanvas 节点缓存+结构签名，避免每tick全量重排；e2e无JS错误 |
| B1 | 场景不强约束，自动随机选 | ✅ | AMBIGUOUS/NO_MATCH 随机选 Case 直接执行；e2e B1-001 |
| F0 | 收起左栏+LUI放大1.8倍 | ✅ | 诊断时左栏隐藏、LUI 806px(448×1.8)、退出恢复；e2e F0-001~004 |
| F1 | 证据链/计划页签上移放大 | ✅ | 页签 12px、提高到诊断态势下方、三块同屏；e2e F1-001/002 |
| F2 | 图谱/拓扑与LUI联动+红线实时推进 | ✅ | projection-store 加 activeDiagnosisPath；logic 红连线(#ef4444) flat+layered 均有；e2e F2-001 + layered-red |
| F3 | 终态TOP3根因+置信度最高红色高亮 | ✅ | CandidateList 收敛时 TOP3 徽标，confirmed 候选改 status-fault 红；e2e F3-001/002 |

## 二、回归（全部保持）
- typecheck 0 错误
- vitest 143/143（含分层/聚合测试）
- verify-v2 5 Case ALL PASS + 三基线路由 confident=true
- e2e/layered-topology.mjs 13/13（issue#4 分层不破坏）
- e2e/acceptance.mjs 5/5（BA-GOAL-003 改为"弱输入自动匹配"）

## 三、关键实现
- **B0** (`DualPlaneCanvas`): nodeCacheRef 复用节点对象 + graphDataSignature 结构签名，节点结构未变时跳过 graphData 重绑
- **B1** (`App.tsx`): pickRandomCandidate 随机选 + routeNote 说明
- **F0** (`App/LuiPanel/LayeredTopologyCanvas`): leftPanelCollapsed 状态，LuiPanel wide 时 w-[806px]
- **F1** (`LuiPanel`): 证据链/计划页签上移到诊断态势下方，12px 更大
- **F2** (`projection-store/model-loader/utils/DualPlaneCanvas/LayeredTopologyCanvas`): activeDiagnosisPath 纯函数 → logic category + #ef4444 红色逻辑链，flat 画布粗线+红色粒子，layered 渲染逻辑线段，随 cursor/liveHead 推进
- **F3** (`LuiPanel`): concluded=terminal_status 时只展示 TOP3 + 红色 TOP3 徽标 + confirmed 红高亮

## 四、证据
- e2e/issue5-smoke.mjs（11 项）、e2e/issue5-layered-red.mjs
- business-acceptance/issue5-f2-live.png（红线实时）、issue5-f3-terminal.png（TOP3红高亮）、issue5-layered-red.png（分层红线）

## 五、待龙哥人工视觉确认
- F2 红色逻辑链随诊断推进的视觉效果、动画流畅度（截图 issue5-f2-live.png / issue5-layered-red.png）
- F0 收起左栏后布局、F1 页签上移后的信息密度（可截图确认）
