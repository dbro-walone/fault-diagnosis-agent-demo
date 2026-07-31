import { Activity, Target, Trophy, X, Gauge } from 'lucide-react'

import type { DiagnosisSession } from '../../schemas'
import { CandidateStatus, ConclusionType } from '../../schemas'
import { cn } from '@/lib/utils'

/**
 * DiagnosisStatusBar — 诊断状态条
 *
 * A presentation-only top bar for the active diagnosis workspace. Every value
 * it renders is read straight from the Runtime-built {@link DiagnosisSession}
 * snapshot; it computes nothing the Runtime owns (铁律 #2 — no score / candidate
 * / root-cause derivation). It only *reads* the leading candidate (max support
 * score) and the current plan goal for display.
 */
export interface DiagnosisStatusBarProps {
  session: DiagnosisSession
  /** Coarse UI phase label (e.g. "诊断推演" / "诊断结论"). */
  phase: string
  /** Total diagnostic rounds the engine will run (progress denominator). */
  totalRounds: number
  /** Exit the diagnosis workspace and return to model exploration. */
  onExit?: () => void
}

/** Map a session status / conclusion to a human-readable verdict label. */
function conclusionLabel(session: DiagnosisSession): { text: string; tone: string } | null {
  if (!session.conclusion) return null
  switch (session.conclusion) {
    case ConclusionType.ROOT_CAUSE_CONFIRMED:
      return { text: '根因确认', tone: 'text-status-recovered' }
    case ConclusionType.PROBABLE_CAUSES:
      return { text: '可能根因', tone: 'text-status-warning' }
    case ConclusionType.INSUFFICIENT_EVIDENCE:
      return { text: '证据不足', tone: 'text-status-muted' }
    default:
      return { text: '已结束', tone: 'text-status-muted' }
  }
}

export default function DiagnosisStatusBar({
  session,
  phase,
  totalRounds,
  onExit,
}: DiagnosisStatusBarProps) {
  // Current round + the goal of the most recent plan (Runtime-authored).
  const currentRound = session.currentRound
  const lastPlan = session.plans[session.plans.length - 1]
  const goal = lastPlan?.goal ?? '准备开始诊断'

  // Leading candidate = highest support score (display sort only).
  const leader = [...session.candidates].sort(
    (a, b) => b.supportScore - a.supportScore,
  )[0]

  const progress = totalRounds > 0 ? Math.min(100, (currentRound / totalRounds) * 100) : 0
  const verdict = conclusionLabel(session)
  const concluded = session.conclusion !== null

  return (
    <div className="flex h-full w-full items-center gap-4 overflow-hidden border-b border-white/8 bg-[#11141c]/95 px-4 py-2 backdrop-blur-md">
      {/* Phase + round */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-status-active/15">
          <Activity className="h-3.5 w-3.5 text-status-active" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#e2e8f0]">
            {phase}
            {concluded && verdict && (
              <span className={cn('rounded bg-white/5 px-1.5 py-px text-[10px]', verdict.tone)}>
                {verdict.text}
              </span>
            )}
          </div>
          <div className="text-[10px] text-[#64748b]">
            第 {currentRound} / {totalRounds} 轮
          </div>
        </div>
      </div>

      <span className="h-8 w-px shrink-0 bg-white/10" />

      {/* Current goal */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Target className="h-3.5 w-3.5 shrink-0 text-status-active" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-[#64748b]">本轮目标</div>
          <div className="truncate text-[12px] text-[#cbd5e1]" title={goal}>
            {goal}
          </div>
        </div>
      </div>

      <span className="h-8 w-px shrink-0 bg-white/10" />

      {/* Leading candidate */}
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        {leader ? (
          <>
            <Gauge className="h-3.5 w-3.5 shrink-0 text-status-evidence" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-[#64748b]">领先候选</div>
              <div className="truncate text-[12px] text-[#e2e8f0]" title={leader.name}>
                {leader.name}
                <span className="ml-1 tabular text-status-evidence">{leader.supportScore}</span>
              </div>
            </div>
            {/* mini score bar (0-100, no '%' by design) */}
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  leader.status === CandidateStatus.CONFIRMED
                    ? 'bg-status-recovered'
                    : leader.status === CandidateStatus.REJECTED
                      ? 'bg-status-muted'
                      : 'bg-status-active',
                )}
                style={{ width: `${leader.supportScore}%` }}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-[#64748b]">
            <Gauge className="h-3.5 w-3.5" />
            尚未生成候选
          </div>
        )}
      </div>

      {/* Conclusion chip (terminal only) */}
      {concluded && session.rootCause && (
        <div className="hidden min-w-0 items-center gap-1.5 rounded-md bg-status-recovered/10 px-2 py-1 lg:flex">
          <Trophy className="h-3.5 w-3.5 shrink-0 text-status-recovered" />
          <span className="truncate text-[11px] text-status-recovered" title={session.rootCause}>
            {session.rootCause}
          </span>
        </div>
      )}

      {/* Progress */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="hidden w-28 md:block">
          <div className="mb-0.5 flex justify-between text-[9px] text-[#64748b]">
            <span>进度</span>
            <span className="tabular">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                concluded ? 'bg-status-recovered' : 'bg-status-active',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {onExit && (
          <button
            type="button"
            onClick={onExit}
            title="结束诊断，返回模型探索"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-colors hover:bg-white/5 hover:text-[#cbd5e1]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
