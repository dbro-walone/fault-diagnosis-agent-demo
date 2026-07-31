# 故障诊断 Agent：Planner 输出协议与重规划基线 V1.0

> 文档状态：基线冻结  
> 版本：V1.0  
> 日期：2026-07-30  
> 适用范围：故障诊断 Agent 可视化原型及首个 `controller_warm_reset_001` Case  
> 关联基线：《故障诊断Agent_可视化原型与诊断推理基线_V1.0》

> 总纲边界：用户进入系统后首先看到 3D 实例拓扑—故障知识图谱融合模型。Planner 只在故障现象完成标准化、Case 路由成功并创建 `diagnosis_session` 后运行。Planner 通过 Plan、Task 和 Runtime Event 解释“为什么查、查什么、期望得到什么”，不负责首屏模型，也不直接控制相机、节点或动画。

## 1. 文档目的

本文档冻结故障诊断 Agent V1 原型中的 Planner 职责边界、逐轮输出协议、任务协议、重规划协议和结束条件，并规定控制器热复位 Case 的标准展示过程。

V1 的目标不是证明已经具备真实大模型自主规划能力，而是：

1. 准确展示 Planner 如何根据当前诊断状态选择下一步验证任务；
2. 准确展示新证据如何触发任务新增、取消、降级和顺序调整；
3. 形成 Diagnosis Runtime、前端诊断过程区、Case 数据和未来真实 Planner 共用的稳定协议；
4. 保证演示结果稳定、可解释、可回归验证。

## 2. V1 定位与阶段边界

### 2.1 当前实现定位

V1 采用：

> 固定诊断阶段骨架 + Case 驱动的确定性任务生成 + 协议化重规划展示

Planner 的任务及重规划结果由 Case 数据预设，运行时根据证据返回逐轮推进。前端不得通过定时动画假装规划，也不得自行生成诊断结论。

### 2.2 当前不实现

- 不接入真实大模型生成下一步任务；
- 不允许大模型自由选择任意 Skill 或任意参数；
- 不宣称具备开放场景自主规划能力；
- 不实现基于强化学习或统计模型的任务排序；
- 不将演示用诊断分解释为统计学概率。

### 2.3 后续阶段

V2 可接入真实大模型 Planner，但必须继续输出本文档规定的数据结构，并接受相同的协议校验、权限约束、执行校验和回归评测。

## 3. 模块职责边界

| 模块 | 核心职责 | 不负责 |
|---|---|---|
| 现象理解/推理模块 | 解析业务现象，生成指标假设、候选及证据缺口 | 不直接执行查询 |
| Planner | 决定下一步验证目标、任务顺序和是否重规划 | 不把查询结果判定为事实 |
| Skill Executor | 校验参数、执行查询、返回标准化结果 | 不决定根因 |
| 证据融合模块 | 评价证据类型与质量，更新候选状态和诊断分 | 不选择具体查询接口 |
| 诊断状态机 | 判断继续、重规划、追问或结束 | 不生成查询参数 |
| 前端诊断视图 | 按 Session 和 Runtime Event 展示全过程 | 不自行规划、推理、补数据或直接操纵 Planner |

简化表达：

```text
推理模块：当前怀疑什么、还缺什么证据
Planner：下一步验证什么、调用什么 Skill、如何查询
Skill：返回实际查到的事实
证据融合：证据支持或削弱哪些候选
状态机：继续、重规划、追问还是结束
```

## 4. Planner 工作模式

### 4.1 固定阶段骨架

| 阶段 | 阶段目标 | 典型产出 |
|---|---|---|
| INPUT_COMPLETION | 补齐启动诊断所需信息 | 用户追问或完整输入 |
| SYMPTOM_VALIDATION | 将业务描述转化为客观异常 | KPI证据 |
| SCOPE_LOCALIZATION | 定位业务资源及端到端路径 | 资源映射、拓扑子图 |
| CANDIDATE_GENERATION | 生成可验证的根因候选 | 候选列表及来源 |
| CANDIDATE_EVIDENCE | 查询候选所需的直接或关联证据 | 告警、日志、KPI |
| COMPETING_EXPLANATION | 验证竞争候选和关键冲突 | 反证或支持不足 |
| CONCLUSION_CHECK | 检查最小证据链 | 终态或证据缺口 |
| SUPPLEMENTARY_PLANNING | 证据不足时生成补充任务 | 新任务或追问 |

