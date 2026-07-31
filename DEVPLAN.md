# 开发任务：故障诊断 Agent 演示框架

## 你的任务

构建一套完整的故障诊断 Agent 演示框架。这是一个 3D 双平面认知模型 + 探索式诊断推理的演示系统。

**你必须先完整阅读以下文档，再开始编码：**

1. `README.md` — 项目总览、铁律、组件选型、验收标准
2. `docs/实例拓扑视图展示与交互规格_V1.0.md` — 3D 拓扑结构、聚合、布局和交互
3. `docs/故障诊断Agent_可视化原型与诊断推理基线_V1.0.md` — 诊断过程架构
4. `docs/故障诊断Agent_前端交互联动规则基线_V1.0.md` — 前端联动规则
5. `docs/Case数据包定义规范_V1.0.md` — Case 数据包 schema
6. `docs/故障诊断Agent_Planner输出协议与重规划基线_V1.0.md` — Planner 协议
7. `docs/故障诊断Agent_演示级Skill规范_V1.0.md` — Skill 规范
8. `docs/故障诊断Agent_推理模块与候选更新规则基线_V1.0(1).md` — 推理与候选更新

**这些文档是开发契约，不是参考建议。实现必须严格遵循。**

## 开发阶段（按顺序执行）

### 阶段 1-2：模型资产与 3D 双平面探索态

**目标：** 用户进入系统后，看到一个可探索的 3D 双平面模型（上层实例拓扑 + 下层故障知识图谱 + 跨层映射）。

**需要做的事：**

1. **初始化项目：**
   - `npm create vite@latest . -- --template react-ts`
   - 安装所有依赖：tailwindcss, 3d-force-graph, three, echarts, lucide-react, motion, @tanstack/react-virtual, react-resizable-panels
   - 初始化 shadcn/ui
   - 设置 Tailwind 设计 Token（语义色彩变量）

2. **模型资产数据（JSON）：**
   - `model/topology/instances.json` — 实例拓扑数据：业务(DB业务)、主机(db-host-01)、网络(switch-01)、控制器(Controller-0A, Controller-0B)、LUN(LUN-DB01)、存储池(pool-0)等实例及其访问关系。按"业务与计算—网络与接入—控制与服务—逻辑资源—物理资源"五个空间域组织。
   - `model/knowledge-graph/nodes.json` — 故障知识图谱节点：对象类型(StorageController, LUN, Host)、故障现象(latency_increase, warm_reset)、故障模式(controller_failover, watchdog_timeout)、机制、证据规则、案例。按四层组织。
   - `model/knowledge-graph/edges.json` — 知识图谱内部关系
   - `model/mappings/cross-layer-mappings.json` — 实例到知识图谱的跨层映射
   - `model/projection/projection-config.json` — 3D 坐标、聚合层级、相机预设、显隐规则

3. **3D 双平面渲染：**
   - 用 `3d-force-graph` 实现真实 WebGL 3D 渲染
   - 上层平面：实例拓扑（五个空间域，半固定 z 轴坐标，局部力避免重叠）
   - 下层平面：故障知识图谱（四层结构）
   - 跨层映射线（克制光柱/曲线，默认只显示关键关系）
   - 相机控制：全景、仅拓扑、仅图谱、业务路径四个预设视角
   - 节点交互：拾取、聚焦、搜索、展开邻居
   - 标签策略：按相机距离/缩放级别显示
   - 常驻"开始故障诊断"入口按钮

4. **模型探索态验证：**
   - 不启动诊断也能看到完整双平面模型
   - 可旋转、缩放、聚焦、搜索、展开
   - 无诊断 Session 时不泄露故障对象/根因

### 阶段 3：冻结共享诊断协议

**目标：** 定义所有模块共用的 TypeScript 类型。

**需要做的事：**

- `schemas/types.ts` — Candidate, Fact, Evidence, Plan, Task, RuntimeEvent, DiagnosisSession 的 TypeScript 类型定义
- `schemas/enums.ts` — TaskStatus, CandidateStatus, DiagnosisPhase, RouteStatus, EventType 等枚举
- `schemas/validation.ts` — 基础校验逻辑
- 确保类型定义与基线文档完全一致

### 阶段 4-5：场景路由与 Case 基础设施

**目标：** 用户输入故障现象后能正确路由到 Case。

**需要做的事：**

