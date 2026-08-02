# 故障诊断 Agent Planner 输出协议与重规划基线 V2.0

## 1. 职责

Planner 决定：当前验证什么、为什么优先、调用哪个 Skill、查询哪些对象与时间窗、期望获得什么证据、何时重规划。

Planner 不负责：把 Skill 结果认定为 Fact、计算证据作用、更新支持分或确认根因。

## 2. 逐轮闭环

```text
读取 Diagnosis Snapshot
→ 识别最高价值证据缺口
→ 生成一个主任务及可选后台任务
→ Runtime执行 Skill
→ Fact/Evidence/Candidate 更新
→ 继续、重规划、追问或结束
```

V2 仍允许确定性 Case Planner；未来大模型 Planner 必须输出相同契约。

## 3. 诊断阶段

```text
INPUT_COMPLETION
SYMPTOM_VALIDATION
SCOPE_LOCALIZATION
CANDIDATE_GENERATION
CANDIDATE_EVIDENCE
COMPETING_EXPLANATION
CONCLUSION_CHECK
SUPPLEMENTARY_PLANNING
```

八幕不属于 Planner 阶段。

## 4. 输入协议

```yaml
planner_input:
  schema_version: "2.0"
  session_id: session-controller-001
  planning_round: 3
  phase: CANDIDATE_EVIDENCE
  symptom: {}
  mapped_object_refs: [lun-db01]
  candidates:
    - candidate_id: cand-controller-warm-reset
      diagnosis_support_score: 62
      status: LEADING
  evidence_summary:
    satisfied_requirement_ids: [direct_fault, affected_path]
    pending_requirement_ids: [mechanism, impact, competitor_check]
    critical_conflict_refs: []
  executed_task_refs: []
  active_task_refs: []
  available_skill_ids: []
  budgets:
    max_remaining_tasks: 6
    deadline_ms: 30000
```

输入只能包含当前 sequence 已知内容。

## 5. 输出协议

```yaml
planner_output:
  schema_version: "2.0"
  plan_id: plan-controller-003
  previous_plan_id: plan-controller-002
  planning_round: 3
  generated_at: "2026-07-30T14:35:03.120+08:00"
  phase: CANDIDATE_EVIDENCE
  planning_decision: REPLAN
  primary_goal: 确认Controller-0A复位触发机制和影响链
  decision_basis:
    new_evidence_refs: [ev-controller-reset-alarm]
    candidate_update_refs: [cu-controller-002]
    missing_requirement_ids: [mechanism, impact]
    reason: 已发现热复位告警，应优先闭环触发机制和影响链
  primary_task_id: task-log-001
  tasks: []
  changes: []
  stop_check: {}
  next_state: EXECUTING_TASK
  display:
    current_goal_text: 确认Controller-0A复位触发机制
    reason_text: 已发现热复位告警，但仍缺触发机制证据
    next_action_text: 查询复位前日志指纹
    expected_text: watchdog_timeout或controller_reset
```

`display` 是结构化可展示摘要，不替代 `decision_basis`。

## 6. 任务协议

```yaml
task:
  task_id: task-log-001
  action: QUERY_LOG_FINGERPRINT
  skill_id: log_fingerprint_query
  goal: 确认复位底层触发机制
  target_candidate_refs: [cand-controller-warm-reset]
  target_object_refs: [controller-0a]
  time_range: {start: ..., end: ...}
  parameters:
    fingerprint_types: [watchdog_timeout, controller_reset]
  expected_evidence:
    - requirement_id: mechanism
      description: 复位前出现看门狗超时或reset序列
  selection_reason: 该任务能区分控制器自身异常与外部链路问题
  priority: 100
  execution_mode: SEQUENTIAL
  ui_role: PRIMARY
  status: READY
  on_success: EVALUATE_AND_REPLAN
  on_failure: RECORD_UNKNOWN_AND_FALLBACK
```

`ui_role` 取 `PRIMARY | BACKGROUND`。并行不意味着多个“当前主活动”。

## 7. 任务状态

```text
PLANNED → READY → RUNNING
→ SUCCEEDED | FAILED | PARTIAL | DATA_MISSING | CANCELLED | SKIPPED
```

- `DATA_MISSING`：查询成功但目标数据不可用；
- `PARTIAL`：对象、时间或指标只覆盖一部分；
- `SUCCEEDED`：调用成功且结果可被 Normalizer 处理，不自动意味着产生支持证据；
- 只有完整覆盖的正常结果才能生成用于削弱候选的 `ABSENCE/正常值 Fact`。

## 8. 重规划

触发条件：强证据、新候选、领先候选被削弱、关键排序变化、冲突、接近确认需反证、Skill失败/缺失、任务信息价值下降、最小链已满足。

```yaml
plan_change:
  operation: ADD | REPRIORITIZE | SUSPEND | CANCEL | REPLACE | KEEP
  task_id: task-link-health-001
  replacement_task_id: null
  previous_priority: 80
  current_priority: 55
  reason: 控制器直接故障证据提高，应先闭环触发机制
```

每次 `PLAN_REPLANNED` 必须引用 `previous_plan_id`、触发 Evidence、逐项变化和原因。

## 9. 追问

当对象、现象或时间窗不足时输出：

```yaml
planning_decision: ASK_USER
user_question:
  question_id: q-start-time
  prompt: 业务变慢大约从什么时间开始？
  options: []
  allow_free_text: true
  blocking: true
```

Planner 不通过模糊默认值悄悄补齐关键输入。

## 10. 结束决策

```text
CONTINUE_INVESTIGATION
REPLAN
ASK_USER
ROOT_CAUSE_CONFIRMED
PROBABLE_CAUSES
INSUFFICIENT_EVIDENCE
SKILL_EXECUTION_BLOCKED
```

`ROOT_CAUSE_CONFIRMED` 只能在 Runtime/Reasoning 的 stop check 已满足时由状态机接受；Planner 建议不能越过确认规则。

## 11. 三类 Case 的计划差异

- 控制器热复位：直接告警后转向机制、接管、影响和竞争链路检查；
- 扰邻：从 Host-B 影响路径定位共享瓶颈，再新增 sibling consumer 分析，回溯 Host-A；
- 远程复制：先拆分源端业务、复制、网络和远端落盘四域，再对最高信息增益域取证。

差异只体现在目标、对象、任务和证据要求，不改变协议。

## 12. 验收

- LUI 可直接显示当前目标、原因、下一步和期望证据；
- 每个任务引用候选、对象、Skill 和证据要求；
- 重规划可显示前后差异；
- 并行任务只有一个 primary；
- Planner 不返回 Fact、Evidence 作用或支持分；
- 大模型 Planner 可替换确定性 Planner 而不改前端。

