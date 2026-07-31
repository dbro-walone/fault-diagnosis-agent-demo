import {
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import {
  CandidateStatus,
  OntologyObjectType,
  type DiagnosisSession,
  type OntologyObject,
} from '../../schemas'
import { cn } from '@/lib/utils'

function score(candidate: OntologyObject): number {
  return Number(candidate.properties.supportScore ?? 0)
}

function status(candidate: OntologyObject): CandidateStatus {
  return candidate.properties.status as CandidateStatus
}

function stringArray(candidate: OntologyObject, key: string): string[] {
  const value = candidate.properties[key]
  return Array.isArray(value) ? value.map(String) : []
}

export default function CandidatePanel({
  session,
  selectedCandidateId,
  onSelectCandidate,
}: {
  session: DiagnosisSession
  selectedCandidateId: string | null
  onSelectCandidate: (id: string | null) => void
}) {
  const candidates = session.overlay.objects
    .filter((object) => object.type === OntologyObjectType.CANDIDATE)
    .sort((a, b) => score(b) - score(a))

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-[#11141c]/96 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-status-evidence" />
          <span className="text-[12px] font-semibold">Candidate Object Set</span>
        </div>
        <span className="rounded bg-white/5 px-2 py-0.5 text-[9px] text-[#64748b]">
          {candidates.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {candidates.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[10px] text-[#64748b]">
            范围定位完成后，Runtime 才会生成 Candidate 对象
          </div>
        ) : (
          candidates.map((candidate, index) => {
            const candidateStatus = status(candidate)
            const confirmed = candidateStatus === CandidateStatus.CONFIRMED
            const weakened = candidateStatus === CandidateStatus.WEAKENED
            const evidenceIds = stringArray(candidate, 'evidenceIds')
            const missing = stringArray(candidate, 'missingEvidence')
            const selected = selectedCandidateId === candidate.id
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onSelectCandidate(selected ? null : candidate.id)}
                className={cn(
                  'w-full rounded-lg border p-2.5 text-left transition-colors',
                  confirmed
                    ? 'border-status-recovered/40 bg-status-recovered/[0.06]'
                    : weakened
                      ? 'border-white/8 bg-white/[0.02] opacity-70'
                      : 'border-status-warning/25 bg-status-warning/[0.04]',
                  selected && 'ring-1 ring-white/30',
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-[9px] tabular text-[#475569]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-medium leading-snug">
                        {candidate.label}
                      </span>
                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[8px]',
                          confirmed
                            ? 'bg-status-recovered/15 text-status-recovered'
                            : weakened
                              ? 'bg-white/5 text-[#64748b]'
                              : 'bg-status-warning/15 text-status-warning',
                        )}
                      >
                        {confirmed ? (
                          <ShieldCheck className="h-3 w-3" />
                        ) : (
                          <ShieldQuestion className="h-3 w-3" />
                        )}
                        {candidateStatus}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            confirmed
                              ? 'bg-status-recovered'
                              : weakened
                                ? 'bg-status-muted'
                                : 'bg-status-warning',
                          )}
                          style={{ width: `${score(candidate)}%` }}
                        />
                      </div>
                      <span className="flex items-center text-[11px] font-semibold tabular">
                        {weakened ? (
                          <ArrowDownRight className="h-3 w-3 text-status-warning" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3 text-status-evidence" />
                        )}
                        {score(candidate)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[8px]">
                      <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-status-evidence">
                        证据 {evidenceIds.length}
                      </span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5',
                          missing.length
                            ? 'bg-status-warning/10 text-status-warning'
                            : 'bg-status-recovered/10 text-status-recovered',
                        )}
                      >
                        {missing.length ? `缺口 ${missing.length}` : '证据链完整'}
                      </span>
                    </div>
                    {selected && missing.length > 0 && (
                      <p className="mt-2 text-[9px] leading-relaxed text-[#94a3b8]">
                        待补齐：{missing.join('、')}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
      <div className="border-t border-white/8 px-3 py-2 text-[9px] text-[#475569]">
        支持分是 Runtime 事件属性，不是概率，也不由前端计算
      </div>
    </aside>
  )
}
