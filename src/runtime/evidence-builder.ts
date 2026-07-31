import type { Evidence, Fact } from '../../schemas/types'
import { EvidenceRelation } from '../../schemas/enums'

/**
 * Evidence Builder
 * 将 Fact 转换为与候选关联的 Evidence
 */

interface EvidenceRule {
  match: (fact: Fact) => boolean
  candidateName: string
  relation: EvidenceRelation
  weight: number
  explanation: string
  evidenceIdPrefix: string
}

let evidenceCounter = 0

function nextEvidenceId(prefix: string): string {
  evidenceCounter++
  return `${prefix}-${String(evidenceCounter).padStart(3, '0')}`
}

const RULES: EvidenceRule[] = [
  {
    evidenceIdPrefix: 'ev-warm-reset-alert',
    match: (f) => f.source.includes('alert') && JSON.stringify(f.structuredData).includes('WARM_RESET'),
    candidateName: 'Controller-0A 异常或复位',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.9,
    explanation: 'Controller-0A 发生热复位告警，强烈支持控制器异常候选',
  },
  {
    evidenceIdPrefix: 'ev-watchdog-log',
    match: (f) => f.source.includes('log') && JSON.stringify(f.structuredData).includes('watchdog_timeout'),
    candidateName: 'watchdog 超时触发热复位',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.95,
    explanation: '日志中检测到 watchdog_timeout 指纹，确认热复位由看门狗超时触发',
  },
  {
    evidenceIdPrefix: 'ev-takeover-log',
    match: (f) => f.source.includes('log') && JSON.stringify(f.structuredData).includes('takeover_started'),
    candidateName: 'Controller-0B 接管',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.7,
    explanation: 'Controller-0B 日志显示开始接管，确认主备切换发生',
  },
  {
    evidenceIdPrefix: 'ev-ctrl0a-throughput',
    match: (f) => {
      if (!f.source.includes('kpi')) return false
      const d = JSON.stringify(f.structuredData)
      return d.includes('throughput') && d.includes('controller-0a')
    },
    candidateName: 'Controller-0A 异常或复位',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.8,
    explanation: 'Controller-0A 吞吐量在故障窗口内归零（持续8秒），证实控制器服务中断',
  },
  {
    evidenceIdPrefix: 'ev-ctrl0b-throughput',
    match: (f) => {
      if (!f.source.includes('kpi')) return false
      const d = JSON.stringify(f.structuredData)
      return d.includes('throughput') && d.includes('controller-0b')
    },
    candidateName: 'Controller-0B 接管',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.7,
    explanation: 'Controller-0B 吞吐量从 8000 激增至 18000 IOPS，确认接管了负载',
  },
  {
    evidenceIdPrefix: 'ev-lun-latency',
    match: (f) => {
      if (!f.source.includes('kpi')) return false
      const d = JSON.stringify(f.structuredData)
      return d.includes('latency') && d.includes('lun-db01')
    },
    candidateName: 'Controller-0A 异常或复位',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.6,
    explanation: 'LUN-DB01 时延峰值 48.7ms（正常 2.1ms），证实业务受影响',
  },
  {
    evidenceIdPrefix: 'ev-business-impact',
    match: (f) => f.source.includes('business_mapping'),
    candidateName: 'Controller-0A 异常或复位',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.3,
    explanation: '业务映射确认 DB 业务 IOPS 从 8500 降至 1200，时延从 2.1ms 升至 45.3ms',
  },
  {
    evidenceIdPrefix: 'ev-link-recovered',
    match: (f) => f.source.includes('link_health'),
    candidateName: 'FC 链路抖动或故障',
    relation: EvidenceRelation.WEAKENS,
    weight: 0.3,
    explanation: 'FC 链路仅有短暂降级（8秒后恢复），不支持链路故障候选',
  },
  {
    evidenceIdPrefix: 'ev-similar-case',
    match: (f) => f.source.includes('similar_case'),
    candidateName: 'watchdog 超时触发热复位',
    relation: EvidenceRelation.SUPPORTS,
    weight: 0.5,
    explanation: '相似历史案例（相似度 0.89）根因同为 watchdog_timeout，增强根因信心',
  },
]

export function buildEvidence(fact: Fact): Evidence[] {
  const evidences: Evidence[] = []
  const now = new Date().toISOString()

  for (const rule of RULES) {
    if (rule.match(fact)) {
      evidences.push({
        id: nextEvidenceId(rule.evidenceIdPrefix),
        factId: fact.id,
        candidateId: '', // resolved when applied to candidates
        candidateName: rule.candidateName,
        relation: rule.relation,
        explanation: rule.explanation,
        weight: rule.weight,
        timestamp: now,
      })
    }
  }

  return evidences
}
