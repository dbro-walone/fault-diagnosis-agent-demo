# 故障诊断 Agent 演示级 Skill 规范 V2.0

## 1. 定位

Skill 负责在明确对象、时间窗和参数下查询数据，返回调用结果和原始引用。其目标是回答“查到了什么”，不是“根因是什么”。

## 2. 定义

```yaml
skill:
  skill_id: kpi_query
  name: KPI查询
  version: "1.0"
  capability: 查询对象在指定窗口的指标时序
  input_schema_ref: schema://kpi-query-input
  output_kind: KPI_RECORDS
  display_icon: kpi
```

## 3. 调用

```yaml
skill_execution:
  execution_id: exec-kpi-001
  task_id: task-query-kpi
  skill_id: kpi_query
  status: RUNNING
  target_object_refs: [lun-db01]
  time_range: {start: ..., end: ...}
  parameters: {indicator_ids: [lun_latency]}
  query_coverage_requested:
    objects: [lun-db01]
    metrics: [lun_latency]
    start: ...
    end: ...
  reason: 验证业务变慢是否对应LUN时延异常
```

## 4. 结果

```yaml
skill_result:
  execution_id: exec-kpi-001
  status: SUCCEEDED
  summary: LUN平均时延由1.8ms升至38.6ms
  raw_records: []
  source_refs: [kpi-lun-db01-latency]
  actual_coverage:
    object_coverage: COMPLETE
    time_coverage: COMPLETE
    metric_coverage: COMPLETE
  data_quality:
    completeness: COMPLETE
    missing_intervals: []
  normalizer_hint: KPI_WINDOW
```

`raw_records` 是 Fact Normalizer 输入，前端不得直接解析。

## 5. 状态

| 状态 | 含义 | 是否自动生成 Evidence |
|---|---|---:|
| RUNNING | 执行中 | 否 |
| SUCCEEDED | 调用成功 | 否，先生成 Fact |
| PARTIAL | 部分覆盖 | 否，Fact标记覆盖不足 |
| DATA_MISSING | 所需数据不可用 | 否 |
| FAILED | 调用失败 | 否 |
| CANCELLED | 被计划取消 | 否 |
| SKIPPED | 条件不满足或无价值 | 否 |

旧 `SUCCESS`→`SUCCEEDED`，旧 `EMPTY`→`DATA_MISSING`；若完整查询返回0条匹配，由 Normalizer 创建带完整查询条件的 `ABSENCE` Fact。

## 6. Fact Normalizer 输入要求

结果至少提供：

- `execution_id`、`task_id`、`skill_id`；
- 查询对象、时间范围和关键参数；
- 原始记录或可解析结果；
- `source_refs`；
- 实际覆盖和数据质量；
- 时区与单位；
- 若失败，错误类型和可重试性。

Normalizer 负责类型化为 ALARM、LOG、LOG_FINGERPRINT、KPI_WINDOW、TOPOLOGY_RELATION、RESOURCE_STATE、ABSENCE 等 Fact。

## 7. 事实与推理边界

错误示例：

```yaml
skill_result:
  conclusion: Controller-0A是根因
  candidate_score: 96
```

正确链路：

```text
Skill返回“14:32:17.842发生热复位告警”
→ Fact Normalizer创建ALARM Fact
→ Reasoning解释为直接故障Evidence
→ Candidate Update修改诊断支持分
```

## 8. 基线 Skill

| Skill ID | 能力 |
|---|---|
| `business_mapping` | 业务对象映射到 Host/VM/LUN/FS |
| `topology_query` | 查询上下游、共享关系、主备和复制关系 |
| `alarm_query` | 查询告警生命周期与字段 |
| `log_fingerprint_query` | 查询日志、指纹和上下文 |
| `kpi_query` | 查询指标时序、基线、阈值和异常窗口 |
| `link_health_query` | 查询链路状态、CRC、丢包和变化 |
| `similar_case_query` | 查询历史相似案例，仅辅助 |
复制会话的 RPO、积压、带宽等指标统一由 `kpi_query` 查询；复制对象和共享资源消费者统一由 `topology_query` 展开。

扰邻分析不新增任何专用 Skill。它由 Agent 根据故障图谱执行“受害者路径定位→共享关系展开→兄弟消费者回溯”的推理，并组合既有 `topology_query`、`kpi_query`、`alarm_query`、`log_fingerprint_query` 完成取证。

## 9. 查询覆盖

任何用于削弱候选的正常结果必须证明：对象覆盖完整、时间窗覆盖完整、指标/事件类型覆盖完整、数据质量可接受。否则只能是 `PARTIAL` 或 `DATA_MISSING`。

## 10. 安全与可审计

- Skill 只能访问 Planner 白名单允许的对象和时间窗；
- 每次执行保留输入摘要、来源、耗时、状态和错误；
- Mock 与真实执行都显式标记 `data_mode`；
- 前端不显示凭据或敏感查询参数；
- 相同 Case 回放不重复调用真实外部数据源。

## 11. 验收

- 不同 Case 可复用同一 Skill；
- 每个成功结果可生成一个或多个 Canonical Fact；
- 原始引用和查询覆盖可追溯；
- FAILED、PARTIAL、DATA_MISSING 和完整无匹配不混淆；
- Skill 不输出 Evidence、候选变化和结论。
