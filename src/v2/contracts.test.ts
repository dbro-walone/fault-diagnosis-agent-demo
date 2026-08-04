// 工程接口基线（docs/19 §16）—— 四类契约接口测试。
import { describe, expect, it } from 'vitest'
import { caseKnowledgeAdapter, contractSurface } from './contracts'
import { loadAdaptedCase } from './case-adapter'
import { replayCase } from './diagnosis-runtime'
import { createTopologyService } from './topology-service'
import { createKnowledgeService } from './knowledge-service'
import { runtimeContract } from './runtime-contract'

describe('Adapter Contract（§16.1）', () => {
  it('compile_case → create_runtime_seed → resolve_release 链路', () => {
    const adapted = loadAdaptedCase('controller_warm_reset_001')
    const events = replayCase('controller_warm_reset_001').events
    const compiled = caseKnowledgeAdapter.compile_case(adapted, undefined, { generalize: true })
    expect(compiled.caseId).toBe('controller_warm_reset_001')
    expect(compiled.compile.pipeline_steps).toContain('A10')

    const seed = caseKnowledgeAdapter.create_runtime_seed(compiled, { session_id: 's1' })
    expect(seed.schema_name).toBe('dme-diagnosis-runtime-seed')
    expect(seed.initial_visible_context.facts).toHaveLength(0) // T0/T1 干净

    // 终态事件 → 结论已释放；首个终态事件之前 → 未释放（渐进）。
    const lastEvent = events[events.length - 1]
    const release = caseKnowledgeAdapter.resolve_release(compiled, lastEvent, {
      events,
      through_sequence: lastEvent.sequence,
    })
    expect(release).not.toBeNull()
    if ('conclusionReleased' in release) expect(release.conclusionReleased).toBe(true)

    const firstTerminal = events.find((e) =>
      ['ROOT_CAUSE_CONFIRMED', 'PROBABLE_CAUSES_REPORTED', 'INSUFFICIENT_EVIDENCE_REPORTED'].includes(e.event_type),
    )!
    const early = caseKnowledgeAdapter.resolve_release(compiled, firstTerminal, {
      events,
      through_sequence: Math.max(0, firstTerminal.sequence - 1),
    })
    if ('conclusionReleased' in early) expect(early.conclusionReleased).toBe(false)
  })

  it('resolve_release 对不在事件流中的事件返回 AdapterError', () => {
    const adapted = loadAdaptedCase('controller_warm_reset_001')
    const compiled = caseKnowledgeAdapter.compile_case(adapted)
    const events = replayCase('controller_warm_reset_001').events
    const err = caseKnowledgeAdapter.resolve_release(compiled, { ...events[0], event_id: 'fake-event' }, { events, through_sequence: 1 })
    if ('conclusionReleased' in err) {
      // 意外走通正常路径（不应发生）。
      expect(false).toBe(true)
    } else {
      expect(err.code.startsWith('RT-')).toBe(true)
    }
  })
})

describe('Topology / Knowledge / Runtime Contract（§16.2/16.3/16.4）', () => {
  it('contractSurface 提供四类入口', () => {
    expect(contractSurface.adapter.compile_case).toBeTypeOf('function')
    expect(contractSurface.knowledge().match_entries).toBeTypeOf('function')
    expect(contractSurface.runtime.create_session).toBeTypeOf('function')
    const topo = contractSurface.topology(loadAdaptedCase('noisy_neighbor_io_contention_001').instanceTopology)
    expect(topo.find_shared_resources(['host-a', 'host-b'], { max_depth: 3 }).length).toBeGreaterThan(0)
  })

  it('独立服务入口一致', () => {
    const topo = createTopologyService(loadAdaptedCase('controller_warm_reset_001').instanceTopology)
    const kg = createKnowledgeService()
    const rt = runtimeContract
    expect(topo.find_paths('controller-0a', 'controller-0b').length).toBeGreaterThan(0)
    expect(kg.get_evidence_requirements('CONTROLLER_WARM_RESET').requirements.length).toBeGreaterThan(0)
    expect(rt.has_session('nope')).toBe(false)
  })
})
