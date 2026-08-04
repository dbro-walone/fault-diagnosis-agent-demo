/**
 * CrossPlaneBinding 单元测试（docs/19 §6）：
 *   - 静态 Binding 编译：INSTANCE_OF / CONFORMS_TO / ENTRY_OBJECT_TYPE；
 *   - 动态 Binding 派生：候选/证据/根因激活与生命周期（PROPOSED→ACTIVE→REVOKED/SUPERSEDED）；
 *   - EVIDENCE_MATCHES_RULE 规则匹配；
 *   - 校验器：引用完整性 + 事件激活约束。
 */
import { describe, expect, it } from 'vitest'
import {
  BindingStatus,
  CrossPlaneBindingType,
  buildKnowledgePlaneIndex,
  compileStaticBindings,
  deriveDynamicBindings,
  matchEvidenceToRule,
  transitionBindingStatus,
  validateCrossPlaneBindings,
  type CrossPlaneBinding,
} from './cross-plane-binding'
import { loadAdaptedCase, replayCase } from './diagnosis-runtime'
import type { CanonicalFact } from './runtime-types'

const index = buildKnowledgePlaneIndex()

function active(bindings: CrossPlaneBinding[]): CrossPlaneBinding[] {
  return bindings.filter((b) => b.status === BindingStatus.ACTIVE)
}

describe('静态 Binding 编译（Adapter 生成）', () => {
  const adapted = loadAdaptedCase('controller_warm_reset_001')
  const statics = adapted.staticBindings

  it('每个可映射 resource_type 的实例都有 INSTANCE_OF（ACTIVE）', () => {
    const inst = statics.filter((b) => b.binding_type === CrossPlaneBindingType.INSTANCE_OF)
    // controller_warm_reset_001 有 10 个可映射实例（BUSINESS/HOST/SAN_FABRIC/FC_PORT/…）。
    expect(inst.length).toBeGreaterThan(0)
    for (const b of inst) {
      expect(b.source_plane).toBe('TOPOLOGY')
      expect(b.target_plane).toBe('KNOWLEDGE')
      expect(b.status).toBe(BindingStatus.ACTIVE)
      expect(index.resourceTypeNodeByCode.get(
        adapted.instanceTopology.resources.find((r) => r.resource_id === b.source_ref)?.resource_type_code ?? '',
      )).toBe(b.target_ref)
    }
    // 关键实例：controller-0a → ot-controller。
    const c0a = inst.find((b) => b.source_ref === 'controller-0a')
    expect(c0a?.target_ref).toBe('ot-controller')
  })

  it('实例关系符合 L1 能力时生成 CONFORMS_TO（ACTIVE）', () => {
    const conforms = statics.filter((b) => b.binding_type === CrossPlaneBindingType.CONFORMS_TO)
    expect(conforms.length).toBeGreaterThan(0)
    for (const b of conforms) {
      expect(b.status).toBe(BindingStatus.ACTIVE)
      expect(b.target_ref.startsWith('kg:capability:')).toBe(true)
      // source 是拓扑关系 id。
      expect(adapted.instanceTopology.relations.some((r) => r.relation_id === b.source_ref)).toBe(true)
    }
  })

  it('场景入口对象解析后生成 ENTRY_OBJECT_TYPE（入口资源类型有 L1 节点时）', () => {
    const entry = statics.find((b) => b.binding_type === CrossPlaneBindingType.ENTRY_OBJECT_TYPE)
    // 控制器 Case 入口取 KPI 现象对象 lun-db01（BUSINESS 无 L1 节点，回退/跳过）。
    expect(entry).toBeDefined()
    expect(entry!.source_ref).toBe('lun-db01')
    expect(entry!.target_ref).toBe('ot-lun')
    expect(entry!.status).toBe(BindingStatus.ACTIVE)
  })

  it('静态 Binding 全部 ACTIVE，且均通过引用完整性校验', () => {
    expect(statics.every((b) => b.status === BindingStatus.ACTIVE)).toBe(true)
    const issues = validateCrossPlaneBindings(statics, adapted.instanceTopology, index)
    expect(issues).toEqual([])
  })
})

