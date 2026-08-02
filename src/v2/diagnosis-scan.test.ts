import { describe, expect, it } from 'vitest'
import { loadModelData } from '../lib/model-loader'
import { loadAdaptedCase } from './case-adapter'
import { createDiagnosisRuntime, replayCase } from './diagnosis-runtime'
import { ProjectionStore } from './projection-store'
import type { KnowledgeGraphLinkRef, KnowledgeGraphNodeRef } from './projection-store'

/**
 * issue#6 阶段C —— 逐对象诊断循环 + 图谱原始点亮。
 * 覆盖：activeQueryObjectId（running task 当前查询对象）、examinedObjects 判定
 * （根因/故障链/候选/受影响/异常/排除/已排查）、graphEntryAnchors（现象→故障模式
 * 原始点）、graphLitKnowledgeIds（关联知识点扩展）、回放不泄露未来、无图谱上下文
 * 不抛错。
 */

function bindScan(caseId: string, withKg = true) {
  const snap = replayCase(caseId)
  const store = new ProjectionStore()
  const ctx: Parameters<ProjectionStore['bind']>[1] = {
    observationsFacts: loadAdaptedCase(caseId).facts,
  }
  if (withKg) {
    const model = loadModelKnowledgeRefs()
    ctx.knowledgeNodes = model.nodes
    ctx.knowledgeLinks = model.links
  }
  store.bind(snap, ctx)
  return store.diagnosisScan()
}

function loadModelKnowledgeRefs(): {
  nodes: KnowledgeGraphNodeRef[]
  links: KnowledgeGraphLinkRef[]
} {
  // 与 App 一致：从静态 model 的 knowledge 平面取节点/连线（含知识内部跨层 CASE_MATCH）。
  // 这里直接加载 model 数据，避免组件依赖。
  const model = loadModelData()
  const kgNodeIdSet = new Set(
    model.nodes.filter((n) => n.plane === 'knowledge').map((n) => n.id),
  )
  return {
    nodes: model.nodes
      .filter((n) => n.plane === 'knowledge')
      .map((n) => ({
        id: n.id,
        layer: n.group,
        code: typeof n.object.properties.code === 'string' ? (n.object.properties.code as string) : null,
        fault_mode_code:
          (n.object.properties.attributes as Record<string, unknown> | undefined)?.['fault_mode_code'] as
            | string
            | undefined ?? null,
      })),
    links: model.links
      .filter((l) => {
        if (l.category === 'knowledge') return true
        if (l.category === 'cross') {
          return kgNodeIdSet.has(l.source as string) && kgNodeIdSet.has(l.target as string)
        }
        return false
      })
      .map((l) => ({ source: l.source as string, target: l.target as string, relation: l.relation })),
  }
}

