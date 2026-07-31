import type { Candidate, Evidence } from '../../schemas/types'
import { CandidateStatus, EvidenceRelation } from '../../schemas/enums'

/**
 * Candidate Manager
 * 管理候选根因的生成、分数更新和状态转换
 */

export function createInitialCandidates(): Candidate[] {
  const now = new Date().toISOString()
  return [
    { id: 'cand-001', name: 'Controller-0A 异常或复位', description: 'Controller-0A 发生异常导致服务中断，可能由热复位或硬件故障引起', supportScore: 20, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now },
    { id: 'cand-002', name: 'FC 链路抖动或故障', description: 'FC 交换机或链路出现抖动、丢包或短暂中断', supportScore: 15, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now },
    { id: 'cand-003', name: '存储池容量或性能问题', description: '存储池资源不足或性能瓶颈导致 IOPS 下降', supportScore: 10, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now },
    { id: 'cand-004', name: 'LUN 层异常', description: 'LUN 级别出现元数据不一致或 I/O 异常', supportScore: 12, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now },
    { id: 'cand-005', name: '主机侧 HBA 或链路问题', description: '数据库主机的 HBA 卡或多路径软件异常', supportScore: 8, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now },
  ]
}

export function createWatchdogCandidate(): Candidate {
  const now = new Date().toISOString()
  return { id: 'cand-006', name: 'watchdog 超时触发热复位', description: 'Controller-0A 的 watchdog 定时器超时，触发热复位导致服务中断', supportScore: 25, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now }
}

export function createTakeoverCandidate(): Candidate {
  const now = new Date().toISOString()
  return { id: 'cand-007', name: 'Controller-0B 接管', description: 'Controller-0B 在 Controller-0A 热复位后接管其负载', supportScore: 20, status: CandidateStatus.ACTIVE, evidenceIds: [], createdAt: now, updatedAt: now }
}

export function applyEvidenceToCandidates(
  candidates: Candidate[],
  evidence: Evidence,
): Candidate[] {
  return candidates.map((c) => {
    if (c.name !== evidence.candidateName) return c

    const scoreDelta = Math.round(evidence.weight * 40)
    let newScore = c.supportScore

    if (evidence.relation === EvidenceRelation.SUPPORTS) {
      newScore = Math.min(100, c.supportScore + scoreDelta)
    } else if (evidence.relation === EvidenceRelation.WEAKENS) {
      newScore = Math.max(0, c.supportScore - scoreDelta)
    }

    const newEvidenceIds = c.evidenceIds.concat(evidence.id)
    let newStatus = c.status
    if (newScore >= 85 && newEvidenceIds.length >= 3) {
      newStatus = CandidateStatus.CONFIRMED
    } else if (newScore <= 5) {
      newStatus = CandidateStatus.REJECTED
    }

    return { ...c, supportScore: newScore, status: newStatus, evidenceIds: newEvidenceIds, updatedAt: new Date().toISOString() }
  })
}
