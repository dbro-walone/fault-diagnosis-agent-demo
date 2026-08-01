# 故障诊断 Agent 推理模块与候选更新规则基线 V2.0

## 1. 定位

推理模块将 Canonical Fact 解释为 Evidence，更新“对象＋故障模式”候选，并检查最小证据链、竞争候选和关键冲突。V2 仍是可配置、可回归的诊断支持模型，不是概率模型。

## 2. 候选生成

候选来源：故障机理知识、实例拓扑定位、新异常 Fact。初始 3～5 个。

```yaml
candidate:
  candidate_id: cand-controller-warm-reset
  object_id: controller-0a
  fault_mode_code: CONTROLLER_WARM_RESET
  generated_from:
    symptom_refs: [sym-lun-latency-high]
    ontology_relation_refs: [rel-reset-impacts-io]
    fact_refs: []
  diagnosis_support_score: 32
  status: ACTIVE
```

候选是会话假设，不写回资源运行状态。

## 3. Evidence

```yaml
evidence:
  evidence_id: ev-controller-reset
  evidence_type: DIRECT_FAULT
  fact_refs: [fact-controller-reset-alarm]
  effects:
    - candidate_id: cand-controller-warm-reset
      effect: STRONG_SUPPORT
      score_delta: 30
      explanation: 热复位告警与候选对象、时间和机理一致
  quality: HIGH
  object_refs: [controller-0a]
```

`fact_refs[]` 为必需引用。不得仅保留自然语言 `fact` 或单一 `source_ref`。

## 4. 证据作用

| Effect | 默认变化 | 含义 |
|---|---:|---|
| STRONG_SUPPORT | +30 | 直接故障或决定性机制 |
| SUPPORT | +15 | 对象、时间、现象或影响一致 |
| WEAKEN | -15 | 完整覆盖下关键预期异常未出现 |
| CONFLICT | Case配置 | 与候选核心断言矛盾，需要消歧 |
| NEUTRAL | 0 | 当前不能区分 |

同一 Fact 可以影响多个候选，但每个 effect 都有独立解释。

## 5. 有效性检查

Fact 形成 Evidence 前至少检查：

- 对象相关性；
- 时间相关性与时区；
- 机理相关性；
- 查询覆盖与数据质量；
- 与已有事实是否重复；
- 是否存在相同源的相关性膨胀。

相同日志指纹和其组成日志不能被当作完全独立强证据重复累计。

## 6. 诊断支持分

```text
new_score = clamp(old_score + score_delta, 0, 100)
```

分数用于排序和变化展示，不显示百分号。多个弱证据累计跨过门槛不能替代直接故障或关键机制证据。

## 7. 候选状态

```text
INITIAL | ACTIVE | LEADING | WEAKENED | CONFLICTING |
CONFIRMED | NOT_CONFIRMED | INSUFFICIENT_EVIDENCE
```

不使用 `EXCLUDED` 作为默认状态；只有严格逻辑矛盾且无其他解释时才可在诊断文本中说“排除”，状态仍建议保留可审计的 `WEAKENED/CONFLICTING`。

## 8. 最小证据链

统一要求类型：

| 要求 | 必需 |
|---|---:|
| 故障事实或关键机制 | 是 |
| 对象位于影响/传播路径 | 是 |
| 时间一致性 | 是 |
| 主要业务影响可解释 | 是 |
| 关键竞争候选检查 | 是 |
| 相似案例等辅助参考 | 否 |

具体 Case 可以细分，例如控制器热复位把“直接故障”和“触发机制”拆为两个必需项。

## 9. 竞争候选

至少识别一个能解释主要现象的关键竞争候选，执行一项具有区分性的有效查询。FAILED、DATA_MISSING 和覆盖不足不能算完成。若仍有足以改变结论且未检查的竞争候选，不得确认根因。

## 10. 冲突、并列与不足

- 关键冲突→`CONFLICTING`，Planner生成时间对齐、对象核对或影响验证任务；
- 领先分差小于 Case 阈值且均缺决定性证据→`PROBABLE_CAUSES`；
- 关键 Skill 失败、对象/时间窗缺失、只有相似案例或链路不完整→`INSUFFICIENT_EVIDENCE`；
- 正负分抵消不能替代冲突消解。

## 11. 更新协议

```yaml
candidate_update:
  update_id: cu-controller-003
  candidate_id: cand-controller-warm-reset
  score_before: 62
  score_after: 84
  status_before: ACTIVE
  status_after: LEADING
  caused_by_evidence_refs: [ev-impact-chain]
  reason: 0A归零、0B接管和LUN时延异常形成影响闭环
  chain_changes:
    - requirement_id: impact
      from: IN_PROGRESS
      to: SATISFIED
```

## 12. 更新顺序

```text
读取新 Fact
→ 去重与质量检查
→ 创建 Evidence
→ 关联候选与作用
→ 更新分数与状态
→ 更新最小证据链
→ 检查冲突和竞争候选
→ 输出继续/重规划/确认/多个原因/证据不足
```

## 13. 三类 Case 特有证据链

### 控制器热复位

告警/日志机制→0A状态变化→0B接管→LUN影响→链路/池竞争检查。

### 扰邻

受害者B影响→共享瓶颈→A负载突增→A与共享资源压力时间一致→B自身与链路竞争检查→A降载后B恢复（如有）。

### 远程复制

复制积压/RPO异常→链路或远端资源异常→本地业务/后端区分→传播到复制会话→恢复或旁证→竞争域检查。

## 14. 验收

- 每次候选变化引用 Evidence，每个 Evidence 引用 Fact；
- 分数达到门槛但链不完整时不确认；
- 查询覆盖不足不产生强反证；
- 相同源证据不重复膨胀；
- 三类 Case 的差异只通过证据模板和知识关系配置表达。

