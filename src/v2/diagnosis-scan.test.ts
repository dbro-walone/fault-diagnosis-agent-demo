import { describe, expect, it } from 'vitest'
import { loadModelData } from '../lib/model-loader'
import { loadAdaptedCase } from './case-adapter'
import { createDiagnosisRuntime, replayCase } from './diagnosis-runtime'
import { createEmptySnapshot } from './event-reducer'
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
        node_type:
          typeof n.object.properties.knowledgeKind === 'string'
            ? (n.object.properties.knowledgeKind as string)
            : null,
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
  it('PLAN_CREATED 前保持无焦点，不回退到 agent_focus', () => {
    const snap = createEmptySnapshot('session-pre-plan', 'layered_topology_demo_001')
    snap.session.agent_focus = {
      source_type: 'candidate',
      source_id: 'candidate-pre-plan',
      object_refs: ['lun-backup-01'],
      path_refs: [],
    }
    const store = new ProjectionStore()
    store.bind(snap)

    expect(store.diagnosisScan().focus_object_id).toBeNull()
    expect(store.viewProjection().view_hint.focus_object_id).toBeNull()
  })

  it('controller 终态：根因/故障链异常、影响橙、排除与已验证对象正常', () => {
    const scan = bindScan('controller_warm_reset_001')
    expect(scan.is_terminal).toBe(true)
    expect(scan.active_query_object_id).toBeNull()
    // Bug3 fix: 诊断终态后 focus 也为 null（画布停止扫描态）。
    expect(scan.focus_object_id).toBeNull()

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

  it('issue#10 案例库门控：诊断进行中（未终态）不点亮历史案例节点；终态才关联显示', () => {
    // 推进到 controller 告警任务运行中（取证期，未终态）。
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
    expect(rt.liveSnapshot.session.terminal_status).toBeNull() // 确认未终态
    const midStore = new ProjectionStore()
    midStore.bind(rt.liveSnapshot, {
      observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts,
      knowledgeNodes: loadModelKnowledgeRefs().nodes,
      knowledgeLinks: loadModelKnowledgeRefs().links,
    })
    const mid = midStore.diagnosisScan()
    expect(mid.is_terminal).toBe(false)
    // 诊断中：症状/场景等入口锚点照常点亮，但 HISTORICAL_CASE 案例节点不点亮（真值隔离 Gate5）。
    expect(mid.graph_entry_anchors.length).toBeGreaterThan(0)
    expect(mid.graph_lit_knowledge_ids).not.toContain('case-warm-reset-001')
    // 终态：案例节点恢复关联显示。
    const terminal = bindScan('controller_warm_reset_001')
    expect(terminal.graph_lit_knowledge_ids).toContain('case-warm-reset-001')
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

  it('controller 取证初期：候选为场景级锚点点亮；终态才点亮精确故障模式（阶段4 真值隔离）', () => {
    // 推进到控制器告警任务运行中（证据尚未形成，候选仍为泛化场景级，docs/19 §10.4）。
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
    const earlyStore = new ProjectionStore()
    earlyStore.bind(rt.liveSnapshot, {
      observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts,
      knowledgeNodes: loadModelKnowledgeRefs().nodes,
      knowledgeLinks: loadModelKnowledgeRefs().links,
    })
    const early = earlyStore.diagnosisScan()
    // 4 个泛化候选（SCENE_CONTROLLER_ANOMALY / SCENE_PATH_LINK_ANOMALY×2 / SCENE_BACKEND_DEGRADATION）
    // 点亮 FAULT_SCENARIO 场景节点，不泄露精确 FaultMode。
    expect(early.graph_entry_anchors).toContain('scenario-controller-anomaly')
    expect(early.graph_entry_anchors).toContain('scenario-path-link-anomaly')
    expect(early.graph_entry_anchors).toContain('scenario-backend-degradation')
    expect(early.graph_entry_anchors).not.toContain('fm-controller-warm-reset')

    // 终态：候选细化后根因的精确故障模式点亮；被排除候选从锚点收敛（docs/05 §5）。
    const final = bindScan('controller_warm_reset_001')
    expect(final.graph_entry_anchors).toContain('fm-controller-warm-reset')
    expect(final.graph_entry_anchors).not.toContain('fm-fc-link-flap')
    expect(final.graph_entry_anchors).not.toContain('fm-pool-bottleneck')
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
        expect(Array.isArray(o.metrics)).toBe(true)
        for (const m of o.metrics) {
          expect(typeof m.name).toBe('string')
          expect(typeof m.value).toBe('string')
          expect(['normal', 'warning', 'critical'].includes(m.tone)).toBe(true)
        }
      }
    }
  })

  it('controller 终态：排查路径严格按增强后的 PLANNER S1→S3 seq 序', () => {
    const scan = bindScan('controller_warm_reset_001')
    expect(scan.path_object_ids).toEqual([
      'db-business-01',
      'db-host-01',
      'san-fabric-a',
      'san-fabric-b',
      'fc-port-0a',
      'fc-port-0b',
      'controller-0a',
      'controller-0b',
      'block-service-01',
      'lun-db01',
      'storage-pool-01',
    ])
  })

  it('controller 取证期：排查路径只累积到已排查目标，不泄露未来目标', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    let guard = 0
    // 推进到 KPI 查询任务运行中（lun-db01 正被查询；controller 已由告警查询覆盖）。
    while (
      !rt.liveSnapshot.tasks.some(
        (t) => t.task_id === 'task-query-kpi' && t.status === 'RUNNING',
      ) &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, { observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts })
    const scan = store.diagnosisScan()
    expect(scan.path_object_ids[0]).toBe('san-fabric-a')
    // 已排查的 controller（告警事实已由终态任务覆盖）进入路径。
    expect(scan.path_object_ids).toContain('controller-0a')
    // fc-port 排在 KPI 之前（Bug1+2 fix：任务按 Planner seq 排序），此时已排查入路径。
    // 尚未排查到的 storage-pool（round=2 replan 目标）不进路径（不泄露未来）。
    expect(scan.path_object_ids).not.toContain('storage-pool-01')
  })

  it('controller 终态：已排查节点带指标芯片（名称+数值+分级着色）', () => {
    const scan = bindScan('controller_warm_reset_001')
    const ctrl = scan.examined_objects.find((o) => o.object_id === 'controller-0a')!
    // 根因控制器：吞吐降为0（critical）+ 热复位告警（critical）→ 至少 2 个异常红芯片。
    expect(ctrl.metrics.length).toBeGreaterThan(0)
    const criticalChips = ctrl.metrics.filter((m) => m.tone === 'critical')
    expect(criticalChips.length).toBeGreaterThanOrEqual(1)
    expect(criticalChips.some((m) => m.name.includes('吞吐') && m.value.includes('GB/s'))).toBe(true)
    expect(criticalChips.some((m) => m.name.includes('热复位') || m.value.includes('严重'))).toBe(true)

    // 时延突增 LUN：峰值 38.6ms 超 critical 阈值 → 红色 KPI 芯片。
    const lun = scan.examined_objects.find((o) => o.object_id === 'lun-db01')!
    expect(lun.metrics.some((m) => m.tone === 'critical' && m.value.includes('ms'))).toBe(true)

    // 未排查对象无芯片。
    for (const o of scan.examined_objects) {
      if (o.verdict === null) expect(o.metrics).toHaveLength(0)
    }
  })

  // ── 排查路径与 case 无关：能力由 PLANNER seq 序 + 观测 Fact 驱动，无 case 特判 ──

  it('noisy 终态：排查路径严格按增强后的 PLANNER S1→S3 seq 序', () => {
    const scan = bindScan('noisy_neighbor_io_contention_001')
    expect(scan.path_object_ids).toEqual([
      'business-a',
      'business-b',
      'host-a',
      'host-b',
      'san-fabric-01',
      'fc-port-0a',
      'controller-0a',
      'lun-a',
      'lun-b',
      'storage-pool-01',
    ])
  })

  it('remote 终态：排查路径严格按增强后的 PLANNER S1→S3 seq 序', () => {
    const scan = bindScan('remote_replication_lag_001')
    expect(scan.path_object_ids).toEqual([
      'prod-business',
      'wan-path-01',
      'wan-router-a',
      'wan-router-b',
      'repl-port-a',
      'repl-port-b',
      'replication-session-rs01',
      'lun-dr',
      'lun-prod',
      'pool-a',
      'pool-b',
    ])
  })

  it('issue#9 终态：entry_object_refs 给出故障入口业务对象（症状对象同源）', () => {
    const scan = bindScan('controller_warm_reset_001')
    expect(scan.entry_object_refs).toEqual(['db-business-01', 'lun-db01'])
    const noisy = bindScan('noisy_neighbor_io_contention_001')
    expect(noisy.entry_object_refs.length).toBeGreaterThan(0)
    const remote = bindScan('remote_replication_lag_001')
    expect(remote.entry_object_refs).toContain('replication-session-rs01')
  })

  it('issue#9 症状未归一化前：entry_object_refs 回退 RuntimeSeed 公开入口对象（聚焦链路初始化）', () => {
    // seq 1（DIAGNOSIS_SESSION_CREATED）症状尚未归一化。
    const rt = createDiagnosisRuntime('controller_warm_reset_001').advance()
    // 绑定 seed 公开入口对象 → 聚焦链路从启动即初始化到入口业务对象。
    const seeded = new ProjectionStore()
    seeded.bind(rt.snapshot, {
      entryObjectRefs: rt.compiled.runtimeSeed.public_input.entry_object_refs,
    })
    expect(seeded.diagnosisScan().entry_object_refs).toEqual(['db-business-01', 'lun-db01'])
    // 未绑 seed：症状未归一化前为空（不泄露）。
    const plain = new ProjectionStore()
    plain.bind(rt.snapshot, {})
    expect(plain.diagnosisScan().entry_object_refs).toHaveLength(0)
  })

  it('noisy 推进期：排查路径保持终态 seq 序、只含已排查目标、单调累积（case 无关）', () => {
    const final = bindScan('noisy_neighbor_io_contention_001').path_object_ids
    const finalIdx = new Map(final.map((id, i) => [id, i]))
    let rt = createDiagnosisRuntime('noisy_neighbor_io_contention_001')
    let prevLen = 0
    let guard = 0
    while (!rt.complete && guard++ < 3000) {
      rt = rt.advance()
      const store = new ProjectionStore()
      store.bind(rt.liveSnapshot, {
        observationsFacts: loadAdaptedCase('noisy_neighbor_io_contention_001').facts,
      })
      const path = store.diagnosisScan().path_object_ids
      // ① 只含终态排查集合中的目标（不泄露"最终不在排查集合"的对象）；
      // ② 保持终态路径的 PLANNER seq 顺序（是终态路径的子序列——replan/施压者可能先排查，
      //    中间路径允许"空洞"，但顺序不乱）；
      // ③ 长度单调不降（已走过的目标不会退回去）。
      for (const id of path) expect(finalIdx.has(id)).toBe(true)
      const seq = path.map((id) => finalIdx.get(id)!)
      expect(seq).toEqual([...seq].sort((a, b) => a - b))
      expect(path.length).toBeGreaterThanOrEqual(prevLen)
      prevLen = path.length
    }
  })

  it('layered_topology_demo_001：诊断启动后聚焦对象应为 S1，而非 S3 症状对象', () => {
    let rt = createDiagnosisRuntime('layered_topology_demo_001')
    for (let i = 0; i < 30; i++) {
      rt = rt.advance()
      const snap = rt.snapshot
      if (snap.planner_targets.length > 0) {
        const store = new ProjectionStore()
        store.bind(snap, {
          observationsFacts: loadAdaptedCase('layered_topology_demo_001').facts,
        })
        const scan = store.diagnosisScan()
        const sortedTargets = [...snap.planner_targets].sort((a, b) => a.seq - b.seq)
        expect(scan.focus_object_id).toBe(sortedTargets[0].target_resource)
        break
      }
    }
  })

  it('layered_topology_demo_001：任务间隙由下一个 pending Planner 目标接管焦点', () => {
    let rt = createDiagnosisRuntime('layered_topology_demo_001')
    let checkedGaps = 0
    for (let i = 0; i < 2000 && !rt.complete; i++) {
      rt = rt.advance()
      const snap = rt.snapshot
      if (
        snap.planner_targets.length === 0 ||
        snap.session.terminal_status ||
        snap.tasks.some((task) => task.status === 'RUNNING')
      ) continue

      const store = new ProjectionStore()
      store.bind(snap, {
        observationsFacts: loadAdaptedCase('layered_topology_demo_001').facts,
      })
      const nextPending = [...store.plannerTargets().targets]
        .sort((a, b) => a.seq - b.seq)
        .find((target) => target.status === 'pending')
      if (!nextPending) continue

      expect(store.diagnosisScan().focus_object_id).toBe(nextPending.target_resource)
      checkedGaps++
    }
    expect(checkedGaps).toBeGreaterThan(0)
  })
})
