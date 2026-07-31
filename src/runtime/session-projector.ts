import type { DiagnosisSession, RuntimeEvent, Candidate, Evidence, Fact, Plan } from '../../schemas/types'
import { CandidateStatus, ConclusionType, DiagnosisPhase, EvidenceRelation, EventType, TaskStatus } from '../../schemas/enums'

/**
 * Session Projector — 确定性 Reducer
 * 纯函数：RuntimeEvent[] → DiagnosisSession
 * 同一事件序列始终得到完全相同的 Session 快照
 */

export function createEmptySession(caseId: string): DiagnosisSession {
  return {
    id: `session-projected-${Date.now()}`,
    caseId,
    status: DiagnosisPhase.SESSION_INITIALIZING,
    currentRound: 0,
    candidates: [],
    evidence: [],
    facts: [],
    plans: [],
    events: [],
    conclusion: null,
    rootCause: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function projectSession(events: RuntimeEvent[], caseId: string = 'unknown'): DiagnosisSession {
  const session = createEmptySession(caseId)

  for (const event of events) {
    session.events.push(event)

    switch (event.type) {
      case EventType.PLAN_CREATED: {
        const p = event.payload
        const plan: Plan = {
          id: p.planId,
          round: p.round,
          goal: p.goal,
          selectionReason: p.selectionReason,
          tasks: [],
          createdAt: event.timestamp,
        }
        session.plans.push(plan)
        session.currentRound = p.round
        session.status = DiagnosisPhase.DIAGNOSING
        break
      }

      case EventType.PLAN_REPLANNED: {
        // 重规划信息附加到 session events 已有记录
        // 前端可通过 PLAN_REPLANNED 事件类型过滤展示
        break
      }

      case EventType.TASK_SUBMITTED: {
        const p = event.payload
        const currentPlan = session.plans[session.plans.length - 1]
        if (currentPlan) {
          currentPlan.tasks.push({
            id: p.taskId,
            skillType: p.skillType,
            targetObjectIds: p.targetObjectIds || [],
            reason: p.reason || '',
            expectedEvidence: '',
            status: TaskStatus.RUNNING,
          })
        }
        break
      }

      case EventType.SKILL_COMPLETED: {
        const p = event.payload
        const currentPlan = session.plans[session.plans.length - 1]
        if (currentPlan) {
          const task = currentPlan.tasks[currentPlan.tasks.length - 1]
          if (task) {
            task.status = p.success ? TaskStatus.COMPLETED : TaskStatus.FAILED
          }
        }
        break
      }

      case EventType.FACT_CREATED: {
        const p = event.payload
        const fact: Fact = {
          id: p.factId,
          taskId: p.taskId,
          skillId: '',
          objectIds: [],
          rawResult: p.data,
          structuredData: p.data,
          timestamp: event.timestamp,
          source: `skill:${p.skillType}`,
        }
        session.facts.push(fact)
        break
      }

      case EventType.EVIDENCE_CREATED: {
        const p = event.payload
        const evidence: Evidence = {
          id: p.evidenceId,
          factId: p.factId,
          candidateId: '',
          candidateName: p.candidateName,
          relation: p.relation,
          explanation: p.explanation,
          weight: p.weight,
          timestamp: event.timestamp,
        }
        session.evidence.push(evidence)
        break
      }

      case EventType.CANDIDATE_UPDATED: {
        const p = event.payload
        const existing = session.candidates.find(c => c.id === p.candidateId)
        if (existing) {
          existing.supportScore = p.newScore
          existing.status = p.status
          if (p.triggerEvidenceId && !existing.evidenceIds.includes(p.triggerEvidenceId)) {
            existing.evidenceIds.push(p.triggerEvidenceId)
          }
          existing.updatedAt = event.timestamp
        } else {
          const candidate: Candidate = {
            id: p.candidateId,
            name: p.candidateName,
            description: '',
            supportScore: p.newScore,
            status: p.status,
            evidenceIds: p.triggerEvidenceId ? [p.triggerEvidenceId] : [],
            createdAt: event.timestamp,
            updatedAt: event.timestamp,
          }
          session.candidates.push(candidate)
        }
        break
      }

      case EventType.CONCLUSION_REACHED: {
        const p = event.payload
        session.conclusion = p.conclusion
        session.rootCause = p.rootCause
        session.status = DiagnosisPhase.DIAGNOSIS_REVIEW
        break
      }
    }

    session.updatedAt = event.timestamp
  }

  return session
}

/**
 * 投影到指定事件序号的历史快照（用于回放）
 */
export function projectUpToSeq(events: RuntimeEvent[], seq: number, caseId: string = 'unknown'): DiagnosisSession {
  const filtered = events.filter(e => e.seq <= seq)
  return projectSession(filtered, caseId)
}