阶段骨架固定，但阶段内任务、目标对象、查询范围、优先级和任务状态允许动态变化。

### 4.2 逐轮闭环

```text
读取当前诊断状态
→ 识别最高优先级证据缺口
→ 选择下一验证目标
→ 生成可执行 Skill 任务
→ Skill 执行并返回结果
→ 证据融合并更新候选
→ 判断继续原计划、重规划、追问或结束
```

Planner 不一次性输出不可变的完整诊断流程。允许展示总体计划摘要，但每轮只提交当前可执行任务。

## 5. Planner 输入协议

```yaml
planner_input:
  schema_version: "1.0"
  case_id: controller_warm_reset_001
  planning_round: 3

  diagnosis_context:
    symptom:
      business_object: 交易数据库
      phenomenon: 访问变慢
      time_range:
        start: "2026-07-30T14:32:00.000+08:00"
        end: "2026-07-30T14:35:00.000+08:00"

    metric_hypotheses:
      - metric: response_latency
        expected_anomaly: increase
        priority: HIGH

    mapped_resources:
      - resource_id: lun-db01
        resource_name: LUN-DB01
        resource_type: LUN
        mapping_source: MOCK

    candidates:
      - candidate_id: candidate_controller
        name: Controller-0A异常或复位
        status: VALIDATING
        diagnosis_score: 62

    evidence_summary:
      confirmed_evidence_ids:
        - evidence_alarm_001
      missing_evidence:
        - 控制器异常触发机制
        - 故障到业务影响的时间关联
      conflicts: []

    executed_tasks:
      - task_id: task_alarm_001
        execution_status: SUCCEEDED

    pending_tasks:
      - task_id: task_pool_001
        execution_status: PLANNED
```

### 5.1 输入约束

- `symptom` 必须来自用户自然语言输入及主动追问后的标准化结果；
- `metric_hypotheses` 来自 Agent 结合故障知识图谱的推理，仅表示待验证假设；
- `mapped_resources` 在 V1 中来自标准化 Mock 接口；
- `candidates`、`evidence_summary` 和任务状态必须来自当前轮真实状态，不能提前包含后续答案；
- 查询失败、数据缺失与正常结果必须使用不同状态表达。

## 6. Planner 输出协议

```yaml
planner_output:
  schema_version: "1.0"
  plan_id: plan_controller_003
  planning_round: 3
  generated_at: "2026-07-30T14:35:03.120+08:00"

  current_stage: CANDIDATE_EVIDENCE
  planning_decision: REPLAN
  primary_goal: 确认Controller-0A复位的触发机制及影响链

  decision_basis:
    new_evidence_ids:
      - evidence_alarm_001
    candidate_changes:
      - candidate_id: candidate_controller
        previous_score: 32
        current_score: 62
        previous_status: PENDING_VALIDATION
        current_status: SUPPORTED
    missing_evidence:
      - 控制器异常触发机制
      - 控制器状态变化
      - 业务影响时间一致性
    reason: 已发现控制器热复位直接告警，应优先验证触发机制和故障传播链

  tasks:
    - task_id: task_log_001
      action: QUERY_LOG_FINGERPRINT
      skill_id: log_fingerprint_query
      goal: 确认Controller-0A热复位的底层触发机制
      target_candidate_ids:
        - candidate_controller
      targets:
        - resource_id: controller-0a
          resource_type: CONTROLLER
      time_range:
        start: "2026-07-30T14:32:07.842+08:00"
        end: "2026-07-30T14:32:18.120+08:00"
      parameters:
        fingerprint_types:
          - watchdog_timeout
          - controller_reset
      expected_evidence:
        - type: TRIGGER_MECHANISM
          description: 复位前出现watchdog超时或reset序列
      selection_reason: 该任务能直接区分控制器自身异常与外部链路问题
      priority: 100
      execution_mode: SEQUENTIAL
      execution_status: READY
      on_success: EVALUATE_AND_REPLAN
      on_failure: RECORD_UNKNOWN_AND_FALLBACK

  plan_changes:
    added_task_ids:
      - task_log_001
      - task_failover_kpi_001
    reprioritized_tasks:
      - task_id: task_link_health_001
        previous_priority: 80
        current_priority: 55
        reason: 已出现更高价值的控制器直接故障证据
    suspended_tasks:
      - task_id: task_pool_deep_analysis_001
        reason: 当前阶段优先验证控制器故障链，池深度分析暂缓
    cancelled_tasks: []

  stop_check:
    minimum_evidence_set_satisfied: false
    unresolved_critical_conflicts: false
    score_threshold_satisfied: false
    decision: CONTINUE_INVESTIGATION

  next_state: EXECUTING_TASK
```

