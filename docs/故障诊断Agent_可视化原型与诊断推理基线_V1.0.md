# 故障诊断 Agent 可视化原型与诊断推理基线 V1.0

> 状态：已完成 3D 产品主线与 Runtime 语义对齐  
> 版本：V1.1  
> 日期：2026-07-30  
> 首个基线 Case：`controller_warm_reset_001`

## 1. 文档目的

本文档用于冻结故障诊断 Agent 可视化原型与诊断推理阶段的共同基线，作为后续原型开发、Mock Case 制作、数据 Schema 设计、真实 Agent 接入和验收评测的统一依据。

当前原型定义为：

> 一套以 3D 实例拓扑—故障知识图谱融合模型为首屏、由用户故障现象触发 Case、通过统一 Runtime Event 推进诊断状态，并在同一模型上完成推演、结论收敛和历史复盘的故障诊断 Agent 演示系统。

核心设计原则：

1. 用户进入系统后首先探索 3D 实例拓扑、故障知识图谱及跨层映射，诊断流程不是默认首页；
2. 用户输入故障现象后，必须先标准化现象并路由到唯一 Case，才能创建 Diagnosis Session；
3. 页面不感知具体故障类型，新增 Case 原则上只增加数据和路由元数据；
4. Agent 初始只知道用户输入及可查询入口，基础设施证据必须通过 Skill 查询逐步获得；
5. 候选生成、取证、削弱、冲突消解和根因确认必须形成可解释诊断链；
6. 根因确认不能只依赖诊断支持分，必须满足最小证据链、竞争候选检查和冲突检查；
7. Story Scene 只负责演示节奏，不能修改诊断状态；真实状态只由 Runtime Event 改变；
8. 允许输出根因确认、多个可能原因和证据不足三类终态。

---

## 2. 总体架构基线

### 2.1 分层职责

| 层级 | 主要职责 | 是否感知具体 Case |
|---|---|---|
| Model Asset | 提供实例拓扑、故障知识图谱、跨层映射和 3D 投影配置 | 否 |
| 3D Model Scene | 呈现模型探索态并承载诊断 Overlay | 否 |
| Symptom Normalizer | 将用户输入转换为标准故障现象、对象和时间窗 | 否 |
| Case Registry | 扫描、列举、切换 Case | 只感知 Case 元数据 |
| Case Router | 根据标准现象匹配 Case，处理歧义和未匹配 | 只感知路由元数据 |
| Case Loader | 加载 JSON，校验版本和引用 | 否 |
| Case Adapter | 转换为统一运行时模型 | 否 |
| Diagnosis Runtime | 追加统一事件、执行 Reducer、生成快照和检查点 | 否 |
| Session Projector | 将事件序列确定性投影为 `diagnosis_session` | 否 |
| Playback Controller | 控制事件播放、暂停、单步、跳转和返回当前 | 否 |
| View Components | 展示 3D 模型、证据、候选、任务和时间轴 | 否 |
| Theme/Renderer | 将模型状态、交互状态和诊断状态映射为视觉效果 | 否 |

前端禁止根据 `caseId` 或 `faultType` 编写专用逻辑。页面只识别模型节点、关系、Session 状态、证据、候选、事件、任务、路径和 Story 检查点。

### 2.2 Case 数据包

```text
cases/
└── controller_warm_reset_001/
    ├── manifest.json
    ├── route-profile.json
    ├── resources.json
    ├── topology.json
    ├── diagnosis.json
    ├── expected-events.jsonl
    ├── story-scenes.json
    ├── alarms.json
    ├── logs.json
    ├── kpis.json
    └── similar-cases.json
```

模型探索态独立加载：

- 实例拓扑资产；
- 故障知识图谱资产；
- 跨层映射；
- 3D 投影配置。

用户提交故障现象后，第一阶段加载诊断必需数据：

- `manifest.json`
- `route-profile.json`
- `resources.json`
- `topology.json`
- `diagnosis.json`
- `expected-events.jsonl`
- `story-scenes.json`

第二阶段按需加载告警、日志、KPI和相似案例明细。

### 2.3 Case Runtime

Case 加载后统一建立索引，组件不得反复遍历原始 JSON。