1. **SymptomNormalizer：** 自然语言→标准故障现象+对象范围+时间窗
2. **CaseRouter：** 根据 normalized symptom 匹配 Case 路由元数据，输出 MATCHED/AMBIGUOUS/NOT_MATCHED/INVALID_INPUT
3. **Case 数据包 `controller_warm_reset_001`：**
   - `cases/controller_warm_reset_001/case.json` — Case 元数据、路由 profile
   - `cases/controller_warm_reset_001/topology.json` — Case 拓扑快照
   - `cases/controller_warm_reset_001/observations/` — 告警、日志、KPI、链路健康观测数据（按 Skill 查询维度组织）
   - `cases/controller_warm_reset_001/knowledge.json` — Case 专属知识（候选模式、证据规则）
   - `cases/controller_warm_reset_001/events/` — 预期诊断事件轨迹（Planner 计划、Skill 结果、Evidence、Candidate updates）
   - **离线真值（根因、最终支持分、结论）不能进入初始可见状态**
4. **CaseLoader：** 加载和索引 Case，支持目录格式
5. **CaseValidator：** 结构校验、ID 引用校验、时间校验

### 阶段 6-7：Diagnosis Runtime 与 Agent 闭环

**目标：** Controller 热复位 Case 按标准轨迹真实推进。

**需要做的事：**

1. **RuntimeEvent Append Log：** 事件追加日志，唯一 ID、递增序号
2. **SessionProjector (Reducer)：** 确定性事件→状态投影
3. **V1 确定性 Planner：**
   - Round 1: 业务映射+KPI → 定位到 LUN-DB01
   - Round 2: 拓扑展开 → 生成 3-5 个泛化候选
   - Round 3: 告警查询 → 发现 Controller-0A 热复位
   - **第一次重规划：** 新增触发机制、主备切换和影响链验证
   - Round 4-5: 日志指纹、控制器吞吐、0B 接管、LUN 时延回落
   - **第二次重规划：** 主动检查 FC、SAN、存储池等竞争解释
   - Round 6: 最小证据链完成
   - 终态：ROOT_CAUSE_CONFIRMED
4. **Mock SkillExecutor：** 按任务查询 Case 观测数据，返回 Fact
5. **EvidenceBuilder：** Fact → Evidence（与候选关联的解释）
6. **CandidateReducer：** 按证据更新候选支持分、状态和排序
7. **ConclusionGate：** 检查支持分门槛+最小证据链+竞争候选检查+冲突消解

### 阶段 8：模型诊断联动界面

**目标：** 在同一 3D 模型上叠加诊断过程，支持完整演示链路。

**需要做的事：**

1. **诊断输入面板：** 轻量浮动面板（symptom + occurred_at + business_scope）
2. **诊断状态栏：** 当前判断、当前动作、诊断阶段、下一步原因
3. **3D 模型诊断叠加：** 故障对象高亮、影响路径、传播路径、有效冗余路径
4. **候选根因侧栏：** CandidateCard + 支持分 + 证据覆盖
5. **Planner/Skill 执行区：** AI Elements Task/Tool 组件，展示计划、任务、重规划差异
6. **证据抽屉：** EvidenceInspector + FactTrace + ConflictBanner
7. **底部事件时间线：** RuntimeEvent 虚拟列表 + 回放控制
8. **播放控制：** 播放、暂停、单步、跳转、历史回放、返回当前
9. **四条联动链：**
   - 拓扑对象 ↔ 候选/证据/任务联动
   - 候选 ↔ 支持证据/削弱证据/冲突联动
   - 证据 ↔ 原始 Fact/Skill/候选变化联动
   - 事件 ↔ 当时快照/返回当前联动

## 完成后的交付

1. **`start.py`：** Python HTTP 服务器，托管 `dist/` 静态文件，端口 8080
2. **`npm run build`：** 构建生产版本到 `dist/`
3. **演示流程验证：**
   - `python3 start.py` → 浏览器打开 localhost:8080
   - 首屏看到 3D 双平面模型
   - 点击"开始故障诊断"→输入"数据库访问突然变慢"
   - 看到完整诊断过程：候选生成→证据收集→两次重规划→根因确认
   - 结论展示根因链、影响链、恢复链

## 开始

先阅读所有基线文档（至少 README + docs/ 下全部文档），理解整体架构和约束，然后从阶段 1 开始按顺序实现。每个阶段完成后简要总结实现了什么。整个项目应该在一次会话中完成。