## 7. Skill 任务协议

每个 Planner 任务必须至少包含以下信息：

| 字段 | 是否必需 | 含义 |
|---|---:|---|
| `task_id` | 是 | Case 内唯一任务标识 |
| `action` | 是 | 标准化任务动作 |
| `skill_id` | 是 | 可执行 Skill 标识 |
| `goal` | 是 | 本次查询要验证什么 |
| `target_candidate_ids` | 是 | 支持验证或排除的候选 |
| `targets` | 是 | 查询对象及对象类型 |
| `time_range` | 是 | 查询时间范围 |
| `parameters` | 是 | Skill 参数 |
| `expected_evidence` | 是 | 期望获得的证据或反证 |
| `selection_reason` | 是 | Planner 选择该任务的原因 |
| `priority` | 是 | 任务优先级，0—100 |
| `execution_mode` | 是 | 顺序、并行或条件执行 |
| `execution_status` | 是 | 当前任务状态 |
| `on_success` / `on_failure` | 是 | 成功或失败后的控制动作 |

### 7.1 任务状态

```text
PLANNED
→ READY
→ RUNNING
→ SUCCEEDED | FAILED | PARTIAL | DATA_MISSING | CANCELLED | SKIPPED
```

其中：

- `FAILED`：Skill 调用失败；
- `DATA_MISSING`：查询成功但所需数据不存在；
- `PARTIAL`：只覆盖部分对象、时间或指标；
- `SUCCEEDED`：成功获得完整查询结果；
- 只有结果明确正常且覆盖范围充分时，才可形成排除证据。

## 8. 重规划协议

### 8.1 重规划触发条件

出现以下任一情况时，状态机可以要求 Planner 重规划：

1. 发现直接故障证据；
2. 候选排名或状态发生显著变化；
3. 原计划的关键假设被证伪；
4. 发现新的关联对象、传播路径或故障机制；
5. Skill 查询失败、数据缺失或仅部分覆盖；
6. 出现与当前首选候选冲突的关键证据；
7. 已接近根因确认，需要主动查询竞争候选；
8. 当前任务预期信息增益明显降低；
9. 已满足最小证据集合，应停止剩余无意义任务。

### 8.2 计划变更类型

| 变更类型 | 含义 |
|---|---|
| `ADD` | 新证据暴露新的验证任务 |
| `REPRIORITIZE` | 调整未执行任务优先级 |
| `SUSPEND` | 暂停低价值任务，后续可恢复 |
| `CANCEL` | 任务已无必要，明确取消 |
| `REPLACE` | 原任务范围或参数不再适用，用新任务替代 |
| `KEEP` | 新证据不足以改变当前计划 |

每次重规划必须同时保留 `previous_plan_id`、变更列表及逐项原因，前端以差异方式展示，不能只刷新成一份新计划。

### 8.3 重规划输出示例

```yaml
replan:
  replan_id: replan_001
  previous_plan_id: plan_controller_002
  trigger:
    type: DIRECT_EVIDENCE_FOUND
    evidence_id: evidence_alarm_001
    description: Controller-0A出现热复位严重告警

  changes:
    - operation: ADD
      task_id: task_log_001
      reason: 需要确认热复位的触发机制
    - operation: ADD
      task_id: task_failover_kpi_001
      reason: 需要验证0A中断、0B接管和业务影响链
    - operation: REPRIORITIZE
      task_id: task_link_health_001
      from: 80
      to: 55
      reason: 链路候选仍需验证，但优先级低于直接故障证据的闭环验证
    - operation: SUSPEND
      task_id: task_pool_deep_analysis_001
      reason: 当前没有池瓶颈支持证据
```

