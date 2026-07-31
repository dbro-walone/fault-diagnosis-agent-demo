import { ShieldCheck, ShieldAlert, ShieldQuestion, ArrowUpRight, ArrowDownRight } from 'lucide-react'

import type { Candidate, DiagnosisSession } from '../../schemas'
import { CandidateStatus, EvidenceRelation } from '../../schemas'
import { cn } from '@/lib/utils'

/**
 * CandidatePanel — 候选根因面板（右侧栏）
 *
 * Presentation only. Lists the Runtime-authored candidates sorted by support
 * score (highest first) and tallies how much evidence bears on each. It never
 * re-scores a candidate or invents one — every number comes from the
 * {@link DiagnosisSession} snapshot (铁律 #2/#3).
 *
 * Card color (semantic, 铁律色彩): confirmed → green, high score → blue,
 * rejected → gray, active → amber.
 */
export interface CandidatePanelProps {
  session: DiagnosisSession
  selectedCandidateId: string | null
  onSelectCandidate: (id: string | null) => void
}

type Tone = 'confirmed' | 'high' | 'active' | 'rejected'

/** Resolve a candidate's display tone from its Runtime status + score. */
function toneFor(c: Candidate): Tone {
  if (c.status === CandidateStatus.CONFIRMED) return 'confirmed'
  if (c.status === CandidateStatus.REJECTED || c.status === CandidateStatus.DEPLETED) return 'rejected'
  if (c.status === CandidateStatus.ACTIVE && c.supportScore >= 60) return 'high'
  return 'active'
}

const TONE_STYLE: Record<Tone, { ring: string; bar: string; badge: string; label: string }> = {
  confirmed: {
    ring: 'border-status-recovered/50 bg-status-recovered/[0.07]',
    bar: 'bg-status-recovered',
    badge: 'bg-status-recovered/15 text-status-recovered',
    label: '已确认',
  },
  high: {
    ring: 'border-status-active/40 bg-status-active/[0.06]',
    bar: 'bg-status-active',
    badge: 'bg-status-active/15 text-status-active',
    label: '高支持',
  },
  active: {
    ring: 'border-status-warning/35 bg-status-warning/[0.05]',
    bar: 'bg-status-warning',
    badge: 'bg-status-warning/15 text-status-warning',
    label: '待验证',
  },
  rejected: {
    ring: 'border-white/8 bg-white/[0.02]',
    bar: 'bg-status-muted',
    badge: 'bg-white/5 text-status-muted',
    label: '已排除',
  },
}

interface EvidenceTally {
  supports: number
  weakens: number
  conflicts: number
}

/** Tally evidence bearing on a candidate, grouped by relation. */
function tallyEvidence(session: DiagnosisSession, candidate: Candidate): EvidenceTally {
  const tally: EvidenceTally = { supports: 0, weakens: 0, conflicts: 0 }
  for (const ev of session.evidence) {
    if (ev.candidateName !== candidate.name) continue
    if (ev.relation === EvidenceRelation.SUPPORTS) tally.supports++
    else if (ev.relation === EvidenceRelation.WEAKENS) tally.weakens++
    else if (ev.relation === EvidenceRelation.CONFLICTS) tally.conflicts++
  }
  return tally
}

function StatusBadge({ status, tone }: { status: CandidateStatus; tone: Tone }) {
  const Icon =
    status === CandidateStatus.CONFIRMED
      ? ShieldCheck
      : status === CandidateStatus.REJECTED || status === CandidateStatus.DEPLETED
        ? ShieldAlert
        : ShieldQuestion
  return (
    <span className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', TONE_STYLE[tone].badge)}>
      <Icon className="h-3 w-3" />
      {TONE_STYLE[tone].label}
    </span>
  )
}

function EvidenceChip({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] tabular',
        count > 0 ? tone : 'bg-white/5 text-[#64748b]',
      )}
    >
      {label}
      <span className="font-medium">{count}</span>
    </span>
  )
}

function CandidateCard({
  candidate,
  rank,
  tally,
  selected,
  onSelect,
}: {
  candidate: Candidate
  rank: number
  tally: EvidenceTally
  selected: boolean
  onSelect: () => void
}) {
  const tone = toneFor(candidate)
  const style = TONE_STYLE[tone]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border p-2.5 text-left transition-all duration-150',
        style.ring,
        selected ? 'ring-1 ring-white/30' : 'hover:border-white/25',
      )}
    >
      {/* Header: rank + name + status */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[10px] font-semibold tabular text-[#64748b]">
          {String(rank).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                'text-[12px] font-medium leading-tight',
                tone === 'rejected' ? 'text-[#64748b] line-through' : 'text-[#e2e8f0]',
              )}
              title={candidate.name}
            >
              {candidate.name}
            </span>
            <StatusBadge status={candidate.status} tone={tone} />
          </div>
          {candidate.description && tone !== 'rejected' && (
            <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-[#64748b]">
              {candidate.description}
            </p>
          )}
        </div>
      </div>

      {/* Score bar (0-100, no '%' by design) */}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
          <div
            className={cn('h-full rounded-full transition-all duration-500', style.bar)}
            style={{ width: `${candidate.supportScore}%` }}
          />
        </div>
        <span className="flex items-center gap-0.5 text-[11px] font-semibold tabular text-[#cbd5e1]">
          {tally.supports >= tally.weakens ? (
            <ArrowUpRight className="h-3 w-3 text-status-evidence" />
          ) : (
            <ArrowDownRight className="h-3 w-3 text-status-warning" />
          )}
          {candidate.supportScore}
        </span>
      </div>

      {/* Evidence tally */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <EvidenceChip label="支持" count={tally.supports} tone="bg-status-evidence/15 text-status-evidence" />
        <EvidenceChip label="削弱" count={tally.weakens} tone="bg-status-warning/15 text-status-warning" />
        <EvidenceChip label="冲突" count={tally.conflicts} tone="bg-status-fault/15 text-status-fault" />
      </div>
    </button>
  )
}

export default function CandidatePanel({
  session,
  selectedCandidateId,
  onSelectCandidate,
}: CandidatePanelProps) {
  const ranked = [...session.candidates].sort((a, b) => b.supportScore - a.supportScore)

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-white/8 bg-[#11141c]/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-status-evidence" />
          <span className="text-[12px] font-semibold text-[#e2e8f0]">候选根因</span>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] tabular text-[#64748b]">
          {session.candidates.length} 项
        </span>
      </div>

      {/* List */}
      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 py-2.5">
        {ranked.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="h-2 w-2 animate-pulse rounded-full bg-status-active" />
            <p className="text-[11px] text-[#64748b]">尚未生成候选根因</p>
            <p className="text-[10px] text-[#475569]">诊断推进后，候选将随证据更新</p>
          </div>
        ) : (
          ranked.map((c, i) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              rank={i + 1}
              tally={tallyEvidence(session, c)}
              selected={selectedCandidateId === c.id}
              onSelect={() =>
                onSelectCandidate(selectedCandidateId === c.id ? null : c.id)
              }
            />
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t border-white/8 px-3 py-2 text-[10px] text-[#475569]">
        支持分 0–100，由 Runtime 证据更新驱动
      </div>
    </aside>
  )
}
