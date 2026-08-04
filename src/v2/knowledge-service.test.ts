// Knowledge Service 测试（docs/19 §16.3 / §4.8）—— KG 3.0.0 只读查询。
// 数据源为 model/knowledge_graph_package；禁止静默修复（多义 code 抛 CKA-MAP-001）。
import { describe, expect, it } from 'vitest'
import {
  match_entries,
  expand_knowledge,
  get_evidence_requirements,
  createKnowledgeService,
} from './knowledge-service'

describe('Knowledge Service —— match_entries（§16.3）', () => {
  it('LATENCY_INCREASE 命中 SYMPTOM_CONCEPT 与全部时延故障模式', () => {
    const match = match_entries('LATENCY_INCREASE', 'HOST', [])
    expect(match.symptom_concept_refs).toContain('sym-latency-increase')
    expect(match.resource_type_refs).toContain('ot-host')
    expect(match.fault_mode_refs.length).toBeGreaterThanOrEqual(6)
    expect(match.fault_mode_refs).toContain('fm-controller-warm-reset')
    expect(match.fault_mode_refs).toContain('fm-pool-bottleneck')
  })

  it('RPO_EXCEEDED 命中复制场景（场景聚合）', () => {
    const match = match_entries('RPO_EXCEEDED', null, [])
    expect(match.fault_mode_refs).toContain('fm-replication-congestion')
    expect(match.scenario_refs.some((id) => id.startsWith('scenario-'))).toBe(true)
  })

  it('未知码抛 CKA-MAP-001（多义/不存在，禁止猜测）', () => {
    expect(() => match_entries('NOT_A_REAL_SYMPTOM_CODE', null, [])).toThrow(/CKA-MAP-001/)
  })

  it('known_fact_refs 存在时给出证据需求上下文', () => {
    const match = match_entries('LATENCY_INCREASE', 'HOST', ['fact-1'])
    expect(match.evidence_requirement_refs.length).toBeGreaterThan(0)
  })
})

describe('Knowledge Service —— expand_knowledge（§16.3）', () => {
  it('沿 REQUIRES_EVIDENCE 从故障模式展开到证据需求', () => {
    const delta = expand_knowledge(['fm-controller-warm-reset'], ['REQUIRES_EVIDENCE'], 1)
    expect(delta.nodes.some((n) => n.node_type === 'EVIDENCE_REQUIREMENT')).toBe(true)
    expect(delta.edges.every((e) => e.relation_type === 'REQUIRES_EVIDENCE')).toBe(true)
  })

  it('入口不存在抛 IT-REF-001', () => {
    expect(() => expand_knowledge(['no-such-node'], [], 1)).toThrow(/IT-REF-001/)
  })

  it('不限定关系时沿出边多跳展开', () => {
    const delta = expand_knowledge(['fm-controller-warm-reset'], [], 2)
    expect(delta.nodes.length).toBeGreaterThan(3)
    expect(delta.edges.length).toBeGreaterThan(0)
  })
})

describe('Knowledge Service —— get_evidence_requirements（§16.3）', () => {
  it('控制器热复位要求四类证据（DIRECT/MECHANISM/STATE_CHANGE/IMPACT）', () => {
    const req = get_evidence_requirements('fm-controller-warm-reset')
    expect(req.fault_mode_ref).toBe('fm-controller-warm-reset')
    const codes = req.requirements.map((r) => r.code)
    expect(codes).toEqual(expect.arrayContaining([
      'DIRECT_FAULT_EVIDENCE',
      'MECHANISM_EVIDENCE',
      'STATE_CHANGE_EVIDENCE',
      'BUSINESS_IMPACT_EVIDENCE',
    ]))
    for (const r of req.requirements) {
      expect(r.satisfied_by_rule).toBeTruthy() // SATISFIED_BY_RULE 闭合
    }
  })

  it('场景码聚合其全部故障模式的证据需求', () => {
    const req = get_evidence_requirements('scenario-controller-anomaly')
    expect(req.scenario_ref).toBe('scenario-controller-anomaly')
    expect(req.requirements.length).toBeGreaterThan(0)
  })

  it('code 也解析（resolveCode 支持 code/node_id 双输入）', () => {
    const req = get_evidence_requirements('CONTROLLER_WARM_RESET')
    expect(req.fault_mode_ref).toBe('fm-controller-warm-reset')
  })

  it('非故障入口抛 CKA-MAP-001', () => {
    expect(() => get_evidence_requirements('ot-controller')).toThrow(/CKA-MAP-001/)
  })
})

describe('Knowledge Service —— createKnowledgeService（§16.3 服务对象）', () => {
  it('提供三查询入口', () => {
    const svc = createKnowledgeService()
    expect(svc.match_entries('LATENCY_INCREASE', null, []).fault_mode_refs.length).toBeGreaterThan(0)
    expect(svc.expand_knowledge(['fm-controller-warm-reset'], ['REQUIRES_EVIDENCE'], 1).nodes.length).toBeGreaterThan(0)
    expect(svc.get_evidence_requirements('CONTROLLER_WARM_RESET').requirements.length).toBeGreaterThan(0)
  })
})
