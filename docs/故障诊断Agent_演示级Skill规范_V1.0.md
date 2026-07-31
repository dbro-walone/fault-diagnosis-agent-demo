# 故障诊断 Agent 演示级 Skill 规范 V1.0

> 总纲边界：Skill 只在用户故障现象完成标准化、Case 路由成功并创建 `diagnosis_session` 后，由 Planner Task 触发。Skill 返回可追溯的查询结果和结构化 Fact，不负责首屏 3D 模型、不直接生成 Evidence/Candidate/Conclusion，也不调用相机、节点动画或页面组件。

## 1. 文档定位

本规范用于故障诊断 Agent 可视化原型。当前阶段全部使用 Case 预设的 Mock 数据，目标是稳定、清晰地展示：

> 为什么调用 → 调用了什么 → 返回了什么 → 对诊断有什么作用

V1 不涉及真实接口、鉴权、并发、超时重试、自动发现、版本管理、参数校验、数据适配和生产级编排。

## 2. 冻结原则

1. Skill 只定义名称、用途和展示标识。
2. Skill 定义与具体 Case 数据分离，同一 Skill 可被多个 Case 复用。
3. 一次调用只展示调用原因、查询对象、时间范围和执行状态。
4. 返回结果只包含摘要和少量关键记录。
5. Mock 数据中的时间、对象、指标值和事件内容属于事实，前端不得修改。
6. Skill 只返回查询事实；证据解释、候选影响、分数变化和重规划决定由推理模块产生。
7. 一个 Skill 结果允许生成多条证据，并可分别关联不同候选。
8. 相似案例只作为辅助证据，不能单独确认根因。
9. 后续接入真实 Skill 时替换执行层，尽量保持展示协议兼容。

## 3. 数据职责边界

| 数据层 | 内容 |
|---|---|
| Skill 定义 | 名称、能力说明、展示图标 |
| Case 配置 | 调用参数、Mock 返回记录、预设事实、展示文案 |
| 推理结果 | 证据解释、候选影响、分数变化、是否重规划 |

## 4. Skill 最小定义

```yaml
skill:
  id: alarm_query
  name: 告警查询
  description: 查询相关对象在指定时间范围内的告警
  display_icon: alarm
```

| 字段 | 必填 | 说明 |
|---|---:|---|
| `id` | 是 | Skill 唯一标识 |
| `name` | 是 | 前端展示名称 |
| `description` | 是 | 简要说明查询能力 |
| `display_icon` | 否 | 前端图标类型 |

## 5. Skill 调用规范

```yaml
skill_call:
  execution_id: exec_003
  skill_id: alarm_query
  status: RUNNING
  target: Controller-0A及关联I/O路径对象
  time_range: 14:32:08-14:32:28
  reason: 验证控制器或链路是否发生明确故障
  display_text: 正在查询相关对象的告警
```

| 字段 | 必填 | 展示作用 |
|---|---:|---|
| `execution_id` | 是 | 标识本次执行 |
| `skill_id` | 是 | 指明调用的 Skill |
| `status` | 是 | 表示执行状态 |
| `target` | 是 | 展示查询对象或范围 |
| `time_range` | 否 | 展示诊断时间窗口 |
| `reason` | 是 | 说明调用原因 |
| `display_text` | 是 | 展示执行过程文案 |

复杂参数无需完整展示，只保留用户能够理解的关键内容。

## 6. Skill 返回规范

```yaml
skill_result:
  execution_id: exec_003
  status: SUCCESS
  summary: 发现Controller-0A热复位告警
  records:
    - time: 14:32:17.842
      object: Controller-0A
      content: 控制器发生热复位
  display_text: Controller-0A在业务异常前发生热复位
```

`records` 不规定统一业务字段，只需提供前端可直接展示的键值数据。

KPI 示例：

```yaml
records:
  - object: LUN-DB01
    metric: 平均I/O时延
    before: 1.8 ms
    abnormal: 38.6 ms
```

日志示例：

```yaml
records:
  - time: 14:32:17.615
    object: Controller-0A
    fingerprint: watchdog_timeout
    content: 看门狗超时
```

## 7. 执行状态

| 状态 | 含义 | 是否产生证据 |
|---|---|---:|
| `RUNNING` | Skill 正在执行 | 否 |
| `SUCCESS` | 查询成功并获得有效结果 | 是 |
| `EMPTY` | 查询成功但没有匹配数据 | 默认否 |
| `PARTIAL` | 只获得部分对象或时间范围的数据 | 视有效结果而定 |
| `FAILED` | Mock 执行失败 | 否 |

正式 Case 以 `SUCCESS`、`EMPTY` 为主，`FAILED`、`PARTIAL` 仅用于异常流程演示。

