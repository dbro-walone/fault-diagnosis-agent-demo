/**
 * Runtime Replay Validator（docs/19 §17.1）—— 事件顺序、幂等、快照一致性和历史回放。
 *
 * 检查项（RT-*，docs/19 §17.2）：
 *   RT-001  事件序列从 1 开始、无缺口、严格递增；
 *   RT-002  event_id 单会话唯一；
 *   RT-003  reducer 幂等：已应用事件重复 apply 不改变快照；
 *   RT-004  快照一致性：replayToSequence(n) 与逐事件 apply 折叠等价；
 *   RT-005  历史回放只读：seek 到中途不得出现未来证据/结论；
 *   RT-006  终态快照与 DIAGNOSIS_COMPLETED 一致（last_sequence 对齐）。
 *
 * 注意：DiagnosisRuntime 是不可变实例，advance() 返回新实例——必须 `rt = rt.advance()`
 * 推进，否则 liveHead 恒为 0、complete 恒为 false（死循环）。
 */

import type { DiagnosisSessionSnapshot, RuntimeEvent } from '../runtime-types'
import { createDiagnosisRuntime, replayCase } from '../diagnosis-runtime'
import { replayToSequence, applyEvent } from '../event-reducer'
import { errorCode, ErrorPrefix } from '../error-codes'
import type { ValidatorResult } from './validator-types'

export function validateRuntimeReplay(caseId: string): ValidatorResult {
  const issues: ValidatorResult['issues'] = []
  const add = (code: string, message: string, severity: 'ERROR' | 'WARN' = 'ERROR') =>
    issues.push({ code, severity, validator: 'RUNTIME_REPLAY', message })

  let rt = createDiagnosisRuntime(caseId)
  while (!rt.complete) rt = rt.advance()
  const events: RuntimeEvent[] = rt.events
  const full = rt.liveSnapshot

  // RT-001 序列从 1 开始、无缺口、严格递增。
  const seqs = events.map((e) => e.sequence)
  if (seqs[0] !== 1 || seqs.some((s, i) => i > 0 && s !== seqs[i - 1] + 1)) {
    add(errorCode(ErrorPrefix.RT, 1), `事件序列非连续递增（首=${seqs[0]}，共${seqs.length}）`)
  }

  // RT-002 event_id 唯一。
  const ids = new Set<string>()
  for (const e of events) {
    if (ids.has(e.event_id)) add(errorCode(ErrorPrefix.RT, 2), `event_id 重复：${e.event_id}`)
    ids.add(e.event_id)
  }

  // RT-003 reducer 幂等：对某个已应用的快照重复应用其最后一个事件，快照不变。
  if (events.length > 0) {
    const snapN = replayToSequence(events, events.length, rt.sessionId, caseId)
    const last = events[events.length - 1]
    const snapAgain = applyEvent(snapN, last)
    if (JSON.stringify(snapN) !== JSON.stringify(snapAgain)) {
      add(errorCode(ErrorPrefix.RT, 3), '重复应用已应用事件改变快照（幂等性破坏）')
    }
  }

  // RT-004 快照一致性：replayToSequence(n) 与逐事件折叠等价（抽样 4 个游标）。
  // 折叠从空快照开始、对每个 sequence ≤ n 的事件 applyEvent —— 注意首事件必须实际 apply。
  const probes = [0, Math.floor(events.length / 4), Math.floor(events.length / 2), events.length]
  for (const n of probes) {
    const viaReplay = replayToSequence(events, n, rt.sessionId, caseId)
    let acc: DiagnosisSessionSnapshot = replayToSequence(events, 0, rt.sessionId, caseId)
    for (const e of events) {
      if (e.sequence > n) break
      acc = applyEvent(acc, e)
    }
    if (JSON.stringify(viaReplay) !== JSON.stringify(acc)) {
      add(errorCode(ErrorPrefix.RT, 4), `游标 ${n} 回放与逐事件折叠快照不一致`)
      break
    }
  }

  // RT-005 历史回放只读：seek 到中游不得出现未来证据/结论。
  if (events.length >= 2) {
    const mid = Math.floor(events.length / 2)
    const replayed = rt.seek(mid)
    const snap = replayed.snapshot
    if (snap.conclusion) {
      add(errorCode(ErrorPrefix.RT, 5), `回放游标 ${mid} 已出现结论（历史回放泄露未来）`)
    }
    if (snap.events.length !== mid) {
      add(errorCode(ErrorPrefix.RT, 5), `回放游标 ${mid} 事件数=${snap.events.length}，应为 ${mid}`)
    }
  }

  // RT-006 终态快照与 DIAGNOSIS_COMPLETED 对齐。
  const completed = events.find((e) => e.event_type === 'DIAGNOSIS_COMPLETED')
  if (!completed) {
    add(errorCode(ErrorPrefix.RT, 6), '事件流缺少 DIAGNOSIS_COMPLETED')
  } else if (full.session.last_sequence !== completed.sequence) {
    add(errorCode(ErrorPrefix.RT, 6), `last_sequence=${full.session.last_sequence} 与 DIAGNOSIS_COMPLETED(${completed.sequence}) 不一致`)
  }
  if (full.events.length !== events.length) {
    add(errorCode(ErrorPrefix.RT, 6), `终态快照事件数=${full.events.length}，作者事件流=${events.length}`)
  }

  return { validator: 'RUNTIME_REPLAY', label: `Runtime Replay · ${caseId}`, issues, ok: issues.every((i) => i.severity !== 'ERROR') }
}

/** 同一 Case 的事件流必须每次生成完全一致（确定性）。 */
export function validateDeterministicStream(caseId: string): ValidatorResult {
  const issues: ValidatorResult['issues'] = []
  const add = (code: string, message: string) =>
    issues.push({ code, severity: 'ERROR', validator: 'RUNTIME_REPLAY', message })
  const a = replayCase(caseId).events
  const b = replayCase(caseId).events
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    add(errorCode(ErrorPrefix.RT, 7), '同一 Case 两次回放事件流不一致（确定性破坏）')
  }
  return { validator: 'RUNTIME_REPLAY', label: `Runtime Determinism · ${caseId}`, issues, ok: issues.length === 0 }
}
