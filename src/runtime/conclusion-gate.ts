import type { DiagnosisSession } from '../../schemas/types'
import { CandidateStatus, ConclusionType, EvidenceRelation } from '../../schemas/enums'

export interface ConclusionResult {
  type: ConclusionType
  rootCause: string | null
  rootCandidateId: string | null
  reason: string
  evidenceChainCount: number
}

export function checkConclusion(session: DiagnosisSession): ConclusionResult {
  const confirmed = session.candidates.filter(c => c.status === CandidateStatus.CONFIRMED)

  if (confirmed.length === 0) {
    const highScore = session.candidates
      .filter(c => c.status === CandidateStatus.ACTIVE)
      .sort((a, b) => b.supportScore - a.supportScore)
    if (highScore.length > 0 && highScore[0].supportScore >= 50) {
      return { type: ConclusionType.PROBABLE_CAUSES, rootCause: highScore[0].name, rootCandidateId: highScore[0].id, reason: `领先候选分数较高但证据链不完整`, evidenceChainCount: highScore[0].evidenceIds.length }
    }
    return { type: ConclusionType.INSUFFICIENT_EVIDENCE, rootCause: null, rootCandidateId: null, reason: '现有证据不足以确认任何根因候选', evidenceChainCount: 0 }
  }

  const root = confirmed.sort((a, b) => b.supportScore - a.supportScore)[0]
  const supportingEvidence = session.evidence.filter(e => e.candidateName === root.name && e.relation === EvidenceRelation.SUPPORTS)
  const minChainPassed = supportingEvidence.length >= 3
  const competitors = session.candidates.filter(c => c.id !== root.id && c.status === CandidateStatus.ACTIVE && c.supportScore >= 50)
  const competitionPassed = competitors.length === 0

  if (minChainPassed && competitionPassed) {
    return { type: ConclusionType.ROOT_CAUSE_CONFIRMED, rootCause: root.name, rootCandidateId: root.id, reason: `根因"${root.name}"已通过最小证据链(${supportingEvidence.length}条)、竞争候选检查和冲突消解`, evidenceChainCount: supportingEvidence.length }
  }
  return { type: ConclusionType.PROBABLE_CAUSES, rootCause: root.name, rootCandidateId: root.id, reason: `候选分数达标但${!minChainPassed ? '证据链不完整' : '存在竞争候选'}`, evidenceChainCount: supportingEvidence.length }
}