describe('动态 Binding 派生（Runtime 状态驱动）', () => {
  const adapted = loadAdaptedCase('controller_warm_reset_001')
  const snap = replayCase('controller_warm_reset_001')
  const resourceTypeOf = (id: string) => adapted.resourceTypeByObject.get(id) ?? null
  const dynamic = deriveDynamicBindings(snap, resourceTypeOf, index)

  it('候选生成 → CANDIDATE_ON_RESOURCE / CANDIDATE_OF_FAULT_MODE', () => {
    const candBindings = dynamic.filter((b) => b.candidate_id === 'cand-controller-warm-reset')
    expect(candBindings.some((b) => b.binding_type === CrossPlaneBindingType.CANDIDATE_ON_RESOURCE)).toBe(true)
    expect(candBindings.some((b) => b.binding_type === CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE)).toBe(true)
    // CANDIDATE_OF_FAULT_MODE：实例 → 故障模式节点。
    const ofFm = candBindings.find((b) => b.binding_type === CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE)
    expect(ofFm?.source_ref).toBe('controller-0a')
    expect(ofFm?.target_ref).toBe('fm-controller-warm-reset')
  })

  it('根因确认 → ROOT_CAUSE_CONFIRMED_AS，并把已确认候选的 CANDIDATE_* 标记 SUPERSEDED', () => {
    const root = dynamic.find((b) => b.binding_type === CrossPlaneBindingType.ROOT_CAUSE_CONFIRMED_AS)
    expect(root).toBeDefined()
    expect(root!.source_ref).toBe('controller-0a')
    expect(root!.target_ref).toBe('fm-controller-warm-reset')
    expect(root!.status).toBe(BindingStatus.ACTIVE)
    // 已确认候选的 CANDIDATE_* 不再 ACTIVE。
    for (const b of dynamic) {
      if (b.candidate_id === 'cand-controller-warm-reset' && b.binding_type !== CrossPlaneBindingType.ROOT_CAUSE_CONFIRMED_AS) {
        expect(b.status).toBe(BindingStatus.SUPERSEDED)
      }
    }
  })

  it('被排除候选的 CANDIDATE_* 绑定为 REVOKED', () => {
    // cand-pool-bottleneck 的 fault_mode_code 无对应 FAULT_MODE 节点，不生成绑定。
    for (const cid of ['cand-fc-link-flap', 'cand-san-link-fault']) {
      const bindings = dynamic.filter((b) => b.candidate_id === cid)
      expect(bindings.length).toBeGreaterThan(0)
      for (const b of bindings) {
        expect(b.status).toBe(BindingStatus.REVOKED)
      }
    }
  })

  it('证据派生 → EVIDENCE_MATCHES_RULE（controller-0a → er-reset-alarm）', () => {
    const rule = dynamic.find(
      (b) => b.binding_type === CrossPlaneBindingType.EVIDENCE_MATCHES_RULE &&
        b.evidence_id === 'ev-controller-reset-alarm',
    )
    expect(rule).toBeDefined()
    expect(rule!.source_ref).toBe('controller-0a')
    expect(rule!.target_ref).toBe('er-reset-alarm')
    expect(rule!.status).toBe(BindingStatus.ACTIVE)
  })

  it('动态 Binding 全部满足事件激活校验（validate 无 ERROR）', () => {
    const issues = validateCrossPlaneBindings([...adapted.staticBindings, ...dynamic], adapted.instanceTopology, index, snap)
    expect(issues).toEqual([])
  })
})

describe('EVIDENCE_MATCHES_RULE 规则匹配', () => {
  const adapted = loadAdaptedCase('controller_warm_reset_001')
  const factById = new Map(adapted.facts.map((f) => [f.fact_id, f]))
  const typeOf = (id: string) => adapted.resourceTypeByObject.get(id) ?? null

  const matchFor = (factId: string): string | null => {
    const fact = factById.get(factId)
    if (!fact) throw new Error(`missing fact ${factId}`)
    const obj = fact.object_refs[0]
    return matchEvidenceToRule(fact, typeOf(obj), index)
  }

  it('复位严重告警 → er-reset-alarm', () => {
    expect(matchFor('fact-alm-0a-78421')).toBe('er-reset-alarm')
  })
  it('Watchdog 日志指纹 → er-watchdog-fp', () => {
    expect(matchFor('fact-fp-ctrl-warm-reset-017')).toBe('er-watchdog-fp')
  })
  it('控制器 0A 吞吐归零 → er-throughput-zero', () => {
    expect(matchFor('fact-kpi-controller-0a-throughput')).toBe('er-throughput-zero')
  })
  it('控制器 0B 接管（吞吐抬升）→ er-takeover', () => {
    expect(matchFor('fact-kpi-controller-0b-throughput')).toBe('er-takeover')
  })
  it('FC 端口 CRC 反证 → er-fc-normal', () => {
    expect(matchFor('fact-kpi-fc-port-0a-crc')).toBe('er-fc-normal')
  })

  it('无适用规则的 Fact 返回 null（如相似案例）', () => {
    const sc = adapted.facts.find((f) => f.fact_type === 'SIMILAR_CASE_REFERENCE')
    expect(sc).toBeDefined()
    expect(matchEvidenceToRule(sc!, typeOf(sc!.object_refs[0]), index)).toBeNull()
  })
})