```ts
interface CaseRuntime {
  manifest: CaseManifest;
  routeProfile: CaseRouteProfile;
  resourcesById: Map<string, Resource>;
  edgesById: Map<string, TopologyEdge>;
  plansById: Map<string, Plan>;
  tasksById: Map<string, SkillTask>;
  factsById: Map<string, Fact>;
  evidencesById: Map<string, Evidence>;
  candidatesById: Map<string, Candidate>;
  expectedEvents: RuntimeEvent[];
  scenesById: Map<string, StoryScene>;
}
```

用户输入路由到 Case 后，由 Runtime 统一暂停旧会话、加载并校验 Case、重建索引、创建 Session、追加初始化事件。切换 Case 只能通过新的诊断输入或明确的开发测试入口发生，不能在正式演示中通过下拉框绕过场景路由。

---

## 3. 产品状态、Runtime 事件与页面联动基线

### 3.1 产品与播放状态

产品状态：

```text
MODEL_OVERVIEW
→ DIAGNOSIS_INPUT
→ SESSION_INITIALIZING
→ DIAGNOSING
→ DIAGNOSIS_REVIEW
→ MODEL_OVERVIEW
```

事件播放状态是诊断运行态的子状态：

```text
READY → PLAYING ↔ PAUSED → SEEKING → COMPLETED / ERROR
```

模型探索态不需要创建 Session。用户的旋转、缩放、选择、展开和筛选属于纯交互状态，不生成诊断证据，也不改变候选或结论。

### 3.2 八个 Story 检查点

| 幕次 | 业务状态 | 页面重点 |
|---|---|---|
| 01 | 模型基线 | 3D 实例拓扑、故障知识图谱和跨层映射的中性状态 |
| 02 | 现象触发 | 仅出现业务访问变慢的初始输入 |
| 03 | 范围锁定 | 通过业务映射和拓扑 Skill 锁定 I/O 路径 |
| 04 | 候选生成 | 展示四个候选、来源依据及初始诊断支持分 |
| 05 | 逐轮取证 | Skill 任务按 Planner 决策执行，事实和证据逐步返回 |
| 06 | 验证排除 | 支持证据、反证和候选诊断支持分收敛 |
| 07 | 根因确认 | 根因链、影响链和恢复链闭环 |
| 08 | 能力预告 | 诊断完成，未来修复能力降暗展示 |

八个检查点只负责讲解节奏，不是运行时状态机。一个检查点内部可以包含多条 Runtime Event，例如：

```text
SKILL_STARTED
→ SKILL_COMPLETED
→ FACT_DISCOVERED
→ EVIDENCE_CREATED
→ CANDIDATE_UPDATED
→ PLAN_REPLANNED
```

### 3.3 唯一状态变更协议

诊断状态只能由统一 Runtime Event 改变。V1 至少支持：

- 会话：`DIAGNOSIS_INITIALIZED`、`DIAGNOSIS_PHASE_CHANGED`、`DIAGNOSIS_COMPLETED`；
- 计划：`PLAN_CREATED`、`TASK_CREATED`、`TASK_STATUS_CHANGED`、`PLAN_REPLANNED`；
- Skill 与事实：`SKILL_STARTED`、`SKILL_COMPLETED`、`SKILL_FAILED`、`FACT_DISCOVERED`；
- 推理：`CANDIDATES_GENERATED`、`EVIDENCE_CREATED`、`CANDIDATE_UPDATED`、`ROOT_CAUSE_CONFIRMED`；
- 过程：`CONFLICT_DETECTED`、`EVIDENCE_GAP_IDENTIFIED`、`CHECKPOINT_CREATED`。

相机、节点光效、面板显隐等 UI 行为由 Session 状态投影得到，不是领域事件。`story-scenes.json` 只引用 `event_id` 或 `sequence` 检查点，禁止包含直接修改候选、证据和结论的动作。

### 3.4 统一状态 Store

3D 模型、证据、候选、任务和时间轴不直接相互操作，统一订阅 `diagnosis_session`。联动基于三类稳定关联：

```text
对象 ID + 证据 ID + 时间窗口
```

时间轴回放采用：

```text
Session 初始状态 + 目标序号之前的 Runtime Event = 目标时刻诊断状态
```

