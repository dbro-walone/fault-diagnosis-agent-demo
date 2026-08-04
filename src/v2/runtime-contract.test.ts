// Runtime Contract 测试（docs/19 §16.4）—— append_event / get_snapshot / subscribe_events。
// 确定性：同一 Seed + 同一有序事件序列必须生成语义等价 Snapshot；乱序/伪造事件显式报 RT-*。
import { describe, expect, it } from 'vitest'
import { runtimeContract } from './runtime-contract'
import { replayCase } from './diagnosis-runtime'
import { listCases } from './manifest'

describe('Runtime Contract（§16.4）', () => {
  it('create_session 返回初始句柄；未知 Case 抛 CKA-PKG-001', () => {
    runtimeContract.reset()
    const handle = runtimeContract.create_session('controller_warm_reset_001', 'rt-test-1')
    expect(handle.session_id).toBe('rt-test-1')
    expect(handle.accepted_sequence).toBe(0)
    expect(handle.snapshot.events).toHaveLength(0)
    expect(() => runtimeContract.create_session('no-such-case')).toThrow(/CKA-PKG-001/)
  })

  it('append_event 逐条前进；入参事件与作者流一致', () => {
    runtimeContract.reset()
    const events = replayCase('controller_warm_reset_001').events
    const sid = 'rt-test-append'
    runtimeContract.create_session('controller_warm_reset_001', sid)
    let seq = 0
    for (const e of events) {
      seq = runtimeContract.append_event(sid, e)
      expect(seq).toBe(e.sequence)
    }
    // 事件流耗尽后再 append 抛出。
    expect(() => runtimeContract.append_event(sid, { ...events[0], sequence: events.length + 1 })).toThrow(/RT-002|RT-004/)
    expect(runtimeContract.get_snapshot(sid).events).toHaveLength(events.length)
    runtimeContract.reset()
  })

  it('重复提交已应用事件幂等（返回当前 accepted_sequence，不二次应用）', () => {
    runtimeContract.reset()
    const events = replayCase('controller_warm_reset_001').events
    const sid = 'rt-test-idem'
    runtimeContract.create_session('controller_warm_reset_001', sid)
    runtimeContract.append_event(sid, events[0])
    runtimeContract.append_event(sid, events[1])
    const before = runtimeContract.get_snapshot(sid)
    // 重复提交 sequence=1 与 2：幂等返回 liveHead，快照不变。
    expect(runtimeContract.append_event(sid, events[0])).toBe(2)
    expect(runtimeContract.append_event(sid, events[1])).toBe(2)
    const after = runtimeContract.get_snapshot(sid)
    expect(JSON.stringify(before)).toBe(JSON.stringify(after))
    runtimeContract.reset()
  })

  it('乱序/伪造事件抛 RT-004（禁止静默跳过）', () => {
    runtimeContract.reset()
    const events = replayCase('controller_warm_reset_001').events
    const sid = 'rt-test-outoforder'
    runtimeContract.create_session('controller_warm_reset_001', sid)
    // 先提交 seq=2（期望 seq=1）→ 乱序。
    expect(() => runtimeContract.append_event(sid, events[1])).toThrow(/RT-004/)
    runtimeContract.reset()
  })

  it('get_snapshot 支持任意 sequence 回放', () => {
    runtimeContract.reset()
    const events = replayCase('noisy_neighbor_io_contention_001').events
    const sid = 'rt-test-seek'
    runtimeContract.create_session('noisy_neighbor_io_contention_001', sid)
    for (const e of events) runtimeContract.append_event(sid, e)
    const mid = Math.floor(events.length / 2)
    const snap = runtimeContract.get_snapshot(sid, mid)
    expect(snap.events).toHaveLength(mid)
    expect(snap.session.last_sequence).toBe(mid)
    runtimeContract.reset()
  })

  it('subscribe_events 返回 after_sequence 之后的事件', () => {
    runtimeContract.reset()
    const events = replayCase('remote_replication_lag_001').events
    const sid = 'rt-test-sub'
    runtimeContract.create_session('remote_replication_lag_001', sid)
    for (const e of events) runtimeContract.append_event(sid, e)
    const after = 3
    const sub = runtimeContract.subscribe_events(sid, after)
    expect(sub.every((e) => e.sequence > after)).toBe(true)
    expect(sub[0]?.sequence).toBe(after + 1)
    runtimeContract.reset()
  })

  it('全部 Case 的 append 全量回放与 replayCase 语义等价（§16.4 确定性）', () => {
    for (const c of listCases()) {
      runtimeContract.reset()
      const events = replayCase(c.caseId).events
      const sid = `rt-all-${c.caseId}`
      runtimeContract.create_session(c.caseId, sid)
      for (const e of events) runtimeContract.append_event(sid, e)
      const viaContract = runtimeContract.get_snapshot(sid)
      const viaReplay = replayCase(c.caseId)
      expect(JSON.stringify(viaContract)).toBe(JSON.stringify(viaReplay))
      runtimeContract.reset()
    }
  })
})