describe('动态 Binding 生命周期状态机（§6.2）', () => {
  it('PROPOSED → ACTIVE → REVOKED / SUPERSEDED', () => {
    expect(transitionBindingStatus(BindingStatus.PROPOSED, { kind: 'CONFIRM' })).toBe(BindingStatus.ACTIVE)
    expect(transitionBindingStatus(BindingStatus.ACTIVE, { kind: 'REVOKE' })).toBe(BindingStatus.REVOKED)
    expect(transitionBindingStatus(BindingStatus.ACTIVE, { kind: 'SUPERSEDE' })).toBe(BindingStatus.SUPERSEDED)
  })
  it('终态不回退，未知触发保持原状', () => {
    expect(transitionBindingStatus(BindingStatus.REVOKED, { kind: 'CONFIRM' })).toBe(BindingStatus.REVOKED)
    expect(transitionBindingStatus(BindingStatus.SUPERSEDED, { kind: 'REVOKE' })).toBe(BindingStatus.SUPERSEDED)
    expect(transitionBindingStatus(BindingStatus.PROPOSED, { kind: 'REVOKE' })).toBe(BindingStatus.PROPOSED)
    expect(transitionBindingStatus(BindingStatus.ACTIVE, { kind: 'PROPOSE' })).toBe(BindingStatus.ACTIVE)
  })
})

describe('校验器（引用完整性 + 事件激活）', () => {
  const adapted = loadAdaptedCase('controller_warm_reset_001')
  const snap = replayCase('controller_warm_reset_001')

  it('捕获悬空引用', () => {
    const bad: CrossPlaneBinding[] = [{
      binding_id: 'bind-test-dangling',
      binding_type: CrossPlaneBindingType.INSTANCE_OF,
      source_plane: 'TOPOLOGY',
      source_ref: 'no-such-resource',
      target_plane: 'KNOWLEDGE',
      target_ref: 'no-such-node',
      status: BindingStatus.ACTIVE,
      created_by: { type: 'ADAPTER', ref: 'test' },
      valid_time: { from: null, to: null },
    }]
    const issues = validateCrossPlaneBindings(bad, adapted.instanceTopology, index, snap)
    expect(issues.some((i) => i.code === 'BIND-SRC-MISSING')).toBe(true)
    expect(issues.some((i) => i.code === 'BIND-TGT-MISSING')).toBe(true)
  })

  it('捕获非法类型与重复 id', () => {
    const dup: CrossPlaneBinding = {
      binding_id: 'bind-dup',
      binding_type: CrossPlaneBindingType.INSTANCE_OF,
      source_plane: 'TOPOLOGY',
      source_ref: 'controller-0a',
      target_plane: 'KNOWLEDGE',
      target_ref: 'ot-controller',
      status: BindingStatus.ACTIVE,
      created_by: { type: 'ADAPTER', ref: 'test' },
      valid_time: { from: null, to: null },
    }
    const issues = validateCrossPlaneBindings([dup, { ...dup }], adapted.instanceTopology, index, snap)
    expect(issues.some((i) => i.code === 'BIND-DUP-ID')).toBe(true)
  })

  it('动态 Binding 缺少对应 Runtime 状态时报错', () => {
    const orphan: CrossPlaneBinding = {
      binding_id: 'bind-orphan-cand',
      binding_type: CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE,
      source_plane: 'TOPOLOGY',
      source_ref: 'controller-0a',
      target_plane: 'KNOWLEDGE',
      target_ref: 'fm-controller-warm-reset',
      status: BindingStatus.ACTIVE,
      created_by: { type: 'REASONING', ref: 'candidate:orphan' },
      valid_time: { from: null, to: null },
      candidate_id: 'cand-does-not-exist',
    }
    const issues = validateCrossPlaneBindings([orphan], adapted.instanceTopology, index, snap)
    expect(issues.some((i) => i.code === 'BIND-NO-CANDIDATE-EVENT')).toBe(true)
  })

  it('三 Case 静态 + 动态 Binding 全部通过校验（0 ERROR）', () => {
    for (const caseId of ['controller_warm_reset_001', 'noisy_neighbor_io_contention_001', 'remote_replication_lag_001']) {
      const a = loadAdaptedCase(caseId)
      const s = replayCase(caseId)
      const dyn = deriveDynamicBindings(s, (id) => a.resourceTypeByObject.get(id) ?? null, index)
      const issues = validateCrossPlaneBindings([...a.staticBindings, ...dyn], a.instanceTopology, index, s)
      const errors = issues.filter((i) => i.severity === 'ERROR')
      expect(errors, `${caseId} 动态 Binding 校验`).toEqual([])
    }
  })
})
