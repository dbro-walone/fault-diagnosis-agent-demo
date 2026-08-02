# Case 数据包 V1.0 兼容适配附录 V2.0

## 1. 结论

Case 数据包 V1.0 的目录和原始字段不修改。V2 通过 `CaseAdapter` 和 `FactNormalizer` 生成 Runtime 对象。原 V1.0 规范保存在 `docs/legacy/Case数据包定义规范_V1.0.md`。

## 2. 不变目录

```text
case/
├── manifest.json
├── case.json
├── resources.json
├── topology.json
├── observations/
├── knowledge/
├── diagnosis/
└── playback/
```

## 3. 字段映射

| V1.0 字段 | V2 读取结果 |
|---|---|
| candidate.initial_confidence 0～1 | diagnosis_support_score 0～100 |
| confidence_trace[].confidence | CandidateScorePoint.score |
| candidate.status=confirmed | CONFIRMED |
| candidate.status=excluded | WEAKENED（默认） |
| task.status=succeeded | SUCCEEDED |
| evidence.source_ref | 先定位源记录并创建 Fact，再写入 fact_refs[] |
| evidence.stance=support | SUPPORT/STRONG_SUPPORT |
| evidence.stance=contradict | WEAKEN，明确矛盾时 CONFLICT |
| evidence.strength 0～1 | 质量/强度适配输入，不直接显示为概率 |
| storyboard.scene | Replay Bookmark／事件区间 |

## 4. SourceRef→Fact

| source_ref 类型 | Fact Type |
|---|---|
| alarm_id | ALARM |
| log_id | LOG |
| fingerprint_id | LOG_FINGERPRINT，可引用组成日志 |
| series_id | KPI_WINDOW |
| edge_id | TOPOLOGY_RELATION |
| similar_case_id | SIMILAR_CASE_REFERENCE |
| task_id 且表达无匹配 | ABSENCE，必须补查询覆盖 |

一个旧 Evidence 可能需要一个或多个 Fact。Adapter 允许基于 V1 的 detail/result_refs 解析组合，但不得生成不存在的原始值。

## 5. Skill 状态

- 旧 `EMPTY` 不直接映射“正常”；
- 若查询成功、覆盖完整且 0 匹配，创建 ABSENCE Fact；
- 数据源不存在或不可用映射 DATA_MISSING；
- 只覆盖部分对象/时间映射 PARTIAL；
- 调用异常映射 FAILED。

## 6. 八幕适配

`playback/storyboard.json` 继续作为章节书签：

- `sequence` 决定书签顺序；
- `stage_code` 只用于章节标签；
- `data_refs/task_ids/evidence_ids` 映射到对应 Runtime Event 区间；
- `confidence_sequence` 映射到支持分变化点；
- `show_confidence` 在 V2 显示“诊断支持分”，禁止百分号；
- scene 不得提前让未来 Fact 可见。

## 7. 校验分工

`validate_case_package.py`：

- 校验 V1 文件完整性、ID、关系和 storyboard；
- 保留对 legacy confidence 0～1 的校验；
- 不负责 Runtime 对象。

`validate_runtime_contract.py`：

- 校验事实、证据、候选和事件引用闭环；
- 校验支持分 0～100；
- 校验确认条件与最小证据链；
- 校验回放不会引用未来事实；
- 校验 `agent_focus` 与 View Model 引用。

## 8. 前端禁止项

- 直接读取 `confidence` 并显示百分比；
- 直接解析自由 `records`；
- 把 `excluded` 无条件显示为“已排除”；
- 根据 `case_id` 选择组件或改字段；
- 将 storyboard 当作 Runtime 状态机。

## 9. 迁移策略

### 当前

V1 Case 原样加载→Adapter→Runtime V2。

### 后续可选

新 Case 可以直接原生输出 V2 Runtime Fixture，但仍建议保留原始观测与推演分离。是否发布 Case V2 数据包规范，需在三类 Case 真实实现后另行决策，本轮不提前升级。

## 10. 验收

- 原控制器 Case 不修改即可通过旧校验器；
- Adapter 后支持分显示 42、68、96，而非 42%、68%、96%；
- 10 条旧 Evidence 均能追溯至少一个 Canonical Fact；
- 三类场景不要求增加前端特判；
- legacy 规范与 V2 Runtime 契约同时可查。