Story 检查点可关联最近的 Session Checkpoint。跳转时从最近检查点重放事件，历史状态不得显示目标序号之后的事实、证据、候选变化或结论。

---

## 4. 诊断推理输入边界

### 4.1 Agent 初始可见信息

首个 Case 的初始输入统一定义为：

```text
诊断触发时间：14:32:18.120
业务对象：DB业务
故障现象：数据库访问突然变慢
现象描述：部分数据库请求响应时间显著升高，业务出现短时抖动
影响范围：单个数据库业务
```

Agent 初始可以看到：

- 业务对象、业务现象和发生时间；
- 用户描述或业务监控触发信息；
- 业务到基础设施对象的可查询入口。

Agent 初始不可直接看到：

- LUN 时延异常值；
- 控制器复位告警及日志；
- 控制器吞吐变化和主备接管；
- FC/SAN 链路健康数据；
- 存储池性能数据；
- 历史相似案例；
- 最终根因和预设诊断支持分。

### 4.2 数据获取分层

| 层次 | 数据示例 | 获取方式 |
|---|---|---|
| 初始现象 | 数据库访问变慢 | 诊断输入直接提供 |
| 业务映射 | DB业务对应 Host、LUN | 业务资源映射 Skill |
| 拓扑路径 | Host→SAN→FC端口→控制器→LUN | 拓扑查询 Skill |
| 观测证据 | 告警、日志、KPI、切换事件 | 专项取证 Skill |
| 经验信息 | 相似案例、故障模式 | 知识/案例查询 Skill |
| 推理结果 | 候选、诊断支持分、根因链 | Agent 推理生成 |

---

## 5. 候选生成基线

四个候选在完成业务映射和拓扑范围锁定后生成，此时尚未查询具体告警、日志和异常 KPI。

| 候选根因 | 生成依据 | 来源标签 | 初始诊断支持分 |
|---|---|---|---:|
| Controller-0A异常或复位 | 控制器位于 LUN 主访问路径，中断可能造成短时 I/O 停顿 | 拓扑关联＋故障模式库 | 32 |
| FC端口链路抖动 | FC链路异常可能造成重传或路径切换 | 拓扑关联＋故障模式库 | 26 |
| SAN交换链路异常 | SAN交换端口异常可能影响块业务访问 | 拓扑关联＋大模型机理推理 | 22 |
| 存储池性能瓶颈 | 后端拥塞可沿 LUN 向上传导为业务变慢 | 故障模式库＋大模型机理推理 | 20 |

第一候选必须使用“Controller-0A异常或复位”，不得在候选生成阶段提前显示“热复位”。故障模式应在告警和日志证据返回后逐步细化。

历史相似案例不参与第一轮候选生成，避免案例检索直接泄露答案。

---

## 6. 诊断计划与 Skill 取证

诊断计划统一为：

```text
确认业务现象
→ 映射基础设施对象
→ 锁定端到端影响路径
→ 生成可验证候选
→ 查询路径上的直接异常
→ 检查影响与冗余恢复
→ 验证竞争候选
→ 融合证据并形成结论
```

每个 Skill 任务至少包含：

- `goal`：要验证的问题；
- `targetCandidateIds`：目标候选；
- `expectedEvidence`：预期证据或反证；
- `queryScope`：对象与时间范围；
- `actualEvidenceIds`：实际返回证据；
- `resultStatus`：成功、失败、数据缺失或范围不足；
- `reasoningEffect`：对候选状态和诊断支持分的影响。

### 6.1 Skill 与候选验证关系