## 9. Planner 决策与结束状态

每轮输出必须给出一个 `planning_decision`：

```text
CONTINUE_INVESTIGATION
REPLAN
ASK_USER
ROOT_CAUSE_CONFIRMED
PROBABLE_CAUSES
INSUFFICIENT_EVIDENCE
SKILL_EXECUTION_BLOCKED
```

### 9.1 根因确认条件

当前 Case 的 `ROOT_CAUSE_CONFIRMED` 必须同时满足：

```text
至少1条直接故障证据
AND 至少1条触发机制证据
AND 至少1条状态变化证据
AND 至少1条业务影响证据
AND 故障、影响、恢复的时间顺序符合因果关系
AND 不存在未解释的关键冲突证据
AND 第一候选诊断分 ≥ 85
AND 与第二候选诊断分差距 ≥ 30
```

诊断分是演示用诊断评分，不能替代最小证据集合。

## 10. 任务优先级基线

Planner 按以下原则决定顺序：

1. 优先验证初始业务现象是否真实；
2. 优先执行低成本、高覆盖面的查询；
3. 优先查询时间和对象上距离现象最近的数据；
4. 优先选择能区分多个竞争候选的任务；
5. 出现直接故障证据后，优先验证触发机制与影响链；
6. 根因接近确认时，主动寻找关键反证；
7. 查询失败或数据缺失不能解释为正常；
8. 满足最小证据集合后停止继续取证。

原型中可预设 `priority`，但必须显示 `selection_reason`。后续真实 Planner 可参考：

```text
任务价值 =
候选区分能力
+ 证据证明力
+ 时间相关性
+ 对象相关性
+ 预期信息增益
- 查询成本
- 数据缺失风险
```

## 11. 控制器热复位 Case 的标准规划过程

### Round 0：输入完整性判断

- 输入：用户描述“交易数据库刚才突然变慢了”；
- 缺失：明确时间范围；
- 决策：`ASK_USER`；
- 结果：用户补充“大约14:32开始，持续几十秒”。

### Round 1：现象验证与范围定位

- 目标：把业务描述映射为客观异常并定位资源；
- 任务：业务资源映射、LUN基础KPI、端到端拓扑；
- 结果：定位 `LUN-DB01`，确认时延由 `1.8 ms` 升至 `38.6 ms`，展开访问路径；
- 决策：生成路径相关的四个候选。

### Round 2：第一轮候选取证

- 候选：控制器异常、FC链路抖动、SAN交换链路异常、存储池瓶颈；
- 目标：优先查询覆盖整条路径的直接异常；
- 任务：路径对象告警查询；
- 结果：发现 `Controller-0A` 热复位严重告警；
- 决策：`REPLAN`。

### Round 3：第一次重规划

计划差异：

- 新增：控制器复位前日志与指纹查询；
- 新增：0A/0B吞吐、主备切换及LUN时延关联分析；
- 降级：FC/SAN健康查询；
- 暂停：存储池深度性能分析。

结果：

- 命中 `watchdog_timeout` 和热复位日志指纹；
- `Controller-0A` 吞吐降为0；
- `Controller-0B` 接管；
- LUN时延随后回落。

控制器候选由“异常或复位”细化为：

> Controller-0A 的 `watchdog_timeout` 触发热复位。

### Round 4：第二次重规划

此时最小证据集合中已具备直接证据、触发机制、状态变化和业务影响，但仍需检查竞争解释。

计划差异：

- 恢复并提高 FC/SAN 健康查询优先级；
- 将存储池查询从“深度分析”替换为“关键KPI快速检查”；
- 增加关键冲突检查。

结果：

- FC端口在线、CRC错误无增量；
- 双SAN无对应异常；
- 存储池及后端磁盘关键KPI正常；
- 未发现能够更好解释现象的冲突证据。

### Round 5：结束判断

