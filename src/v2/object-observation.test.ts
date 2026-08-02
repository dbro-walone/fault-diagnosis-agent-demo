import { describe, expect, it } from 'vitest'
import { loadAdaptedCase } from './case-adapter'
import { createDiagnosisRuntime, replayCase } from './diagnosis-runtime'
import { ProjectionStore } from './projection-store'

/**
 * issue#6 阶段B —— 对象观测三标签（告警｜性能｜日志）。
 * 覆盖：按对象 × 观测类别的查询状态推导、异常/正常判定、未查询不强制扫描、
 * 回放不泄露未来、失败注入→数据缺失、observations 全量 Fact 的 items 补充。
 */

function terminalPanel(caseId: string) {
  const snap = replayCase(caseId)
  const store = new ProjectionStore()
  store.bind(snap, { observationsFacts: loadAdaptedCase(caseId).facts })
  return store.objectObservationPanel()
}

describe('issue#6 阶段B — 对象观测三标签', () => {
  it('controller：焦点对象三类观测均按 Skill 任务查询到异常', () => {
    const panel = terminalPanel('controller_warm_reset_001')
    expect(panel.focus_object_id).toBe('controller-0a')
    const focus = panel.objects.find((o) => o.is_focus)!
    expect(focus.display_name).toBe('Controller-0A')

    // 告警：QUERY_ALARM 任务命中 CRITICAL 热复位告警。
    expect(focus.alarms.status).toBe('QUERIED_ABNORMAL')
    expect(focus.alarms.items).toHaveLength(1)
    expect(focus.alarms.items[0].title).toContain('控制器发生热复位')
    expect(focus.alarms.items[0].abnormal).toBe(true)
    expect(focus.alarms.queried_by).toContain('task-query-controller-alarm')

    // 性能：QUERY_KPI 任务命中吞吐降零（低于 critical_low）。
    expect(focus.perf.status).toBe('QUERIED_ABNORMAL')
    expect(focus.perf.items[0].title).toContain('Controller-0A I/O吞吐')
    expect(focus.perf.items[0].abnormal).toBe(true)

    // 日志：指纹命中（含 ERROR 级匹配日志）。
    expect(focus.logs.status).toBe('QUERIED_ABNORMAL')
    expect(focus.logs.items.some((i) => i.kind === 'fingerprint')).toBe(true)
    expect(focus.logs.items.some((i) => i.kind === 'log')).toBe(true)
    expect(focus.logs.items.some((i) => i.abnormal)).toBe(true)
  })

  it('controller：lun-db01 性能异常、告警/日志未查询；db-host-01 三类均未查询', () => {
    const panel = terminalPanel('controller_warm_reset_001')
    const lun = panel.objects.find((o) => o.object_id === 'lun-db01')!
    expect(lun.perf.status).toBe('QUERIED_ABNORMAL')
    expect(lun.perf.items[0].detail).toContain('38.6')
    expect(lun.alarms.status).toBe('NOT_QUERIED')
    expect(lun.logs.status).toBe('NOT_QUERIED')

    // 未查询的对象不展示任何条目（不强制扫描）。
    const host = panel.objects.find((o) => o.object_id === 'db-host-01')!
    expect(host.alarms.status).toBe('NOT_QUERIED')
    expect(host.perf.status).toBe('NOT_QUERIED')
    expect(host.logs.status).toBe('NOT_QUERIED')
    expect(host.alarms.items).toHaveLength(0)
  })

  it('controller：fc-port 经 link_health_query 查询性能且正常；告警/日志未查询', () => {
    const panel = terminalPanel('controller_warm_reset_001')
    const port = panel.objects.find((o) => o.object_id === 'fc-port-0a')!
    expect(port.perf.status).toBe('QUERIED_NORMAL')
    expect(port.perf.items[0].title).toContain('FC端口CRC错误增量')
    expect(port.perf.items[0].abnormal).toBe(false)
    expect(port.alarms.status).toBe('NOT_QUERIED')
    expect(port.logs.status).toBe('NOT_QUERIED')
  })

  it('回放：任务完成前不泄露未来（告警任务 RUNNING 时控制器告警为未查询）', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    let guard = 0
    while (
      !rt.liveSnapshot.tasks.some((t) => t.task_id === 'task-query-controller-alarm' && t.status === 'RUNNING') &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, { observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts })
    const panel = store.objectObservationPanel()
    const ctrl = panel.objects.find((o) => o.object_id === 'controller-0a')!
    // 告警任务尚在执行：不显示查询结果。
    expect(ctrl.alarms.status).toBe('NOT_QUERIED')
    expect(ctrl.alarms.items).toHaveLength(0)
  })

  it('失败注入：DATA_MISSING 任务使对应对象类别状态为数据缺失', () => {
    // 注入后事件流变短，推进到终态再取快照。
    const full = createDiagnosisRuntime('controller_warm_reset_001', [
      { taskId: 'task-query-controller-alarm', kind: 'DATA_MISSING' },
    ])
    let rt = full
    let guard = 0
    while (!rt.complete && guard++ < 1000) rt = rt.advance()
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, { observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts })
    const panel = store.objectObservationPanel()
    const ctrl = panel.objects.find((o) => o.object_id === 'controller-0a')!
    expect(ctrl.alarms.status).toBe('DATA_MISSING')
  })

  it('noisy：host-a 日志已查询（指纹命中）且无异常；lun-a 性能异常', () => {
    const panel = terminalPanel('noisy_neighbor_io_contention_001')
    const hostA = panel.objects.find((o) => o.object_id === 'host-a')!
    expect(hostA.logs.status).toBe('QUERIED_NORMAL')
    expect(hostA.logs.items.some((i) => i.kind === 'fingerprint')).toBe(true)
    expect(hostA.alarms.status).toBe('NOT_QUERIED')
    expect(hostA.perf.status).toBe('NOT_QUERIED')

    const lunA = panel.objects.find((o) => o.object_id === 'lun-a')!
    expect(lunA.perf.status).toBe('QUERIED_ABNORMAL')
    expect(lunA.perf.items.some((i) => i.title.includes('IOPS'))).toBe(true)
  })

  it('无 observations 上下文时回退快照内已发现 Fact，不抛错', () => {
    const snap = replayCase('remote_replication_lag_001')
    const store = new ProjectionStore()
    store.bind(snap) // 不传 observationsFacts
    const panel = store.objectObservationPanel()
    expect(panel.objects.length).toBeGreaterThan(0)
    const focus = panel.objects.find((o) => o.is_focus)
    expect(focus?.perf.status).toBe('QUERIED_ABNORMAL')
  })

  it('五类 Case 面板均可计算且焦点对象存在于对象列表', () => {
    for (const caseId of [
      'controller_warm_reset_001',
      'noisy_neighbor_io_contention_001',
      'remote_replication_lag_001',
      'disk_raid_degrade_001',
      'layered_topology_demo_001',
    ]) {
      const panel = terminalPanel(caseId)
      expect(panel.objects.length).toBeGreaterThan(0)
      if (panel.focus_object_id) {
        expect(panel.objects.some((o) => o.object_id === panel.focus_object_id)).toBe(true)
      }
      for (const o of panel.objects) {
        for (const k of ['alarms', 'perf', 'logs'] as const) {
          expect(['QUERIED_ABNORMAL', 'QUERIED_NORMAL', 'NOT_QUERIED', 'DATA_MISSING', 'PARTIAL']).toContain(o[k].status)
        }
      }
    }
  })
})
