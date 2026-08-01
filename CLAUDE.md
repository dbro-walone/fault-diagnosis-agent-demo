# Project: 故障诊断 Agent Demo V2

## 项目定位

一套"可执行诊断会话 + 可解释可视化投影"框架。不可变递增事件流 + 可重建会话快照 + 面向前端的只读 View Model。

## 四层状态隔离（铁律）

| 状态层 | 内容 | 可写回本体？ |
|---|---|---|
| Source State | CMDB/拓扑/告警/日志/KPI原始数据 | 由源系统管理 |
| Ontology State | 领域对象、关系和业务语义 | 受控可写 |
| Diagnosis State | Fact/Evidence/Candidate/Plan/Conclusion | 会话隔离，不改源对象 |
| Projection State | 聚合组/相机/展开/user_selection/View Model | 否，仅前端临时 |

Projection Group 不是资源；聚合不生成新 CMDB ID；View Model 不是 Fact。

## 严格语义边界

```text
Skill Result → Canonical Fact → Evidence → Candidate Update → Conclusion
```

- Skill 只返回事实，不输出 Evidence 和诊断支持分
- Planner 选择验证目标，不裁决根因
- 前端只投影 Runtime 状态，不执行诊断计算
- 诊断支持分 0-100，不是概率/置信度，不显示百分号

## 右侧 LUI（五层固定结构）

1. 会话状态栏（模式、阶段、现象）
2. 诊断态势（当前知道什么）
3. 当前行动（做什么、为什么、期望什么）
4. 候选根因（分数、变化、缺口）
5. 调查工作区（证据链｜计划｜历史）

日志/告警/KPI 三级密度：摘要 → 证据预览 → 原始详情，引用同一 fact_id。

## 核心枚举（统一口径）

- CandidateStatus: INITIAL | ACTIVE | LEADING | WEAKENED | CONFLICTING | CONFIRMED | NOT_CONFIRMED | INSUFFICIENT_EVIDENCE
- TaskStatus: PLANNED | READY | RUNNING | SUCCEEDED | FAILED | PARTIAL | DATA_MISSING | CANCELLED | SKIPPED
- EvidenceEffect: STRONG_SUPPORT | SUPPORT | WEAKEN | CONFLICT | NEUTRAL
- RuntimeMode: LIVE | PAUSED | REPLAY

## 三 Case 共用协议

| Case | 推理挑战 |
|---|---|
| controller_warm_reset_001 | 直接故障→触发机制→接管→业务影响 |
| noisy_neighbor_io_contention_001 | 从受害者B定位共享资源，反向追溯施压者A |
| remote_replication_lag_001 | 区分本地前端/后端/复制链路/远端写入 |

禁止 `if (case_id === ...)` 特判。

## 前端交互铁律

- agent_focus 只能由 Runtime 更新；user_selection 只能由用户交互更新
- 用户浏览时 Agent 不抢视角，30秒无操作也不抢回
- 滚轮只缩放，不触发层级变化
- 回放只展示历史已知信息，不泄露未来
- 状态叠加 7 级优先级，用形态+光晕+描边+徽标组合，不只靠颜色

## 开发文档（权威层级）

L0 > L1 > L2 > L3，冲突时高层优先：
- docs/00_文档体系与版本矩阵_V2.0.md
- docs/01_总纲、docs/02_Runtime协议、docs/03_可执行本体
- docs/04_前端联动、docs/05_聚合钻取、docs/06_拓扑、docs/07_LUI
- docs/08_Planner、docs/09_Skill、docs/10_推理
- docs/11_V1兼容、docs/12_三Case审计
- docs/cases/01-03_Case设计

## 交付形态

python3 start.py → http://localhost:8080
离线静态服务器，前端构建后打包为 dist/