- 最小证据集合：满足；
- 关键冲突：无；
- 第一候选诊断分：96；
- 与第二候选差距：满足；
- 决策：`ROOT_CAUSE_CONFIRMED`；
- 取消：尚未执行且已无信息价值的深度查询任务。

最终影响链：

```text
Controller-0A发生watchdog超时
→ Controller-0A触发热复位
→ 主控制器I/O短时中断
→ Block Service执行主备切换
→ LUN-DB01时延升高
→ 交易数据库访问变慢
→ Controller-0B接管后业务恢复
```

## 12. 前端展示基线

Planner 展示至少包含：

1. 当前阶段、当前目标和规划轮次；
2. 当前选择的 Skill 任务及选择原因；
3. 任务验证的候选与预期证据；
4. Skill 执行结果与结果状态；
5. 新证据对候选状态和诊断分的影响；
6. 重规划触发原因；
7. 新旧计划差异，包括新增、调序、暂停、替换和取消；
8. 最小证据集合完成度；
9. 继续、追问、证据不足或结束的明确决策。

前端严禁：

- 在 Skill 返回前展示后续证据；
- 用动画时间轴代替真实任务状态；
- 把 `DATA_MISSING` 展示为“对象正常”；
- 隐藏任务取消或重规划原因；
- 在 V1 界面宣称任务由大模型实时自主生成。

## 13. 协议校验与验收标准

### 13.1 协议校验

- Planner 输入、输出和重规划事件符合统一 Schema；
- 所有 ID 在单个 Case 中唯一且可追溯；
- 任务目标、候选、Skill、对象和预期证据之间能够闭环；
- 计划变更能够关联上一版本计划；
- Skill 结果状态不混淆失败、缺失、部分和正常；
- 终态与最小证据集合一致。

### 13.2 原型验收

- 同一 Case 重复播放结果一致；
- 用户只能从业务现象开始，不能提前看到根因证据；
- 至少完整展示两次有原因、有差异的重规划；
- 新证据能够驱动任务新增、降级、替换或取消；
- 满足根因确认条件后停止无价值查询；
- 切换为证据缺失数据时，能够进入 `PROBABLE_CAUSES` 或 `INSUFFICIENT_EVIDENCE`；
- 前端不包含独立推理逻辑，更换 Planner 实现无需修改播放协议。

## 14. V2 真实大模型 Planner 接入要求

后续接入真实大模型 Planner 时，应增加但不限于：

- 结构化输出 Schema 校验与自动修复；
- Skill 白名单、参数类型与查询范围校验；
- 资源与数据访问权限控制；
- 无效、重复、循环和高成本计划拦截；
- Token、调用次数、时延及预算约束；
- Planner 输出与实际执行结果的完整审计；
- 相同 Case 的任务完成率、一次成功率、平均重规划轮数和 Skill 有效调用率评测；
- 确定性 Case Planner 作为回归基线，与真实 Planner 做对照验证；
- 真实 Planner 失败时回退到受控诊断流程。

## 15. 冻结项与待完善项

### 15.1 V1 冻结项

- 固定阶段骨架、逐轮任务生成；
- Case 驱动的确定性 Planner；
- Planner 输入、输出、任务和重规划协议；
- 任务状态、计划变更类型和结束状态；
- 控制器热复位 Case 的两次重规划及最终结束路径；
- 前端只展示协议事件，不自行推理；
- 后续真实 Planner 必须兼容 V1 协议。

### 15.2 后续待完善

1. 将协议正式转换为 JSON Schema，并定义字段枚举与校验错误码；
2. 明确 Skill 标准输出协议及证据对象转换规则；
3. 设计查询失败、数据缺失、冲突证据三类异常分支 Case；
4. 定义 Planner 质量评测指标与标准 Case 集；
5. 设计真实大模型 Planner 的提示词、约束器与回退机制；
6. 将 Planner 事件写入统一 Runtime Event，并由 Story 检查点按 `event_id/sequence` 引用。

## 16. 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| V1.0 | 2026-07-30 | 冻结 V1 Planner 输出协议、重规划流程、控制器热复位标准过程及 V2 接入边界 |