| 顺序 | Skill任务 | 验证目标 | 预期证据 | 基线返回 | 推理作用 |
|---:|---|---|---|---|---|
| 1 | 业务资源映射查询 | 将业务现象映射到基础设施 | DB业务关联 Host、LUN | 定位 DB-Host 和 LUN-DB01 | 确定诊断入口 |
| 2 | 端到端拓扑查询 | 确定影响路径及候选对象 | Host 到 LUN 完整访问路径 | 定位双SAN、FC端口、0A/0B、存储池 | 生成四个候选 |
| 3 | 告警查询 | 验证控制器或链路故障 | 复位、离线、切换等告警 | Controller-0A 热复位告警 | 强支持控制器候选 |
| 4 | 日志与指纹查询 | 确认控制器异常机制 | watchdog、reset 日志 | 命中 `watchdog_timeout` 和热复位指纹 | 细化故障模式 |
| 5 | KPI关联分析 | 验证故障、影响和恢复的时序 | 0A中断、LUN时延升高、0B接管 | 三类KPI按因果顺序出现 | 建立影响与恢复链 |
| 6 | FC/SAN链路健康查询 | 验证或排除链路候选 | 状态、CRC、光功率、多路径事件 | 端口正常、CRC无增量、双SAN无异常 | 降低链路候选 |
| 7 | 存储池及相似案例查询 | 排除后端瓶颈并增强解释 | 池和磁盘KPI、相似案例 | 后端正常，历史案例高度相似 | 排除池瓶颈并增强解释 |

查询失败、数据缺失、查询范围不足和“暂未发现”不得被解释为明确反证。

---

## 7. 证据模型与候选状态

### 7.1 证据分级

| 类型 | 含义 | 本 Case 示例 |
|---|---|---|
| 直接故障证据 | 直接描述故障事件 | Controller-0A 热复位告警 |
| 触发机制证据 | 解释故障如何触发 | `watchdog_timeout` 和复位日志指纹 |
| 状态变化证据 | 证明系统状态符合机理 | 0A吞吐降为0，0B开始接管 |
| 业务影响证据 | 证明故障造成初始现象 | LUN时延由1.8 ms升至38.6 ms |
| 排除证据 | 削弱竞争候选 | FC在线、CRC无增量、存储池正常 |
| 经验增强证据 | 提供历史相似性 | 高度相似的历史热复位 Case |

证据还需记录数据来源、时间差、对象距离、可靠性、冲突状态及是否直接观测。

### 7.2 候选状态

```text
待验证 → 验证中 → 获得支持 / 支持不足
      → 基本排除 / 根因确认 / 无法判断
```

“基本排除”表示当前范围内存在较强反证，但不宣称穷尽所有可能性。

---

## 8. 诊断支持分与根因确认

### 8.1 诊断支持分

原型阶段诊断支持分由 Case 预期事件轨迹预设，界面必须同时展示：

- 变化前后数值和增减幅度；
- 触发变化的证据；
- 证据类型和支持/反证方向；
- 时间一致性和对象一致性；
- 当前候选状态。

诊断支持分不得表述为严格概率，也不得用证据权重简单相加伪装成统计模型。

辅助阈值基线：

```text
第一候选诊断支持分 ≥ 85
且与第二候选差距 ≥ 30
```

### 8.2 最小证据链

根因确认必须同时满足：

```text
至少1条直接故障证据
AND 至少1条触发机制证据
AND 至少1条状态变化证据
AND 至少1条业务影响证据
AND 故障、影响、恢复的时间顺序符合因果关系
AND 不存在未解释的关键冲突证据
```

诊断支持分仅作为辅助条件，不能替代最小证据链。

### 8.3 三类推理终态

1. `ROOT_CAUSE_CONFIRMED`：满足最小证据链并确认根因；
2. `PROBABLE_CAUSES`：保留多个可能原因，明确排序和缺失证据；
3. `INSUFFICIENT_EVIDENCE`：证据不足，输出建议补充的数据和查询范围。

---

## 9. 首个 Case 的结构化结论

```yaml
diagnosis_status: ROOT_CAUSE_CONFIRMED

initial_symptom:
  business_object: DB业务
  symptom: 数据库访问突然变慢
  occurred_at: 14:32:18.120

root_cause:
  object: Controller-0A
  fault_mode: 控制器热复位
  trigger_mechanism: watchdog_timeout
  support_score: 96

impact_chain:
  - Controller-0A发生watchdog超时
  - Controller-0A触发热复位
  - 主控制器I/O短时中断
  - Block Service执行主备切换
  - LUN-DB01时延升高
  - DB业务访问变慢

recovery_chain:
  - Controller-0B接管业务
  - Block Service切换完成
  - LUN-DB01时延逐步回落
  - DB业务恢复

excluded_candidates:
  - candidate: FC端口链路抖动
    status: 基本排除
    reason: 端口在线且CRC错误无增量
  - candidate: SAN交换链路异常
    status: 基本排除
    reason: 双SAN链路无对应异常
  - candidate: 存储池性能瓶颈
    status: 基本排除
    reason: 存储池及后端磁盘KPI正常
```

