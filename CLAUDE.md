# Project: 故障诊断 Agent Demo (Fault Diagnosis Agent Demo)

## 项目概述

一套以"存储系统拓扑与故障知识图谱"为入口、可执行探索式诊断的故障诊断 Agent 演示框架。

用户进入系统后首先看到的是一个可探索的 3D 双平面认知模型（上层实例拓扑 + 下层故障知识图谱），然后通过"开始故障诊断"入口输入故障现象，系统在同一模型上叠加诊断过程，最终收敛到根因结论。

## 不可改变的产品主线（四段顺序不可颠倒）

1. **3D 模型呈现** — 加载实例拓扑、故障知识图谱及跨层映射，用户先探索系统结构
2. **故障现象输入** — 用户输入自然语言故障现象，场景路由器标准化并匹配 Case
3. **故障诊断推演** — Runtime 按统一事件链推进 Planner→Skill→Fact→Evidence→Candidate→Replan
4. **结论收敛与复盘** — 最小证据链和竞争候选检查完成，输出根因或证据不足结论

## 关键铁律（违反即返工）

1. **首屏必须是模型探索态**，不是诊断表单/Planner/Skill列表/八幕动画
2. **诊断状态只能由 Runtime Event 改变**，前端不得自行计算支持分/候选/根因
3. **Fact ≠ Evidence ≠ Candidate ≠ Conclusion**，四者严格分离
4. **根因不能提前泄露** — 初始 Session 不含 Controller-0A 热复位、watchdog_timeout 等真值
5. **Case 只增数据不改代码** — 切换/新增 Case 不修改 Runtime 和前端
6. **3D 统一用 `3d-force-graph`**，不混用第二套图引擎
7. **用户输入必须经 SymptomNormalizer→CaseRouter**，不能由前端关键词直接播放 Case
8. **Skill 只返回事实**，不做推理判断，不直接给出根因或候选分

## 核心语义对象（严格区分）

| 对象 | 含义 | 示例 |
|---|---|---|
| Fact | Skill 实际返回并完成结构化的数据 | Controller-0A 在故障窗口内发生热复位 |
| Evidence | 事实与候选之间的诊断解释 | 热复位事件强支持"控制器异常或复位" |
| Candidate | 尚待验证的根因假设 | Controller-0A 异常或复位 |
| Conclusion | 满足确认规则后的诊断结果 | watchdog 超时触发 Controller-0A 热复位 |

支持分取值 0~100，不是概率/置信度，界面不显示百分号。

## 技术栈（不可随意更改）

- React + TypeScript + Vite (单页应用)
- shadcn/ui + Tailwind CSS (设计系统)
- 3d-force-graph + Three.js (3D 双平面模型)
- Apache ECharts (KPI/时序图)
- AI Elements (Agent 过程组件 Task/Tool)
- react-resizable-panels (工作台布局)
- TanStack Virtual (长列表虚拟化)
- Motion for React (微交互动画)
- Lucide React (图标)

## 交付形态

- `python3 start.py` 一键启动
- 默认 http://localhost:8080
- 运行时不依赖 Docker/Node.js/npm — 前端构建后打包为静态资源
- Case、图谱、拓扑、诊断事件通过 JSON 扩展

## 首个基线 Case

`controller_warm_reset_001` — Controller-0A 热复位导致数据库业务时延升高：
- 两轮重规划（第一次：告警发现热复位后；第二次：主动检查竞争候选）
- 完整证据链：告警→日志指纹→吞吐归零→0B接管→LUN时延回落
- 最终结论：`ROOT_CAUSE_CONFIRMED`（watchdog_timeout 触发热复位）

## 开发文档

所有基线文档在 `docs/` 目录下，它们是开发契约，不是参考建议：
- `docs/README.md` — 工程总览与开发入口
- `docs/Case数据包定义规范_V1.0.md` — Case Schema 规范
- `docs/故障诊断Agent_可视化原型与诊断推理基线_V1.0.md` — 总体架构
- `docs/故障诊断Agent_Planner输出协议与重规划基线_V1.0.md` — Planner 协议
- `docs/故障诊断Agent_演示级Skill规范_V1.0.md` — Skill 规范
- `docs/故障诊断Agent_推理模块与候选更新规则基线_V1.0(1).md` — 推理规则
- `docs/故障诊断Agent_前端交互联动规则基线_V1.0.md` — 前端联动
- `docs/实例拓扑视图展示与交互规格_V1.0.md` — 3D 拓扑交互

## 编码规则

1. 先读取 README 和任务关联的基线文档，再写代码
2. 第三方组件先封装为领域组件，再进入业务页面
3. 组件只负责呈现，不在内部计算支持分/推断根因/生成决策
4. 新增依赖必须记录用途和替代方案
5. 色彩使用语义 Token（--status-fault/warning/active/evidence/recovered/muted）
6. 不允许纯 CSS 伪造 3D，必须用 3d-force-graph 真实 WebGL 渲染
7. 模型探索操作不能修改诊断状态
8. 历史回放不展示未来证据和结论
