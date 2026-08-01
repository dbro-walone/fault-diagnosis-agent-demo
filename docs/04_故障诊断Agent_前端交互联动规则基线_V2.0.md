# 故障诊断 Agent 前端交互联动规则基线 V2.0

## 1. 原则

前端只投影 Runtime 状态，不执行诊断。所有联动必须保持：

> Agent 诊断上下文与用户浏览上下文相互可见、相互独立。

## 2. 状态分层

```yaml
runtime_state:
  agent_focus: {}
  candidates: []
  facts: []
  evidences: []
  plans: []

projection_state:
  user_selection: {}
  expanded_group_ids: []
  active_filters: []
  camera_bookmark: {}
  view_mode: FUSED
```

`agent_focus` 只能由 Runtime 更新；`user_selection` 只能由用户交互或显式“返回 Agent 视角”更新。

## 3. 五层 LUI 与主画布

| 区域 | 职责 | 点击后联动 |
|---|---|---|
| 会话状态 | 模式、阶段、现象 | 切换实时/回放，不改变诊断 |
| 诊断态势 | 领先候选与链路进度 | 聚焦领先候选的最小上下文 |
| 当前行动 | 目标、Skill、原因和结果 | 定位任务对象和 Fact |
| 候选列表 | 分数、变化、缺口 | 展开候选相关事实、证据和任务 |
| 调查工作区 | 证据链、计划、历史、详情 | 驱动详情和历史快照 |
| 3D 双平面 | 对象、关系、路径和映射 | 更新 user_selection，LUI 顶部保持 Agent 信息 |

## 4. 四条核心探索链

### 4.1 对象→候选/证据/任务

点击拓扑或知识图谱对象：

- 对象进入用户选中态；
- 高亮直接上下游、故障路径、影响路径和冗余路径；
- 相关候选置顶但不删除其他候选；
- 调查工作区展示相关 Fact、Evidence 与任务；
- 若对象不是 Agent 当前对象，顶部当前行动保持不变；
- 用户点击“返回 Agent 视角”才恢复相机到 `agent_focus`。

### 4.2 候选→对象/证据/缺口/计划

- 展开候选对象及最小必要上下文；
- 按支持、削弱、冲突、缺失四组展示；
- 展示诊断支持分历史，禁止百分比环；
- 展示当前计划是否正在验证该候选；
- `LEADING` 只能显示“领先候选”，不能显示“根因”。

### 4.3 Evidence→Fact/Skill/候选变化

```text
Evidence
→ fact_refs[]
→ Fact Detail
→ source.execution_id / skill_id / query_coverage
→ Candidate Update score_before→score_after
```

点击 Evidence 后可在多个 Fact 间切换；前端不能根据原始值重新计算作用方向。

### 4.4 时间线→历史快照

- 进入只读 `REPLAY`；
- 显示当时已知的计划、事实、证据和候选；
- 自动诊断播放暂停；
- 实时新事件以提示点显示；
- 返回当前时恢复进入回放前的视口、展开和用户选择。

## 5. 用户自由浏览保护

当用户执行旋转、拖动、缩放、选择或展开后，进入 `USER_EXPLORING` 相机控制状态：

- Runtime 继续推进；
- Agent 当前对象通过导航点、边缘提示或“返回 Agent 视角”表达；
- 新事件不能调用强制 `fitToSelection`；
- 严重终态可显示非阻塞提示，但仍不抢夺相机；
- 用户 30 秒无操作也不自动抢回，只可提示。

## 6. 聚合、钻取与视图切换

- 点击聚合节点只是选中；显式展开按钮或双击才下钻；
- 滚轮只缩放，不触发层级变化；
- 展开以聚合节点为锚点，仅对局部布局；
- 切换融合/拓扑/图谱视图尽量保留相同实体选择、时间位置和语义层级；
- 跨层映射在聚合两端自动合并，展开时按真实映射拆分；
- 退出聚焦后恢复之前的视口和展开层级。

## 7. 事件驱动刷新

| Runtime Event | 刷新区域 |
|---|---|
| `SYMPTOM_NORMALIZED` | 状态栏、现象对象 |
| `CANDIDATES_GENERATED` | 候选区、图谱映射 |
| `SKILL_STARTED` | 当前行动、任务历史 |
| `FACT_DISCOVERED` | 当前行动结果、事实提示 |
| `EVIDENCE_CREATED` | 证据链、候选关联 |
| `CANDIDATE_UPDATED` | 分数、排序、变化原因 |
| `PLAN_REPLANNED` | 当前行动、计划差异、历史 |
| `MINIMUM_CHAIN_UPDATED` | 诊断态势、证据链 |
| `ROOT_CAUSE_CONFIRMED` | 结论、根因链和影响链 |

所有刷新为局部更新，不整屏重载，不重新洗牌。

## 8. 状态叠加

对象可能同时具有：运行异常、领先候选、Agent 当前对象、用户选中对象、根因、受影响、接管等状态。必须通过基础形态、光晕、描边、徽标、动画和标签层次组合表达，不能只用单一颜色。

优先级：

```text
ROOT_CAUSE > CRITICAL_ANOMALY > AGENT_FOCUS > USER_SELECTED
> IMPACTED > FAILOVER > CANDIDATE > NORMAL
```

低优先级状态不能完全覆盖高优先级状态，但仍应通过次级标记保留。

## 9. 异常处理

| 情况 | 前端表达 |
|---|---|
| Skill FAILED | 执行失败；显示原因与替代动作，不形成健康结论 |
| DATA_MISSING | 数据缺失；显示对象/时间/指标缺口 |
| PARTIAL | 部分覆盖；明确未覆盖范围 |
| EMPTY/ABSENCE | 在完整查询条件下未命中；展示覆盖条件 |
| 关键冲突 | 同时展示支持与冲突，并突出消歧任务 |
| 事件乱序 | 暂停应用并补传/刷新快照 |

## 10. 验收

- 用户查看任意对象时仍可看到 Agent 当前行动；
- 点击候选、Evidence、Fact 和事件均能形成闭环联动；
- 用户操作不会更新候选、证据或计划；
- Runtime 新事件不会打断自由浏览；
- 视图切换、聚焦退出和回放返回可恢复上下文；
- 所有区域基于同一 session version。