---

## 10. 数据包自动校验基线

加载前至少校验：

- Schema 版本兼容，必需文件齐全；
- 路由元数据完整，标准现象可唯一匹配 Case，且不包含根因泄露；
- Case ID、资源、拓扑、证据源和候选引用一致；
- Runtime Event 的序号、时间和因果顺序合法；
- Story 检查点只引用存在的 Event 或 Checkpoint，不包含状态变更动作；
- 至少存在两次有触发证据、前后计划和 `plan_changes` 的重规划；
- 诊断支持分在 0～100；
- 最终结论满足最小证据链；
- 业务初始输入中没有提前泄露基础设施根因；
- 竞争候选的排除理由与实际查询范围相匹配。

开发模式显示详细错误；演示模式阻止不合法 Case 创建 Session。

---

## 11. V1 原型实现范围

### 必须实现

1. `3d-force-graph` 实例拓扑—故障知识图谱双平面及跨层映射；
2. 模型探索态的旋转、缩放、拾取、聚焦、搜索和按需展开；
3. 故障现象输入、标准化、Case 路由及未匹配/歧义处理；
4. Case 加载、校验、Session 创建和 Runtime Event 推进；
5. 事件播放、暂停、上一步、下一步、检查点跳转和重播；
6. 同一 3D 模型上的候选、业务路径、传播路径、影响路径和恢复路径变化；
7. 告警、日志、KPI、拓扑、案例等证据卡；
8. 候选来源、状态和诊断支持分动态变化；
9. 时间轴事件定位、历史快照和返回当前；
10. 结构化根因结论、竞争候选检查和证据不足终态；
11. Story 检查点及未来修复能力的演示编排。

### 暂缓实现

- 任意时间点的毫秒级拖动重放；
- 可视化编辑 Case；
- 实时接入 ES 或 DME；
- 前端动态计算诊断支持分；
- 自动布局任意规模拓扑或知识图谱；
- 真正执行 Skill；
- 自动修复流程。

---

## 12. 已冻结项与待讨论项

### 12.1 已冻结项

- 数据驱动、页面与具体 Case 解耦；
- 3D 模型探索态是首屏，诊断流程不是默认首页；
- 用户输入必须经过现象标准化和 Case 路由；
- Case Registry、Diagnosis Runtime、统一 Session 和 Runtime Event 协议；
- 八个 Story 检查点只负责演示节奏，不负责状态变更；
- Agent 初始只看到业务层故障现象；
- 四个候选及其生成依据；
- 七类 Skill 任务及验证目标；
- 证据分级、候选状态和三类终态；
- 根因确认的最小证据链；
- 首个 Case 的根因链、影响链和恢复链；
- V1 原型实现边界。

### 12.2 下一轮待讨论

1. **业务现象标准化**：如何把自然语言“业务变慢”转换为对象、指标、时间和影响范围；
2. **Planner 决策规则**：Skill 的选择、顺序、并行关系、停止和补查条件；
3. **证据冲突处理**：告警、日志、KPI、拓扑和案例结论不一致时如何裁决；
4. **缺失与失败处理**：Skill 超时、数据缺失、权限不足和查询范围不足的展示与推理策略；
5. **多根因与级联故障**：多个根因、共同原因和伴随故障的结构化表达；
6. **Case Schema 细化**：字段级定义、ID规范、版本兼容和 JSON Schema；
7. **验收标准**：播放正确性、推理一致性、Case 扩展成本和演示可信度；
8. **真实 Agent 接口**：Mock 动作、离线 ES 查询和真实 DME Skill 的替换边界。

---

## 13. 变更管理

本文件作为 V1.0 基线。后续讨论形成明确结论后：

1. 先更新“已冻结项”及对应章节；
2. 记录版本号和变更摘要；
3. 不在同一版本中静默修改候选、证据和确认规则；
4. Case 数据、界面实现和验收用例同步更新。
