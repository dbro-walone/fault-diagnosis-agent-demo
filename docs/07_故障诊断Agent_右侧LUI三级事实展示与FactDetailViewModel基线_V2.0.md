# 故障诊断 Agent 右侧 LUI 三级事实展示与 Fact Detail / View Model 基线 V2.0

## 1. 冻结结论

日志、告警、KPI、拓扑和资源状态统一进入：

```text
L1 当前行动摘要
→ L2 证据链事实预览
→ L3 原始事实详情
```

这三层引用同一 `fact_id`，不能复制成三套互不关联的数据。

## 2. 五层 LUI

```text
会话状态栏
诊断态势（当前知道什么）
当前行动（做什么、为什么、期望什么）
候选根因
调查工作区（证据链｜计划｜历史）
```

宽度建议 420～480px。状态栏、诊断态势和当前行动保持可见；详情只覆盖调查工作区。

## 3. L1 当前行动摘要

执行中：

```text
当前目标：确认 Controller-0A 复位触发机制
正在执行：日志指纹查询 · Controller-0A · 14:32:07—14:32:18
为什么：已发现热复位告警，但仍缺触发机制证据
期望：watchdog_timeout 或 controller_reset 指纹
```

完成后原位升级：

```text
已完成 · 命中 watchdog_timeout
timeout_ms=3000 · 14:32:17.302
形成触发机制证据 · 支持分 62 → 84
```

KPI 摘要必须带单位与比较：`LUN平均时延 1.8 → 38.6 ms`。告警摘要必须带对象和发生时间。

## 4. L2 证据链事实预览

```yaml
evidence_chain_item_vm:
  requirement_id: impact
  status: SATISFIED
  label: 业务影响闭环
  evidence_id: ev-impact-chain
  effect: STRONG_SUPPORT
  fact_previews:
    - fact_id: fact-lun-latency-window
      icon: kpi
      primary_text: LUN平均时延 1.8 → 38.6 ms
      secondary_text: 14:32:18 · 临界阈值30ms
  candidate_change:
    candidate_id: cand-controller-warm-reset
    score_before: 62
    score_after: 84
```

证据链项状态：`PENDING | IN_PROGRESS | SATISFIED | CONFLICTING | UNAVAILABLE`。

## 5. L3 Fact Detail

通用页头：事实类型、对象、发生时间、质量、来源 Skill、查询覆盖和原始引用。

### 告警

- 名称、编码、级别、对象；
- 发生、确认、清除、恢复和持续时长；
- 状态、原因、复位类型等原始字段；
- 来源 Skill、查询时间窗和告警原始 ID。

### 日志

- 原始日志行，不改写；
- 时间、级别、组件、对象；
- 归一化指纹、解析字段；
- 前后上下文记录；
- 命中次数和原始日志引用。

### KPI

- 指标名、单位、基线、阈值、峰值、异常和恢复时间；
- 小型趋势图与可悬浮精确样本；
- 采样周期、缺测点和覆盖范围；
- 告警/日志事件标记；
- 正常值用于竞争候选检查时仍显示原始值与完整覆盖。

### 数据缺失

必须显示缺失对象、指标、时间范围、原因、已覆盖范围和可替代数据；不得显示为“正常”。

## 6. Canonical Fact

```yaml
fact:
  fact_id: fact-alarm-reset
  fact_type: ALARM
  object_refs: [controller-0a]
  occurred_at: "2026-07-30T14:32:17.842+08:00"
  source:
    execution_id: exec-alarm-001
    skill_id: alarm_query
    source_refs: [alm-0a-78421]
    query_coverage: {object_coverage: COMPLETE, time_coverage: COMPLETE}
  quality: {level: HIGH, completeness: COMPLETE}
  payload:
    alarm_name: 控制器发生热复位
    severity: CRITICAL
    cleared_at: "2026-07-30T14:32:23.106+08:00"
    reason: watchdog_timeout
    reset_type: warm
```

## 7. FactDetailViewModel

```yaml
fact_detail_vm:
  fact_id: fact-alarm-reset
  kind: ALARM
  title: 控制器发生热复位
  subtitle: Controller-0A · Critical
  occurred_at_text: 14:32:17.842
  quality_badges: [完整覆盖, 高质量]
  summary_fields: []
  timeline: []
  chart: null
  raw_fields: []
  context_records: []
  source_trace: {}
  related_evidence_refs: []
  related_candidate_refs: []
```

前端按 `kind` 判别式渲染，不直接识别 Skill 自由 `records`。

## 8. CurrentActionViewModel

```yaml
current_action_vm:
  task_id: task-log-001
  execution_id: exec-log-001
  status: SUCCEEDED
  goal_text: 确认复位触发机制
  action_text: 日志指纹查询
  target_text: Controller-0A
  time_range_text: 14:32:07—14:32:18
  reason_text: 已发现热复位告警，但仍缺触发机制证据
  expected_text: watchdog_timeout 或 controller_reset
  result_text: 命中 watchdog_timeout，timeout_ms=3000
  fact_refs: [fact-watchdog-log]
  evidence_refs: [ev-reset-mechanism]
  candidate_updates: [{candidate_id: cand-controller-warm-reset, from: 62, to: 84}]
```

## 9. Agent Focus 与 User Selection

- 顶部 L1 永远显示 Agent 当前活动；
- 用户点击 Controller-0B 时，下半部可显示其详情，但不得覆盖 Agent 正在查询 Controller-0A；
- 新进展只显示提示点；
- “返回 Agent 视角”恢复当前活动对象和路径；
- 详情页的关闭只清理 `user_selection`，不改变 Runtime。

## 10. 加载与性能

- L1 与 L2 使用随快照下发的小载荷；
- L3 按 `fact_id` 懒加载完整样本和上下文；
- KPI 首屏最多下发用于绘图的降采样点，用户缩放后再加载局部精确点；
- 原始日志上下文默认前后各 3～5 条；
- 所有详情缓存必须按 session version 和 fact revision 失效。

## 11. 验收

- 控制器样例中的 38.6ms、0GB/s、15.6GB/s、timeout_ms=3000、告警生命周期和 CRC=0 均能三级追溯；
- Evidence 可引用多个 Fact；
- 前端不解析原始 Skill records；
- 正常值、无匹配、数据缺失、部分成功和失败不混淆；
- 点击详情不会打断 Agent 诊断或抢视角。

