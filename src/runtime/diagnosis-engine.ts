import type { Candidate, DiagnosisSession, Evidence, Fact, Plan, RuntimeEvent, PlanTask } from '../../schemas/types'
import { CandidateStatus, DiagnosisPhase, EventType, TaskStatus } from '../../schemas/enums'
import { getRoundPlan, TOTAL_ROUNDS, type RoundResult } from './planner'
import { MockSkillExecutor } from './skill-executor'
import { buildEvidence } from './evidence-builder'
import { createInitialCandidates, createWatchdogCandidate, createTakeoverCandidate, applyEvidenceToCandidates } from './candidate-manager'
import { checkConclusion, type ConclusionResult } from './conclusion-gate'

/**
 * Diagnosis Engine — 诊断引擎编排器
 * 驱动 Planner→Skill→Fact→Evidence→Candidate→Replan 全流程
 * 生成 RuntimeEvent 序列，支持逐步回放
 */

let eventSeqCounter = 0
let factIdCounter = 0

function nextEventId(): string {
  return `event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function nextFactId(): string {
  factIdCounter++
  return `fact-${String(factIdCounter).padStart(3, '0')}`
}

function makeEvent(type: EventType, payload: Record<string, unknown>): RuntimeEvent {
  eventSeqCounter++
  return { id: nextEventId(), seq: eventSeqCounter, type, timestamp: new Date().toISOString(), payload }
}

export interface EngineStep {
  events: RuntimeEvent[]
  sessionSnapshot: DiagnosisSession
  isTerminal: boolean
}

export interface DiagnosisEngine {
  session: DiagnosisSession
  events: RuntimeEvent[]
  currentRound: number
  skillExecutor: MockSkillExecutor
  candidates: Candidate[]
  hasWatchdogCandidate: boolean
  hasTakeoverCandidate: boolean
}

export function createDiagnosisEngine(caseId: string, observations: Record<string, unknown>): DiagnosisEngine {
  eventSeqCounter = 0
  factIdCounter = 0

  const session: DiagnosisSession = {
    id: `session-${Date.now()}`,
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

  return {
    session,
    events: [],
    currentRound: 0,
    skillExecutor: new MockSkillExecutor(observations as any),
    candidates: [],
    hasWatchdogCandidate: false,
    hasTakeoverCandidate: false,
  }
}

/**
 * 执行一轮诊断，返回该轮产生的事件
 */
export function runRound(engine: EngineContext): RuntimeEvent[] {
  const roundEvents: RuntimeEvent[] = []
  engine.currentRound++

  if (engine.currentRound > TOTAL_ROUNDS) {
    return roundEvents
  }

  const roundResult = getRoundPlan(engine.currentRound)
  if (!roundResult) return roundEvents

  // 终态轮
  if (roundResult.isTerminal) {
    const conclusion = checkConclusion(engine.session)
    engine.session.conclusion = conclusion.type
    engine.session.rootCause = conclusion.rootCause
    engine.session.status = DiagnosisPhase.DIAGNOSIS_REVIEW
    roundEvents.push(makeEvent(EventType.CONCLUSION_REACHED, {
      conclusion: conclusion.type,
      rootCause: conclusion.rootCause,
      rootCandidateId: conclusion.rootCandidateId,
      reason: conclusion.reason,
      evidenceChainCount: conclusion.evidenceChainCount,
    }))
    return roundEvents
  }

  const plan = roundResult.plan

  // 重规划事件
  if (roundResult.isReplan) {
    roundEvents.push(makeEvent(EventType.PLAN_REPLANNED, {
      oldRound: engine.currentRound - 1,
      newRound: engine.currentRound,
      triggerEvidenceId: roundResult.triggerEvidenceId,
      changes: roundResult.replanChanges,
      newGoal: plan.goal,
      newSelectionReason: plan.selectionReason,
    }))
  }

  // 计划创建事件
  roundEvents.push(makeEvent(EventType.PLAN_CREATED, {
    planId: plan.id,
    round: plan.round,
    goal: plan.goal,
    selectionReason: plan.selectionReason,
    taskCount: plan.tasks.length,
    isReplan: roundResult.isReplan || false,
  }))

  engine.session.plans.push(plan)
  engine.session.currentRound = engine.currentRound

  // 执行每个 Task
  for (const task of plan.tasks) {
    // TASK_SUBMITTED
    task.status = TaskStatus.RUNNING
    roundEvents.push(makeEvent(EventType.TASK_SUBMITTED, {
      taskId: task.id, skillType: task.skillType, targetObjectIds: task.targetObjectIds, reason: task.reason,
    }))

    // SKILL_STARTED
    roundEvents.push(makeEvent(EventType.SKILL_STARTED, {
      taskId: task.id, skillType: task.skillType,
    }))

    // 执行 Skill
    const skillResult = engine.skillExecutor.execute(task)

    // SKILL_COMPLETED
    task.status = skillResult.success ? TaskStatus.COMPLETED : TaskStatus.FAILED
    roundEvents.push(makeEvent(EventType.SKILL_COMPLETED, {
      taskId: task.id, skillType: task.skillType, success: skillResult.success, skillId: skillResult.skillId,
    }))

    if (!skillResult.success) continue

    // FACT_CREATED
    const fact: Fact = {
      id: nextFactId(),
      taskId: task.id,
      skillId: skillResult.skillId,
      objectIds: task.targetObjectIds,
      rawResult: skillResult.data,
      structuredData: skillResult.data,
      timestamp: new Date().toISOString(),
      source: `mock-skill:${task.skillType}`,
    }
    engine.session.facts.push(fact)
    roundEvents.push(makeEvent(EventType.FACT_CREATED, {
      factId: fact.id, taskId: task.id, skillType: task.skillType, data: skillResult.data,
    }))

    // 按需创建隐藏候选
    if (!engine.hasWatchdogCandidate && task.skillType === 'log') {
      const watchdog = createWatchdogCandidate()
      engine.candidates.push(watchdog)
      engine.session.candidates.push(watchdog)
      engine.hasWatchdogCandidate = true
    }
    if (!engine.hasTakeoverCandidate && task.skillType === 'log') {
      const takeover = createTakeoverCandidate()
      engine.candidates.push(takeover)
      engine.session.candidates.push(takeover)
      engine.hasTakeoverCandidate = true
    }

    // EVIDENCE_CREATED
    const evidences = buildEvidence(fact)
    for (const ev of evidences) {
      engine.session.evidence.push(ev)
      roundEvents.push(makeEvent(EventType.EVIDENCE_CREATED, {
        evidenceId: ev.id, factId: fact.id, candidateName: ev.candidateName, relation: ev.relation, weight: ev.weight, explanation: ev.explanation,
      }))

      // CANDIDATE_UPDATED
      const prevScores: Record<string, number> = {}
      engine.session.candidates.forEach(c => { prevScores[c.id] = c.supportScore })

      engine.session.candidates = applyEvidenceToCandidates(engine.session.candidates, ev)

      // 为每个分数变化的候选发出 CANDIDATE_UPDATED 事件
      engine.session.candidates.forEach(c => {
        if (c.supportScore !== prevScores[c.id]) {
          const delta = c.supportScore - prevScores[c.id]
          roundEvents.push(makeEvent(EventType.CANDIDATE_UPDATED, {
            candidateId: c.id, candidateName: c.name, oldScore: prevScores[c.id], newScore: c.supportScore, delta,
            status: c.status, triggerEvidenceId: ev.id,
          }))
        }
      })
    }
  }

  // 第二轮后生成初始候选
  if (roundResult.generateCandidates && engine.candidates.length === 0) {
    const initials = createInitialCandidates()
    engine.candidates.push(...initials)
    engine.session.candidates.push(...initials)
    for (const c of initials) {
      roundEvents.push(makeEvent(EventType.CANDIDATE_UPDATED, {
        candidateId: c.id, candidateName: c.name, oldScore: 0, newScore: c.supportScore, delta: c.supportScore,
        status: c.status, triggerEvidenceId: null,
      }))
    }
  }

  // 更新 session 状态
  engine.session.status = DiagnosisPhase.DIAGNOSING
  engine.session.updatedAt = new Date().toISOString()

  // 累积事件
  engine.events.push(...roundEvents)
  engine.session.events = [...engine.events]

  return roundEvents
}

// 使用可变上下文对象
export interface EngineContext {
  session: DiagnosisSession
  events: RuntimeEvent[]
  currentRound: number
  skillExecutor: MockSkillExecutor
  candidates: Candidate[]
  hasWatchdogCandidate: boolean
  hasTakeoverCandidate: boolean
}

export function createContextFromEngine(engine: DiagnosisEngine): EngineContext {
  return {
    session: engine.session,
    events: engine.events,
    currentRound: engine.currentRound,
    skillExecutor: engine.skillExecutor,
    candidates: engine.candidates,
    hasWatchdogCandidate: engine.hasWatchdogCandidate,
    hasTakeoverCandidate: engine.hasTakeoverCandidate,
  }
}

/**
 * 运行全部轮次，返回所有事件和最终 Session
 */
export function runAllRounds(caseId: string, observations: Record<string, unknown>): { events: RuntimeEvent[], session: DiagnosisSession } {
  const engine = createDiagnosisEngine(caseId, observations)
  const ctx = createContextFromEngine(engine)

  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    runRound(ctx)
  }

  return { events: ctx.events, session: ctx.session }
}
