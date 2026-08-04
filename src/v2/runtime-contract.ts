/**
 * Runtime Contract —— 会话服务统一入口（docs/19 §16.4）。
 *
 * 将确定性的 DiagnosisRuntime（诊断编排器）包装为文档定义的会话接口：
 *   append_event(session_id, RuntimeEvent) → accepted_sequence
 *   get_snapshot(session_id, sequence?) → DiagnosisSessionSnapshot
 *   subscribe_events(session_id, after_sequence) → RuntimeEvent stream
 *
 * 语义（docs/19 §16.4 末行）：同一初始 Seed 与同一有序事件序列必须生成语义等价 Snapshot。
 * 本引擎事件流由 Adapter 确定性生成，append_event 校验入参事件与期望事件一致：
 * - 与下一个期望事件匹配 → 前进 live head，返回新的 accepted_sequence；
 * - 已是已应用事件（幂等，sequence ≤ live head）→ 返回当前 accepted_sequence，不二次应用；
 * - 不匹配（乱序/伪造/未知 session 外的 case）→ 抛 RT-* 错误，绝不静默跳过（§17.2）。
 *
 * 纯服务端侧：不生成领域数据，不改变既有 DiagnosisRuntime 行为。
 */

import { createDiagnosisRuntime, type DiagnosisRuntime } from './diagnosis-runtime'
import type { DiagnosisSessionSnapshot, RuntimeEvent } from './runtime-types'
import { caseExists } from './manifest'
import { errorCode, ErrorPrefix } from './error-codes'

/** 会话状态快照（§16.4 接口返回）。 */
export interface RuntimeSessionHandle {
  session_id: string
  case_id: string
  /** 已接受事件数（live head）。 */
  accepted_sequence: number
  snapshot: DiagnosisSessionSnapshot
  events: RuntimeEvent[]
}

export interface RuntimeContract {
  create_session(caseId: string, sessionId?: string): RuntimeSessionHandle
  append_event(sessionId: string, event: RuntimeEvent): number
  get_snapshot(sessionId: string, sequence?: number): DiagnosisSessionSnapshot
  subscribe_events(sessionId: string, afterSequence: number): RuntimeEvent[]
  /** 会话是否存在。 */
  has_session(sessionId: string): boolean
  /** 释放全部会话（只影响服务，不影响运行时实例）。 */
  reset(): void
}

class RuntimeContractImpl implements RuntimeContract {
  private readonly sessions = new Map<string, DiagnosisRuntime>()

  create_session(caseId: string, sessionId?: string): RuntimeSessionHandle {
    if (!caseExists(caseId)) {
      throw new Error(`${errorCode(ErrorPrefix.CKA_PKG, 1)} 未知 Case：${caseId}`)
    }
    const sid = sessionId ?? `session-${caseId}`
    if (this.sessions.has(sid)) {
      throw new Error(`${errorCode(ErrorPrefix.RT, 1)} 会话 ${sid} 已存在（create_session 幂等冲突）`)
    }
    const rt = createDiagnosisRuntime(caseId)
    this.sessions.set(sid, rt)
    return this.handle(sid)
  }

  append_event(sessionId: string, event: RuntimeEvent): number {
    const rt = this.require(sessionId)
    const next = rt.events[rt.liveHead]
    if (!next) {
      // 事件流已耗尽：重复提交已接受事件视为幂等成功。
      if (event.sequence <= rt.liveHead && rt.events[event.sequence - 1]?.event_id === event.event_id) {
        return rt.liveHead
      }
      throw new Error(`${errorCode(ErrorPrefix.RT, 2)} 会话 ${sessionId} 事件流已耗尽，收到多余事件 ${event.event_id}`)
    }
    if (event.sequence <= rt.liveHead) {
      // 幂等：已应用事件必须与已接受的完全一致，否则视为冲突。
      const applied = rt.events[event.sequence - 1]
      if (applied && applied.event_id === event.event_id && applied.event_type === event.event_type) {
        return rt.liveHead
      }
      throw new Error(
        `${errorCode(ErrorPrefix.RT, 3)} 事件 ${event.event_id} 与已接受序列 ${event.sequence} 冲突（期望 ${applied?.event_id ?? 'none'}）`,
      )
    }
    if (event.sequence !== next.sequence || event.event_id !== next.event_id) {
      throw new Error(
        `${errorCode(ErrorPrefix.RT, 4)} 事件乱序：期望 seq=${next.sequence} ${next.event_id}，收到 seq=${event.sequence} ${event.event_id}`,
      )
    }
    const advanced = rt.advance()
    this.sessions.set(sessionId, advanced)
    return advanced.liveHead
  }

  get_snapshot(sessionId: string, sequence?: number): DiagnosisSessionSnapshot {
    const rt = this.require(sessionId)
    if (sequence === undefined) return rt.liveSnapshot
    if (sequence === rt.cursor) return rt.snapshot
    return rt.seek(sequence).snapshot
  }

  subscribe_events(sessionId: string, afterSequence: number): RuntimeEvent[] {
    const rt = this.require(sessionId)
    return rt.events.filter((e) => e.sequence > afterSequence)
  }

  has_session(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  reset(): void {
    this.sessions.clear()
  }

  private require(sessionId: string): DiagnosisRuntime {
    const rt = this.sessions.get(sessionId)
    if (!rt) {
      throw new Error(`${errorCode(ErrorPrefix.RT, 5)} 未知会话 ${sessionId}`)
    }
    return rt
  }

  private handle(sessionId: string): RuntimeSessionHandle {
    const rt = this.require(sessionId)
    return {
      session_id: sessionId,
      case_id: rt.caseId,
      accepted_sequence: rt.liveHead,
      snapshot: rt.liveSnapshot,
      events: [...rt.events],
    }
  }
}

/** 运行时契约服务单例（轻量状态，可 reset）。 */
export const runtimeContract: RuntimeContract = new RuntimeContractImpl()