边界规则：

- `EMPTY` 不能直接解释为候选被排除。
- `FAILED` 不能解释为系统不存在异常。
- `PARTIAL` 必须说明未覆盖的对象或时间范围。
- 只有实际返回的事实才能转化为证据。
- `RUNNING → 结果状态` 可使用固定短暂动画模拟，不代表真实耗时。

## 8. 证据转换规范

Skill 返回事实，推理模块解释事实。演示中可在同一事件内连续展示，但概念上必须分离。

```yaml
evidence:
  id: evidence_005
  source_execution_id: exec_003
  type: DIRECT_FAULT
  candidate_id: controller_abnormal
  effect: STRONG_SUPPORT
  fact: Controller-0A发生热复位
  interpretation: 热复位能够解释主控制器I/O短时中断
  display_text: 强支持“Controller-0A异常或复位”
```

证据作用：

| `effect` | 含义 |
|---|---|
| `STRONG_SUPPORT` | 强支持候选 |
| `SUPPORT` | 一般支持候选 |
| `WEAKEN` | 削弱候选 |
| `NEUTRAL` | 暂时不能影响候选 |

V1 不使用 `EXCLUDE`；健康结果更适合表达为“削弱”或在综合推理后“基本排除”。

证据类型：

- `DIRECT_FAULT`：直接故障事件
- `MECHANISM`：触发机制
- `STATE_CHANGE`：对象状态变化
- `IMPACT`：业务影响
- `COUNTER_EVIDENCE`：竞争候选反证
- `REFERENCE`：历史案例等辅助信息

## 9. 前端展示流程

一次 Skill 调用统一展示五个动作：

```text
Planner选择Skill
→ 展示调用原因
→ 展示对象与时间范围
→ 返回Mock查询结果
→ 转换为证据并更新候选
```

候选分数更新属于推理结果，不属于 Skill 返回值。

Skill 的视觉反馈必须经由统一 Runtime Event：

```text
TASK_STATUS_CHANGED(RUNNING)
→ SKILL_STARTED
→ SKILL_COMPLETED / SKILL_FAILED
→ FACT_DISCOVERED
```

前端根据 `diagnosis_session` 在 3D 模型和过程面板中显示任务、事实及关联对象；Skill 实现不得直接驱动画面。

## 10. V1 Skill 清单

| Skill ID | 展示名称 | 主要作用 |
|---|---|---|
| `business_mapping` | 业务资源映射 | 将业务对象映射到 VM、Host、LUN |
| `topology_query` | 拓扑查询 | 展开端到端 I/O 路径 |
| `alarm_query` | 告警查询 | 查询控制器、端口等对象的告警 |
| `log_fingerprint_query` | 日志指纹查询 | 查询异常日志及故障指纹 |
| `kpi_query` | KPI 查询 | 查询时延、吞吐、利用率等指标 |
| `link_health_query` | 链路健康查询 | 查询端口状态、CRC 和链路变化 |
| `similar_case_query` | 相似案例查询 | 查询历史相似故障案例 |

存储池性能检查统一使用 `kpi_query`，不单独定义 Skill。

## 11. 完整演示事件

```yaml
event_type: SKILL_EXECUTION

skill_call:
  execution_id: exec_003
  skill_id: alarm_query
  status: RUNNING
  target: Controller-0A及关联I/O路径对象
  time_range: 14:32:08-14:32:28
  reason: 验证控制器及链路候选
  display_text: 正在查询故障时间窗口内的相关告警

skill_result:
  status: SUCCESS
  summary: 发现Controller-0A热复位告警
  records:
    - time: 14:32:17.842
      object: Controller-0A
      severity: critical
      content: 控制器热复位
  display_text: Controller-0A在业务异常前278ms发生热复位

evidence:
  id: evidence_005
  source_execution_id: exec_003
  type: DIRECT_FAULT
  candidate_id: controller_abnormal
  effect: STRONG_SUPPORT
  fact: Controller-0A发生热复位
  interpretation: 控制器复位可能造成主I/O路径短时中断
  display_text: 强支持“Controller-0A异常或复位”

reasoning_update:
  candidate_id: controller_abnormal
  score_before: 32
  score_after: 62
  next_action: REPLAN
```

## 12. V1 完成标准

满足以下条件即可认为演示级 Skill 规范完成：

- 前端能展示 Skill 的选择原因、查询范围、执行过程和返回结果；
- Mock 返回可以稳定转化为一条或多条证据；
- Skill 事实与推理结论在数据结构上可区分；
- 候选变化和 Planner 重规划能追溯到来源 Skill；
- 同一 Skill 能在不同 Case 中复用；
- 不依赖任何真实数据接口或生产级 Skill 框架。