describe('issue#6 阶段C — 逐对象诊断循环 diagnosisScan()', () => {
  it('controller 终态：根因/故障链异常、影响橙、排除与已验证对象正常', () => {
    const scan = bindScan('controller_warm_reset_001')
    expect(scan.active_query_object_id).toBeNull()
    expect(scan.focus_object_id).toBe('controller-0a')

    const byObj = new Map(scan.examined_objects.map((o) => [o.object_id, o.verdict]))
    expect(byObj.get('controller-0a')).toBe('ABNORMAL') // 根因
    expect(byObj.get('block-service-01')).toBe('ABNORMAL') // 故障链
    expect(byObj.get('lun-db01')).toBe('IMPACTED') // 影响链
    expect(byObj.get('db-business-01')).toBe('IMPACTED')
    expect(byObj.get('fc-port-0a')).toBe('NORMAL') // 被排除候选
    expect(byObj.get('san-fabric-a')).toBe('NORMAL')
    expect(byObj.get('storage-pool-01')).toBe('NORMAL')
    expect(byObj.get('db-host-01')).toBe('NORMAL') // Planner 已验证
  })

  it('controller 终态：图谱原始点收敛到 症状 + 已确认故障模式（排除项收敛）', () => {
    const scan = bindScan('controller_warm_reset_001')
    expect(scan.graph_entry_anchors).toContain('sym-latency-increase')
    expect(scan.graph_entry_anchors).toContain('fm-controller-warm-reset')
    // 已排除候选的故障模式不再点亮。
    expect(scan.graph_entry_anchors).not.toContain('fm-fc-link-flap')
    expect(scan.graph_entry_anchors).not.toContain('fm-pool-bottleneck')
  })

  it('controller 终态：关联知识点点亮机制/证据规则/历史案例', () => {
    const scan = bindScan('controller_warm_reset_001')
    for (const id of [
      'mech-watchdog',
      'mech-io-interruption',
      'er-reset-alarm',
      'er-watchdog-fp',
      'er-latency-impact',
      'case-warm-reset-001',
    ]) {
      expect(scan.graph_lit_knowledge_ids).toContain(id)
    }
  })

  it('controller 取证期：activeQuery 随 RUNNING 任务移动，扫描对象标记 is_scanning', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    let guard = 0
    // 推进到控制器告警任务运行中。
    while (
      !rt.liveSnapshot.tasks.some(
        (t) => t.task_id === 'task-query-controller-alarm' && t.status === 'RUNNING',
      ) &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, { observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts })
    const scan = store.diagnosisScan()
    expect(scan.active_query_object_id).toBe('controller-0a')
    const ctrl = scan.examined_objects.find((o) => o.object_id === 'controller-0a')!
    expect(ctrl.is_scanning).toBe(true)
    expect(ctrl.is_focus).toBe(true)
  })

  it('controller 取证初期：候选故障模式全部点亮（活跃假设展开）', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    let guard = 0
    while (
      !rt.liveSnapshot.tasks.some(
        (t) => t.task_id === 'task-query-controller-alarm' && t.status === 'RUNNING',
      ) &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, {
      observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts,
      knowledgeNodes: loadModelKnowledgeRefs().nodes,
      knowledgeLinks: loadModelKnowledgeRefs().links,
    })
    const scan = store.diagnosisScan()
    // 初始候选 4 个（controller-warm-reset / fc-link-flap / san-link-fault / pool-bottleneck）均在活跃假设。
    expect(scan.graph_entry_anchors).toContain('fm-controller-warm-reset')
    expect(scan.graph_entry_anchors).toContain('fm-fc-link-flap')
    expect(scan.graph_entry_anchors).toContain('fm-san-link-fault')
    expect(scan.graph_entry_anchors).toContain('fm-pool-bottleneck')
  })

  it('noisy 终态：施压者 host-a 异常（确认根因），争用链异常，受害者受影响', () => {
    const scan = bindScan('noisy_neighbor_io_contention_001')
    const byObj = new Map(scan.examined_objects.map((o) => [o.object_id, o.verdict]))
    expect(byObj.get('host-a')).toBe('ABNORMAL') // 确认根因（扰邻施压者）
    expect(byObj.get('lun-a')).toBe('ABNORMAL') // 根因链（施压者 IO 路径）
    expect(byObj.get('controller-0a')).toBe('ABNORMAL') // 共享争用点（根因链）
    expect(byObj.get('storage-pool-01')).toBe('ABNORMAL') // 共享争用点（根因链）
    expect(byObj.get('lun-b')).toBe('IMPACTED') // 受害者
    expect(byObj.get('host-b')).toBe('IMPACTED')
    expect(scan.graph_entry_anchors).toContain('sym-latency-increase')
  })

  it('无图谱上下文：图谱点亮为空，不抛错；对象判定不受影响', () => {
    const scan = bindScan('controller_warm_reset_001', false)
    expect(scan.graph_entry_anchors).toHaveLength(0)
    expect(scan.graph_lit_knowledge_ids).toHaveLength(0)
    expect(scan.examined_objects.length).toBeGreaterThan(0)
  })

  it('回放：activeQuery 只反映已推进到的运行中任务，不泄露未来', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    // 停在 controller 告警任务运行中（只推进到 seq 8）。
    let guard = 0
    while (
      !rt.liveSnapshot.tasks.some(
        (t) => t.task_id === 'task-query-controller-alarm' && t.status === 'RUNNING',
      ) &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    const liveSeq = rt.liveHead
    // 回放到该点（游标 == liveHead，即当前态）——等价实时。
    const replayed = rt.seek(liveSeq)
    const store = new ProjectionStore()
    store.bind(replayed.snapshot, { observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts })
    const scan = store.diagnosisScan()
    expect(scan.active_query_object_id).toBe('controller-0a')
    // 尚未推进到 fc-port 检查任务：fc-port 不应是扫描对象。
    expect(scan.active_query_object_id).not.toBe('fc-port-0a')
  })

  it('五类 Case 均可计算，examined_objects 判定合法', () => {
    for (const caseId of [
      'controller_warm_reset_001',
      'noisy_neighbor_io_contention_001',
      'remote_replication_lag_001',
      'disk_raid_degrade_001',
      'layered_topology_demo_001',
    ]) {
      const scan = bindScan(caseId)
      expect(scan.examined_objects.length).toBeGreaterThan(0)
      for (const o of scan.examined_objects) {
        expect(o.verdict === null || ['NORMAL', 'ABNORMAL', 'IMPACTED', 'CANDIDATE'].includes(o.verdict)).toBe(true)
      }
    }
  })
})
