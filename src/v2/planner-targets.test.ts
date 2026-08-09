import { describe, expect, it } from 'vitest'
import { loadAdaptedCase } from './case-adapter'
import { createDiagnosisRuntime, generateEvents, replayCase } from './diagnosis-runtime'
import { ProjectionStore } from './projection-store'

/**
 * issue#6 阶段A —— Planner 目标呈现。
 * 覆盖：planner_plan.json 加载、PLAN 事件携带目标、重规划差异、
 * SKILL_STARTED 目标化 reason/expected、投影层目标状态推导与"当前位置"随动。
 */
describe('issue#6 阶段A — Planner 目标呈现', () => {
  it('controller 案例补齐全部任务目标，并按 S1→S3 拓扑深度排序', () => {
    const adapted = loadAdaptedCase('controller_warm_reset_001')
    expect(adapted.plannerPlan).not.toBeNull()
    const targets = adapted.plannerPlan!.targets
    expect(targets.map((t) => t.target_resource)).toEqual([
      'db-host-01',
      'fc-port-0a',
      'fc-port-0b',
      'controller-0a',
      'controller-0b',
      'lun-db01',
      'storage-pool-01',
    ])
    expect(targets.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // 每个目标都具备"为什么验证/期望发现什么/当前范围"。
    for (const t of targets) {
      expect(t.verify_question.length).toBeGreaterThan(0)
      expect(t.expected_finding.length).toBeGreaterThan(0)
      expect(t.scope.length).toBeGreaterThan(0)
      expect(t.topo_path.length).toBeGreaterThan(0)
    }
    expect(targets.find((t) => t.target_resource === 'storage-pool-01')?.round).toBe(2)
    expect(adapted.plannerPlan!.replans).toHaveLength(1)
    expect(adapted.plannerPlan!.replans![0].added_targets).toEqual(['storage-pool-01'])
  })

  it('PLAN_CREATED 携带 round-1 目标；task-check-pool 触发 PLAN_REPLANNED 并追加目标', () => {
    const events = generateEvents(loadAdaptedCase('controller_warm_reset_001'))
    const created = events.find((e) => e.event_type === 'PLAN_CREATED')!
    expect(created.payload['planner_targets']).toHaveLength(6)
    expect(created.payload['planner_original_scope']).toContain('业务专属路径')

    const replanned = events.find((e) => e.event_type === 'PLAN_REPLANNED')!
    expect(replanned).toBeTruthy()
    expect(replanned.payload['planner_targets']).toHaveLength(7)
    expect(replanned.payload['replan']).toMatchObject({
      round: 2,
      original_scope: expect.stringContaining('业务专属路径'),
      new_scope: expect.stringContaining('共享资源'),
      added_targets: ['storage-pool-01'],
    })
  })

  it('SKILL_STARTED 的 reason/expected 基于当前 Planner 目标（不再全为泛化文案）', () => {
    const events = generateEvents(loadAdaptedCase('controller_warm_reset_001'))
    const byTask = new Map(
      events
        .filter((e) => e.event_type === 'SKILL_STARTED')
        .map((e) => [e.payload['task_id'], e.payload]),
    )
    // 池负载任务 → 存储池目标的"为什么验证/期望发现"。
    const pool = byTask.get('task-check-pool')!
    expect(pool['reason_text']).toContain('存储池')
    expect(pool['expected_result_text']).toContain('池利用率')
    // 控制器告警/指纹任务 → 控制器热复位目标。
    const alarm = byTask.get('task-query-controller-alarm')!
    expect(alarm['reason_text']).toContain('Watchdog')
    // 相似案例检索属辅助任务，无目标匹配 → 保留 skill 泛化文案。
    const similar = byTask.get('task-search-similar-case')!
    expect(similar['reason_text']).toContain('Planner 优先级')
  })

  it('投影层 plannerTargets() 推导终态状态（命中故障/已排除/已验证）', () => {
    const snap = replayCase('controller_warm_reset_001')
    const store = new ProjectionStore()
    store.bind(snap)
    const vm = store.plannerTargets()
    expect(vm.targets).toHaveLength(7)
    const byRes = Object.fromEntries(vm.targets.map((t) => [t.target_resource, t.status]))
    expect(byRes['controller-0a']).toBe('verified_abnormal')
    expect(byRes['fc-port-0a']).toBe('excluded')
    expect(byRes['storage-pool-01']).toBe('excluded')
    expect(byRes['lun-db01']).toBe('verified_ok')
    expect(byRes['db-host-01']).toBe('verified_ok')
    expect(vm.has_replan).toBe(true)
    expect(vm.replans[0].added_targets).toEqual(['storage-pool-01'])
  })

  it('诊断推进中 active 目标随 RUNNING 任务移动，重规划后新目标就位', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    const store = new ProjectionStore()
    // 推进到 task-check-pool 运行（重规划在该任务触发，storage-pool-01 进入目标列表）。
    let guard = 0
    while (
      !rt.liveSnapshot.tasks.some((t) => t.task_id === 'task-check-pool' && t.status === 'RUNNING') &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    store.bind(rt.liveSnapshot)
    const vm = store.plannerTargets()
    expect(vm.has_replan).toBe(true)
    expect(vm.targets.find((t) => t.target_resource === 'storage-pool-01')?.status).toBe('active')
    expect(vm.targets.find((t) => t.target_resource === 'storage-pool-01')?.is_active).toBe(true)
  })

  it('扰邻案例重规划新增施压者 host-a 目标', () => {
    const events = generateEvents(loadAdaptedCase('noisy_neighbor_io_contention_001'))
    const replanned = events.find((e) => e.event_type === 'PLAN_REPLANNED')!
    expect(replanned).toBeTruthy()
    expect(replanned.payload['replan']).toMatchObject({ added_targets: ['host-a'] })
    const snap = replayCase('noisy_neighbor_io_contention_001')
    const store = new ProjectionStore()
    store.bind(snap)
    const vm = store.plannerTargets()
    expect(vm.targets.map((t) => t.target_resource)).toContain('host-a')
    expect(vm.targets.find((t) => t.target_resource === 'host-a')?.status).toBe('verified_abnormal')
  })
})
