/**
 * LuiPanel —— 右侧五层 LUI（docs/04 §3、docs/07 §2）。
 *
 * 完全由 V2 ProjectionStore 的只读 View Model 驱动，不执行任何诊断计算：
 *   1. 会话状态栏（模式 / 阶段 / 现象 + 实时/回放切换）
 *   2. 诊断态势（领先候选、支持分、证据链进度、冲突）
 *   3. 候选根因（分数、变化、缺口）
 *   4. 调查工作区（证据链 ｜ 计划 ｜ 历史 ｜ 详情）
 *
 * 注：issue 本轮删除「当前行动」栏 —— 排查进行到哪个节点，通过拓扑上的状态点/边流转
 * （路径高亮推进）直观呈现，不再在 LUI 重复展示目标/Skill/对象/原因/期望/结果。
 *
 * 铁律：agent_focus 只读自 Runtime；user_selection（候选/事实选择）只由用户交互更新；
 * 诊断支持分不带百分号；详情只覆盖调查工作区，不打断顶部 Agent 行动。
 */

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronRight,
  Crosshair,
  FastForward,
  FileText,
  History,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pin,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  StepForward,
  Target,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import EventTimeline from './EventTimeline'
import {
  type CaseRouteEntry,
  type CandidateItemVM,
  type CandidateListVM,
  type CurrentDecisionVM,
  type DiagnosisSessionSnapshot,
  type FactDetailVM,
  type KnowledgeSnapshotVM,
  type ObjectObsCategoryVM,
  type ObjectObsItemVM,
  type ObjectObsKind,
  type ObjectObservationPanelVM,
  type ObjectObservationVM,
  type ObjectObsStatus,
  type PlannerReplanVM,
  type PlannerTargetVM,
  type PlannerTargetsVM,
  type ProjectionStore,
  type TimelineEventVM,
} from '../v2'

type DisplayMode = 'LIVE' | 'PAUSED' | 'REPLAY'

export interface LuiPanelProps {
  knowledge: KnowledgeSnapshotVM
  candidates: CandidateListVM
  /** issue#6 阶段A + issue#7 C1/C2：Planner 优先级目标列表 + 重规划差异 + 排查路径/实际发现。 */
  planner: PlannerTargetsVM
  /** 阶段5：当前决策（LUI 三问之"为什么"——决策理由/证据缺口/目标候选/预期证据）。 */
  decision: CurrentDecisionVM
  snapshot: DiagnosisSessionSnapshot
  store: ProjectionStore
  timelineEvents: TimelineEventVM[]
  /** 八幕书签（Runtime snapshot.replay_bookmarks，#8/§16.1）。 */
  replayBookmarks: Array<{ scene_id?: string; sequence: number; title?: string }>
  selectedCandidateId: string | null
  onSelectCandidate: (id: string | null) => void
  selectedFactId: string | null
  onSelectFact: (id: string | null) => void
  mode: DisplayMode
  cursor: number
  liveHead: number
  totalEvents: number
  isPlaying: boolean
  caseEntry: CaseRouteEntry | null
  onPlayPause: () => void
  onStep: () => void
  onSpeedChange: (speed: number) => void
  playbackSpeed: number
  onSeek: (sequence: number) => void
  onReturnLive: () => void
  onReturnAgentView: () => void
  onExit: () => void
  routeNote: string | null
  /** F0：诊断会话中左侧 Object Explorer 收起 → LUI 宽度放大 ≈1.8×。 */
  wide: boolean
  leftPanelCollapsed: boolean
  onToggleLeftPanel: () => void
}

export default function LuiPanel(props: LuiPanelProps) {
  const { knowledge, candidates, snapshot, store } = props
  // issue#7 B2：时间线回放不再作为独立 tab，改为主内容区下方可折叠的窄条（默认收起）。
  const [timelineOpen, setTimelineOpen] = useState(false)
  // issue#7 B2：事实三级详情从 tab 改为浮层弹窗（点击"产出事实/证据事实"打开）。
  const [factModalId, setFactModalId] = useState<string | null>(props.selectedFactId ?? null)

  // issue#6 阶段B：对象观测三标签 View Model（跟随 agent_focus / Planner 当前位置）。
  const observation = useMemo(() => store.objectObservationPanel(), [store])

  // 打开事实详情浮层（保持 Projection user_selection 同步）。
  const selectFact = (id: string | null) => {
    props.onSelectFact(id)
    setFactModalId(id)
  }

  return (
    <aside
      className={cn(
        'ontology-lui pointer-events-auto absolute bottom-4 right-4 top-[60px] z-30 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#11141c]/95 shadow-2xl backdrop-blur-md',
        // F0：诊断会话（左侧收起）时 LUI 宽度放大 ≈1.8×。
        props.wide ? 'w-[806px]' : 'w-[448px]',
      )}
    >
      {/* Layer 1 — 会话状态栏 */}
      <SessionStatusBar
        {...props}
        timelineOpen={timelineOpen}
        onToggleTimeline={() => setTimelineOpen((open) => !open)}
      />

      {/* issue#7 B2：时间线回放窄条（八幕书签/事件跳转；不占主内容区，可折叠） */}
      {timelineOpen && (
        <div className="shrink-0 border-b border-white/8 bg-black/25">
          <EventTimeline
            events={props.timelineEvents}
            cursor={props.cursor}
            liveHead={props.liveHead}
            totalEvents={props.totalEvents}
            isPlaying={props.isPlaying}
            onPlayPause={props.onPlayPause}
            onStep={props.onStep}
            onSeek={props.onSeek}
            onReturnLive={props.onReturnLive}
            replayBookmarks={props.replayBookmarks}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {/* Layer 2 — 诊断态势 */}
        <DiagnosisSituation
          knowledge={knowledge}
          candidates={candidates}
          snapshot={snapshot}
          onReturnAgentView={props.onReturnAgentView}
        />

        {/* 阶段5：当前决策 —— LUI 三问之"下一步为什么这样做"（docs/19 §14.3） */}
        <CurrentDecisionView decision={props.decision} />

        {/* issue#6 阶段A + issue#7 C1/C2：Planner 目标区（排查路径主线 + 目标资源/故障模式/
            验证问题/期望发现/实际发现 + 重规划差异） */}
        <PlannerTargetsView planner={props.planner} />

        {/* issue#6 阶段B：对象观测三标签（当前焦点对象 告警｜性能｜日志 查询状态与结果） */}
        <ObjectObservationView vm={observation} />

        {/* Layer 3 — 候选根因 */}
        <CandidateList
          candidates={candidates}
          selectedCandidateId={props.selectedCandidateId}
          onSelectCandidate={props.onSelectCandidate}
          concluded={!!snapshot.session.terminal_status}
        />

        {props.routeNote && (
          <div className="flex items-start gap-1.5 rounded-md border border-status-warning/20 bg-status-warning/[0.06] px-2 py-1.5 text-[9px] text-status-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="flex-1">{props.routeNote}</span>
          </div>
        )}
      </div>

      {/* issue#7 B2：事实三级详情浮层（替代原「详情」tab） */}
      {factModalId && (
        <FactDetailModal
          store={store}
          factId={factModalId}
          onClose={() => selectFact(null)}
        />
      )}
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — 会话状态栏
// ─────────────────────────────────────────────────────────────────────────────

function SessionStatusBar(props: LuiPanelProps & { timelineOpen: boolean; onToggleTimeline: () => void }) {
  const { knowledge, mode, cursor, liveHead, totalEvents, isPlaying, caseEntry } = props
  const modeTone =
    mode === 'LIVE'
      ? 'bg-status-active/15 text-status-active'
      : mode === 'REPLAY'
        ? 'bg-status-warning/15 text-status-warning'
        : 'bg-white/5 text-[#94a3b8]'
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-white/8 bg-[#0f1117]/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={cn('flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold', modeTone)}>
          <Activity className="h-3 w-3" />
          {mode === 'LIVE' ? '实时' : mode === 'REPLAY' ? '回放' : '已暂停'}
        </span>
        <span className="rounded bg-white/5 px-2 py-1 text-[10px] text-[#cbd5e1]">
          {knowledge.phase_label || '待启动'}
        </span>
        {knowledge.terminal_status_label && (
          <span className="rounded bg-status-recovered/15 px-2 py-1 text-[10px] text-status-recovered">
            {knowledge.terminal_status_label}
          </span>
        )}
        {/* issue#7 B2：时间线回放入口（八幕书签/事件跳转，独立于主内容区） */}
        <button
          type="button"
          onClick={props.onToggleTimeline}
          title={props.timelineOpen ? '收起时间线' : '展开时间线'}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded hover:bg-white/5',
            props.timelineOpen ? 'bg-status-active/15 text-status-active' : 'text-[#64748b] hover:text-[#cbd5e1]',
          )}
        >
          <History className="h-3.5 w-3.5" />
        </button>
        {/* F0：手动展开/收起左侧 Object Explorer */}
        <button
          type="button"
          onClick={props.onToggleLeftPanel}
          title={props.leftPanelCollapsed ? '展开左侧 Object Explorer' : '收起左侧 Object Explorer'}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[#64748b] hover:bg-white/5 hover:text-[#cbd5e1]"
        >
          {props.leftPanelCollapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={props.onExit}
          title="退出诊断会话"
          className="flex h-6 w-6 items-center justify-center rounded text-[#64748b] hover:bg-white/5 hover:text-[#cbd5e1]"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[#94a3b8]">
        <Target className="mt-0.5 h-3 w-3 shrink-0 text-status-active" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[#cbd5e1]" title={knowledge.symptom_text || caseEntry?.name || ''}>
            {knowledge.symptom_text || caseEntry?.name || '等待现象标准化…'}
          </span>
          {caseEntry && (
            <span className="mt-0.5 block truncate text-[9px] text-[#64748b]" title={caseEntry.caseId}>
              {caseEntry.caseId} · {caseEntry.faultModeCode ?? caseEntry.faultDomain ?? ''}
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onPlayPause}
          title={isPlaying ? '暂停' : '播放'}
          className="flex h-7 w-7 items-center justify-center rounded bg-status-active/15 text-status-active hover:bg-status-active/25"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={props.onStep}
          title="单步推进"
          className="flex h-7 w-7 items-center justify-center rounded bg-white/5 text-[#94a3b8] hover:bg-white/10"
        >
          <StepForward className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => props.onSeek(0)}
          title="回到起点"
          className="flex h-7 w-7 items-center justify-center rounded bg-white/5 text-[#94a3b8] hover:bg-white/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={props.onReturnLive}
          disabled={mode !== 'REPLAY'}
          title="返回实时"
          className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[9px] text-[#94a3b8] hover:bg-white/10 disabled:opacity-30"
        >
          <FastForward className="h-3 w-3" />
          实时
        </button>
        <div className="flex items-center gap-0.5">
          {[0.5, 1, 2, 4].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => props.onSpeedChange(s)}
              title={`播放速度 ${s}x`}
              className={cn(
                'rounded px-1.5 py-1 text-[9px] tabular',
                props.playbackSpeed === s
                  ? 'bg-status-active/20 text-status-active'
                  : 'bg-white/5 text-[#64748b] hover:bg-white/10',
              )}
            >
              {s}x
            </button>
          ))}
        </div>
        <span className="ml-auto text-[9px] tabular text-[#64748b]">
          游标 {cursor} · {liveHead}/{totalEvents}
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — 诊断态势
// ─────────────────────────────────────────────────────────────────────────────

function DiagnosisSituation({
  knowledge,
  candidates,
  snapshot,
  onReturnAgentView,
}: {
  knowledge: KnowledgeSnapshotVM
  candidates: CandidateListVM
  snapshot: DiagnosisSessionSnapshot
  onReturnAgentView: () => void
}) {
  const leading = candidates.items.find((c) => c.candidate_id === knowledge.leading_candidate_id) ?? candidates.items[0]
  const chain = knowledge.chain_progress
  const chainPct = chain.total > 0 ? Math.round((chain.satisfied / chain.total) * 100) : 0
  const factCount = snapshot.facts.length
  const evidenceCount = snapshot.evidences.length

  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
          <Crosshair className="h-3.5 w-3.5 text-status-active" />
          诊断态势
        </div>
        <button
          type="button"
          onClick={onReturnAgentView}
          title="恢复相机到 Agent 当前对象"
          className="flex items-center gap-1 rounded border border-status-active/25 bg-status-active/10 px-1.5 py-0.5 text-[9px] text-status-active hover:bg-status-active/15"
        >
          <Crosshair className="h-3 w-3" />
          返回 Agent 视角
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-wide text-[#64748b]">领先候选</div>
          <div className="mt-0.5 truncate text-[12px] font-semibold text-[#e2e8f0]" title={leading?.display_name ?? '-'}>
            {leading?.is_confirmed && <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-status-recovered" />}
            {leading?.display_name ?? '尚未生成候选'}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[9px] uppercase tracking-wide text-[#64748b]">支持分</div>
          <div className="text-[18px] font-bold tabular leading-none text-status-evidence">
            {leading ? leading.score_label : '-'}
          </div>
        </div>
      </div>

      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[9px] text-[#94a3b8]">
          <span>最小证据链</span>
          <span className="tabular">
            {chain.satisfied}/{chain.total} 满足
            {chain.required_missing > 0 && (
              <span className="ml-1 text-status-warning">· 缺 {chain.required_missing}</span>
            )}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-status-evidence transition-all" style={{ width: `${chainPct}%` }} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1 text-[9px]">
        <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-status-evidence">事实 {factCount}</span>
        <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-status-evidence">证据 {evidenceCount}</span>
        <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-status-evidence">候选 {candidates.items.length}</span>
        {knowledge.critical_conflict_count > 0 && (
          <span className="rounded bg-status-fault/10 px-1.5 py-0.5 text-status-fault">
            关键冲突 {knowledge.critical_conflict_count}
          </span>
        )}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 阶段5 — 当前决策（LUI 三问之"为什么"）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 当前决策条（docs/19 §14.3 LUI 三问之"下一步为什么这样做"）。
 * 显式回答：正在做什么 / 为什么 / 目标候选 / 预期证据 / 证据缺口。
 * 完全由 ProjectionStore.currentDecision() 只读 View Model 驱动，不执行诊断计算。
 */
function CurrentDecisionView({ decision }: { decision: CurrentDecisionVM }) {
  return (
    <section className="rounded-lg border border-status-active/15 bg-status-active/[0.03] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-status-active">
        <Target className="h-3.5 w-3.5" />
        当前决策
        <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[8px] font-medium normal-case tracking-normal text-[#94a3b8]">
          {decision.context_label}
        </span>
      </div>

      <div className="space-y-1 text-[9px] leading-relaxed">
        {decision.action_text && (
          <div className="flex items-start gap-1.5">
            <span className="mt-px shrink-0 font-semibold text-status-active">正在</span>
            <span className="min-w-0 flex-1 text-[#cbd5e1]">{decision.action_text}</span>
          </div>
        )}
        {decision.reason_text && (
          <div className="flex items-start gap-1.5">
            <span className="mt-px shrink-0 font-semibold text-status-active">为什么</span>
            <span className="min-w-0 flex-1 text-[#94a3b8]">{decision.reason_text}</span>
          </div>
        )}
        {decision.target_candidate && (
          <div className="flex items-start gap-1.5">
            <span className="mt-px shrink-0 font-semibold text-status-active">目标</span>
            <span className="min-w-0 flex-1 text-[#cbd5e1]">
              {decision.target_candidate.object_id}
              <span className="ml-1.5 rounded bg-white/5 px-1 py-0.5 text-[8px] text-[#94a3b8]">
                {decision.target_candidate.fault_mode_code}
              </span>
            </span>
          </div>
        )}
        {decision.expected_evidence && (
          <div className="flex items-start gap-1.5">
            <span className="mt-px shrink-0 font-semibold text-status-active">预期</span>
            <span className="min-w-0 flex-1 text-[#94a3b8]">{decision.expected_evidence}</span>
          </div>
        )}
        {decision.result_summary && decision.activity_ended && (
          <div className="flex items-start gap-1.5">
            <span className="mt-px shrink-0 font-semibold text-status-recovered">结果</span>
            <span className="min-w-0 flex-1 text-status-recovered">{decision.result_summary}</span>
          </div>
        )}
      </div>

      {decision.evidence_gaps.length > 0 && (
        <div className="mt-1.5 border-t border-white/5 pt-1.5">
          <div className="text-[8px] uppercase tracking-wide text-status-warning">证据缺口</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {decision.evidence_gaps.map((gap) => (
              <span
                key={`${gap.candidate_id ?? 'chain'}:${gap.requirement_id}`}
                className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[8px] text-status-warning"
                title={gap.candidate_id ? `${gap.candidate_id} · ${gap.requirement_id}` : gap.requirement_id}
              >
                {gap.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段A — Planner 目标区
// ─────────────────────────────────────────────────────────────────────────────

/** 从 original_scope 提取排查路径 hop 序列："…路径（a → b → c）" → [a,b,c]。 */
function parsePathHops(scope: string): string[] {
  const m = /（([^）]+)）/.exec(scope)
  if (!m) return []
  return m[1]
    .split('→')
    .map((s) => s.trim())
    .filter(Boolean)
}

function PlannerTargetsView({ planner }: { planner: PlannerTargetsVM }) {
  const { targets, replans, original_scope, has_replan } = planner
  const lastReplan = replans[replans.length - 1]
  const pathHops = original_scope ? parsePathHops(original_scope) : []
  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        <Target className="h-3.5 w-3.5 text-status-active" />
        Planner 目标
        {planner.active_seq != null && (
          <span className="ml-auto rounded bg-status-active/15 px-1.5 py-0.5 text-[9px] font-bold text-status-active">
            当前位置 #{planner.active_seq}
          </span>
        )}
      </div>

      {/* issue#7 C1：排查路径主线（范围中的业务专属路径，从上到下依次排查） */}
      {pathHops.length > 0 ? (
        <div className="mb-1.5 rounded-md border border-status-active/15 bg-status-active/[0.04] px-2 py-1.5">
          <div className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-wide text-status-active">
            <ChevronRight className="h-3 w-3" />
            排查路径
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
            {pathHops.map((hop, i) => (
              <span key={`${hop}-${i}`} className="flex items-center gap-1">
                <span className="rounded bg-white/5 px-1.5 py-0.5 font-medium text-[#cbd5e1]">{hop}</span>
                {i < pathHops.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-[#475569]" />}
              </span>
            ))}
          </div>
          {original_scope && (
            <div className="mt-1 text-[8px] leading-relaxed text-[#64748b]" title={original_scope}>
              {original_scope}
            </div>
          )}
        </div>
      ) : (
        original_scope && (
          <div className="mb-1.5 flex items-start gap-1 text-[9px] text-[#64748b]">
            <span className="shrink-0">范围：</span>
            <span className="min-w-0 flex-1 leading-relaxed text-[#94a3b8]" title={original_scope}>
              {original_scope}
            </span>
          </div>
        )
      )}

      {targets.length === 0 ? (
        <div className="py-2 text-center text-[10px] text-[#64748b]">等待 Planner 生成目标…</div>
      ) : (
        <div className="space-y-1.5">
          {targets.map((t, i) => (
            <PlannerTargetRow key={t.seq} target={t} isFirst={i === 0} />
          ))}
        </div>
      )}

      {has_replan && lastReplan && <ReplanBanner replan={lastReplan} />}
    </section>
  )
}

/** 实际发现基调样式：命中(红) / 正常(绿) / 待排查(灰) / 已排除(弱灰)。 */
function findingToneClass(tone: PlannerTargetVM['finding_tone']): string {
  switch (tone) {
    case 'hit':
      return 'text-status-fault'
    case 'normal':
      return 'text-status-recovered'
    case 'excluded':
      return 'text-[#64748b]'
    default:
      return 'text-[#94a3b8]'
  }
}

function PlannerTargetRow({ target, isFirst }: { target: PlannerTargetVM; isFirst: boolean }) {
  const tone = plannerTargetTone(target)
  return (
    <div className="relative">
      {/* issue#7 C1：垂直主线连接（从上到下依次排查次序） */}
      {!isFirst && <span className="absolute -top-1.5 left-[7px] h-1.5 w-px bg-white/10" />}
      <div
        className={cn(
          'rounded-md border p-2 transition-colors',
          tone.box,
          target.is_active && 'ring-1 ring-status-active/40',
        )}
      >
        <div className="flex items-start gap-1.5">
          <span data-testid="planner-target-seq" className="mt-0.5 text-[9px] tabular text-[#475569]">{String(target.seq).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0">
                <span
                  className={cn(
                    'text-[11px] font-semibold leading-snug',
                    target.is_active ? 'text-status-active' : 'text-[#e2e8f0]',
                  )}
                >
                  {target.target_resource}
                </span>
                {target.round > 1 && (
                  <span className="ml-1 rounded bg-status-warning/15 px-1 py-0.5 text-[8px] text-status-warning">
                    重规划新增
                  </span>
                )}
                {target.is_paused && (
                  <span className="ml-1 rounded bg-white/5 px-1 py-0.5 text-[8px] text-[#64748b]">暂停</span>
                )}
                <span className="ml-1 rounded bg-white/5 px-1 py-0.5 text-[8px] text-[#94a3b8]">{target.scope}</span>
              </div>
              <span className={cn('flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px]', tone.badge)}>
                {target.is_active ? (
                  <Activity className="h-3 w-3" />
                ) : target.status === 'verified_abnormal' ? (
                  <ShieldCheck className="h-3 w-3" />
                ) : (
                  <ShieldQuestion className="h-3 w-3" />
                )}
                {target.status_label}
              </span>
            </div>
            <div className="mt-1 text-[9px] font-medium text-[#cbd5e1]">{target.target_fault_mode}</div>
            <div className="mt-0.5 text-[8px] leading-relaxed text-[#94a3b8]">
              <span className="text-[#64748b]">为什么：</span>
              {target.verify_question}
            </div>
            <div className="mt-0.5 text-[8px] leading-relaxed text-[#94a3b8]">
              <span className="text-[#64748b]">期望发现：</span>
              {target.expected_finding}
            </div>
            {/* issue#7 C2：实际发现（原证据链内容摘要，随诊断推进填充） */}
            <div className="mt-0.5 text-[8px] leading-relaxed">
              <span className="text-[#64748b]">实际发现：</span>
              <span className={cn('font-medium', findingToneClass(target.finding_tone))}>
                {target.actual_finding}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function plannerTargetTone(t: PlannerTargetVM): { box: string; badge: string } {
  if (t.is_active) {
    return {
      box: 'border-status-active/40 bg-status-active/[0.07]',
      badge: 'bg-status-active/20 text-status-active',
    }
  }
  if (t.status === 'verified_abnormal') {
    return {
      box: 'border-status-fault/40 bg-status-fault/[0.07]',
      badge: 'bg-status-fault/20 text-status-fault',
    }
  }
  if (t.status === 'excluded') {
    return {
      box: 'border-white/8 bg-white/[0.02] opacity-60',
      badge: 'bg-white/5 text-[#64748b]',
    }
  }
  if (t.status === 'verified_ok') {
    return {
      box: 'border-status-recovered/25 bg-status-recovered/[0.04]',
      badge: 'bg-status-recovered/15 text-status-recovered',
    }
  }
  return {
    box: 'border-white/8 bg-white/[0.02]',
    badge: 'bg-white/5 text-[#64748b]',
  }
}

function ReplanBanner({ replan }: { replan: PlannerReplanVM }) {
  const added = replan.added_targets.length ? replan.added_targets.join('、') : '无'
  const paused = replan.paused_targets.length ? replan.paused_targets.join('、') : '无'
  return (
    <div className="mt-2 rounded-md border border-status-warning/20 bg-status-warning/[0.05] px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-medium text-status-warning">
        <RefreshCw className="h-3 w-3 shrink-0" />
        重新规划 R{replan.round}：{replan.reason}
      </div>
      <div className="mt-1 space-y-0.5 text-[8px] leading-relaxed text-[#94a3b8]">
        <div>
          <span className="text-[#64748b]">原范围：</span>
          {replan.original_scope}
        </div>
        <div>
          <span className="text-[#64748b]">扩展：</span>
          {replan.new_scope}
        </div>
        <div>
          <span className="text-[#64748b]">新增目标：</span>
          <span className="text-status-warning">{added}</span>
        </div>
        <div>
          <span className="text-[#64748b]">暂停目标：</span>
          {paused}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段B — 对象观测三标签（告警｜性能｜日志）
// ─────────────────────────────────────────────────────────────────────────────

const OBS_KIND_LABEL: Record<ObjectObsKind, string> = {
  alarms: '告警',
  perf: '性能',
  logs: '日志',
}

const OBS_KIND_ICON: Record<ObjectObsKind, React.ReactNode> = {
  alarms: <Bell className="h-3 w-3" />,
  perf: <Activity className="h-3 w-3" />,
  logs: <FileText className="h-3 w-3" />,
}

function obsStatusTone(status: ObjectObsStatus): { badge: string; dot: string } {
  switch (status) {
    case 'QUERIED_ABNORMAL':
      return { badge: 'bg-status-fault/15 text-status-fault', dot: 'bg-status-fault' }
    case 'QUERIED_NORMAL':
      return { badge: 'bg-status-recovered/15 text-status-recovered', dot: 'bg-status-recovered' }
    case 'DATA_MISSING':
      return { badge: 'bg-orange-400/15 text-orange-400', dot: 'bg-orange-400' }
    case 'PARTIAL':
      return { badge: 'bg-yellow-400/15 text-yellow-400', dot: 'bg-yellow-400' }
    default:
      return { badge: 'bg-white/5 text-[#64748b]', dot: 'bg-status-muted' }
  }
}

/** 对象总体色：取最严重类别状态。 */
function overallObsTone(vm: ObjectObservationVM): string {
  const order: ObjectObsStatus[] = ['QUERIED_ABNORMAL', 'DATA_MISSING', 'PARTIAL', 'QUERIED_NORMAL', 'NOT_QUERIED']
  const statuses = [vm.alarms.status, vm.perf.status, vm.logs.status]
  for (const st of order) if (statuses.includes(st)) return obsStatusTone(st).dot
  return 'bg-status-muted'
}

/** 默认展开标签：优先有异常发现的类别，其次已查询类别，回退告警。 */
function defaultObsTab(vm: ObjectObservationVM): ObjectObsKind {
  const kinds: ObjectObsKind[] = ['alarms', 'perf', 'logs']
  const abnormal = kinds.find((k) => vm[k].status === 'QUERIED_ABNORMAL')
  if (abnormal) return abnormal
  const queried = kinds.find((k) => vm[k].status === 'QUERIED_NORMAL' || vm[k].status === 'PARTIAL' || vm[k].status === 'DATA_MISSING')
  if (queried) return queried
  return 'alarms'
}

function fmtObsTime(iso: string | null): string {
  if (!iso) return ''
  const t = iso.slice(11, 19)
  return t.length === 8 ? t : ''
}

function ObjectObservationView({ vm }: { vm: ObjectObservationPanelVM }) {
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [tabByObject, setTabByObject] = useState<Record<string, ObjectObsKind>>({})

  const displayId = pinnedId ?? vm.focus_object_id ?? vm.objects[0]?.object_id ?? null
  // 早期焦点（如 symptom 业务对象）可能尚未进入被排查集合，回退到首个被排查对象。
  const current = vm.objects.find((o) => o.object_id === displayId) ?? vm.objects[0] ?? null
  const activeTab: ObjectObsKind = current ? (tabByObject[current.object_id] ?? defaultObsTab(current)) : 'alarms'

  const pickTab = (kind: ObjectObsKind) => {
    if (!current) return
    setTabByObject((cur) => ({ ...cur, [current.object_id]: kind }))
  }

  if (vm.objects.length === 0) {
    return (
      <section className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
          <Crosshair className="h-3.5 w-3.5 text-status-evidence" />
          对象观测
        </div>
        <div className="mt-1.5 text-[10px] text-[#64748b]">等待对象查询任务启动…</div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        <Crosshair className="h-3.5 w-3.5 text-status-evidence" />
        对象观测
        <span className="ml-auto flex items-center gap-1 text-[9px] font-medium normal-case tracking-normal">
          {pinnedId && (
            <button
              type="button"
              onClick={() => setPinnedId(null)}
              className="flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[#64748b] hover:bg-white/10 hover:text-[#cbd5e1]"
              title="恢复跟随 Agent 焦点"
            >
              <Pin className="h-3 w-3" />
              跟随焦点
            </button>
          )}
          {current && (
            <span className={cn('flex items-center gap-1 rounded px-1.5 py-0.5', current.is_focus ? 'bg-status-active/15 text-status-active' : 'bg-white/5 text-[#94a3b8]')}>
              {current.is_focus && <Activity className="h-3 w-3" />}
              {current.display_name}
            </span>
          )}
        </span>
      </div>

      {/* 被排查对象切换条（点击固定查看；再次点击恢复跟随焦点） */}
      <div className="mb-2 flex items-center gap-1 overflow-x-auto pb-0.5">
        {vm.objects.map((o) => {
          const pinned = o.object_id === pinnedId
          const isFocus = o.is_focus
          return (
            <button
              key={o.object_id}
              type="button"
              onClick={() => setPinnedId(pinned ? null : o.object_id)}
              title={o.object_id}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[8px] transition-colors',
                pinned || isFocus
                  ? 'bg-status-active/15 text-status-active'
                  : 'bg-white/[0.03] text-[#94a3b8] hover:bg-white/10',
              )}
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', overallObsTone(o))} />
              {o.display_name}
              {o.is_focus && <span className="text-[7px] text-status-active">●</span>}
            </button>
          )
        })}
      </div>

      {/* 三标签：告警｜性能｜日志 */}
      {current && (
        <>
          <div className="grid grid-cols-3 gap-1">
            {(['alarms', 'perf', 'logs'] as ObjectObsKind[]).map((kind) => {
              const cat = current[kind]
              const tone = obsStatusTone(cat.status)
              const active = activeTab === kind
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => pickTab(kind)}
                  className={cn(
                    'rounded-md border px-1.5 py-1 text-left transition-colors',
                    active ? 'border-white/25 bg-white/[0.07]' : 'border-white/8 bg-black/10 hover:bg-white/[0.04]',
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className={cn('text-[#cbd5e1]', active && 'text-status-active')}>{OBS_KIND_ICON[kind]}</span>
                    <span className="text-[9px] font-semibold text-[#cbd5e1]">{OBS_KIND_LABEL[kind]}</span>
                    <span className={cn('ml-auto rounded px-1 py-0.5 text-[7px] font-medium', tone.badge)}>
                      {cat.status_label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          <ObsItemsPanel cat={current[activeTab]} />
        </>
      )}
    </section>
  )
}

function ObsItemsPanel({ cat }: { cat: ObjectObsCategoryVM }) {
  if (cat.status === 'NOT_QUERIED') {
    return (
      <div className="mt-1.5 rounded border border-white/[0.05] bg-black/15 px-2 py-1.5 text-[9px] leading-relaxed text-[#64748b]">
        未查询该对象此项观测（诊断按需推进，不强制扫描全部数据）
      </div>
    )
  }
  if (cat.status === 'DATA_MISSING') {
    return (
      <div className="mt-1.5 rounded border border-status-warning/20 bg-status-warning/[0.05] px-2 py-1.5 text-[9px] leading-relaxed text-status-warning">
        查询失败或无可用数据（数据缺失）
      </div>
    )
  }
  if (cat.status === 'PARTIAL') {
    return (
      <div className="mt-1.5 rounded border border-yellow-400/20 bg-yellow-400/[0.05] px-2 py-1.5 text-[9px] leading-relaxed text-yellow-400">
        仅覆盖部分查询范围（范围不完整）
      </div>
    )
  }
  if (cat.items.length === 0) {
    return (
      <div className="mt-1.5 rounded border border-white/[0.05] bg-black/15 px-2 py-1.5 text-[9px] leading-relaxed text-[#94a3b8]">
        查询完成，未发现异常条目
      </div>
    )
  }
  return (
    <div className="mt-1.5 space-y-1">
      {cat.items.map((item) => (
        <ObsItemRow key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  )
}

function ObsItemRow({ item }: { item: ObjectObsItemVM }) {
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded border px-1.5 py-1',
        item.abnormal ? 'border-status-fault/20 bg-status-fault/[0.04]' : 'border-white/[0.05] bg-black/20',
      )}
    >
      <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', item.abnormal ? 'bg-status-fault' : 'bg-status-muted')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <span className={cn('truncate text-[9px] font-medium', item.abnormal ? 'text-status-fault' : 'text-[#cbd5e1]')} title={item.title}>
            {item.title}
          </span>
          {fmtObsTime(item.time) && (
            <span className="shrink-0 text-[8px] tabular text-[#475569]">{fmtObsTime(item.time)}</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[8px] text-[#64748b]" title={item.detail}>
          {item.detail}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3 — 候选根因
// ─────────────────────────────────────────────────────────────────────────────

function CandidateList({
  candidates,
  selectedCandidateId,
  onSelectCandidate,
  concluded,
}: {
  candidates: CandidateListVM
  selectedCandidateId: string | null
  onSelectCandidate: (id: string | null) => void
  /** F3：诊断收敛时展示 TOP3（按支持分降序），置信度最高红色高亮。 */
  concluded: boolean
}) {
  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        <ShieldQuestion className="h-3.5 w-3.5 text-status-warning" />
        候选根因
        {concluded && (
          <span className="rounded bg-status-fault/15 px-1.5 py-0.5 text-[9px] font-bold text-status-fault">
            TOP3
          </span>
        )}
        <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[9px] tabular text-[#64748b]">
          {concluded ? '按支持分降序' : `${candidates.items.length} 项`}
        </span>
      </div>
      <div className="space-y-1.5">
        {candidates.items.length === 0 && (
          <div className="py-2 text-center text-[10px] text-[#64748b]">范围定位后生成候选</div>
        )}
        {candidates.items.map((c, index) => {
          // F3：收敛态只展示 TOP3（原索引保留，01/02/03 编号不变）。
          if (concluded && index >= 3) return null
          return (
            <CandidateRow
              key={c.candidate_id}
              candidate={c}
              index={index}
              selected={selectedCandidateId === c.candidate_id}
              onSelect={() => onSelectCandidate(selectedCandidateId === c.candidate_id ? null : c.candidate_id)}
            />
          )
        })}
      </div>
    </section>
  )
}

function CandidateRow({
  candidate,
  index,
  selected,
  onSelect,
}: {
  candidate: CandidateItemVM
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const tone = candidateTone(candidate)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border p-2 text-left transition-colors',
        tone.box,
        selected && 'ring-1 ring-white/30',
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 text-[9px] tabular text-[#475569]">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-medium leading-snug">{candidate.display_name}</span>
            <span className={cn('flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px]', tone.badge)}>
              {candidate.is_confirmed ? <ShieldCheck className="h-3 w-3" /> : <ShieldQuestion className="h-3 w-3" />}
              {candidate.status_label}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
              <div className={cn('h-full rounded-full transition-all', tone.bar)} style={{ width: `${candidate.score}%` }} />
            </div>
            <span className="flex items-center text-[11px] font-semibold tabular">
              {candidate.score_delta != null && candidate.score_delta < 0 && <span className="text-status-warning">▼</span>}
              {candidate.score_delta != null && candidate.score_delta > 0 && <span className="text-status-evidence">▲</span>}
              {candidate.score_label}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1 text-[8px]">
            <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-status-evidence">
              支持 {candidate.support_count}
            </span>
            {candidate.weaken_count > 0 && (
              <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-status-warning">
                削弱 {candidate.weaken_count}
              </span>
            )}
            {candidate.conflict_count > 0 && (
              <span className="rounded bg-status-fault/10 px-1.5 py-0.5 text-status-fault">
                冲突 {candidate.conflict_count}
              </span>
            )}
            <span
              className={cn(
                'rounded px-1.5 py-0.5',
                candidate.missing_requirement_ids.length
                  ? 'bg-status-warning/10 text-status-warning'
                  : 'bg-status-recovered/10 text-status-recovered',
              )}
            >
              {candidate.missing_requirement_ids.length
                ? `缺口 ${candidate.missing_requirement_ids.length}`
                : '链完整'}
            </span>
          </div>
          {selected && candidate.missing_requirement_ids.length > 0 && (
            <p className="mt-1.5 text-[9px] leading-relaxed text-[#94a3b8]">
              待补齐：{candidate.missing_requirement_ids.join('、')}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

function candidateTone(c: CandidateItemVM): { box: string; badge: string; bar: string } {
  if (c.is_confirmed) {
    // F3：已确认根因用红色高亮（issue #5 F3；原为 recovered 绿）。
    return {
      box: 'border-status-fault/50 bg-status-fault/[0.08]',
      badge: 'bg-status-fault/20 text-status-fault',
      bar: 'bg-status-fault',
    }
  }
  if (c.status === 'LEADING') {
    return {
      box: 'border-status-active/35 bg-status-active/[0.06]',
      badge: 'bg-status-active/15 text-status-active',
      bar: 'bg-status-active',
    }
  }
  if (c.status === 'WEAKENED') {
    return {
      box: 'border-white/8 bg-white/[0.02] opacity-70',
      badge: 'bg-white/5 text-[#64748b]',
      bar: 'bg-status-muted',
    }
  }
  if (c.status === 'CONFLICTING') {
    return {
      box: 'border-status-fault/25 bg-status-fault/[0.04]',
      badge: 'bg-status-fault/15 text-status-fault',
      bar: 'bg-status-fault',
    }
  }
  return {
    box: 'border-status-warning/20 bg-status-warning/[0.03]',
    badge: 'bg-status-warning/15 text-status-warning',
    bar: 'bg-status-warning',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#7 B2 — 事实三级详情浮层（替代原「详情」tab 与证据链 tab）
// ─────────────────────────────────────────────────────────────────────────────

function FactTypeIcon({ type }: { type: string }) {
  // Icon glyph by fact type (keeps the three-level drilldown visually anchored).
  const glyph: Record<string, string> = {
    ALARM: '🔔',
    LOG: '📄',
    LOG_FINGERPRINT: '🧬',
    KPI_WINDOW: '📈',
    TOPOLOGY_RELATION: '🔗',
    RESOURCE_STATE: '🖥',
    ABSENCE: '∅',
    SIMILAR_CASE_REFERENCE: '📚',
  }
  return <span className="mt-0.5 text-[10px] leading-none">{glyph[type] ?? '•'}</span>
}

/** 事实三级详情浮层（LUI 内弹出，点击「产出事实 / 证据事实」打开）。 */
function FactDetailModal({
  store,
  factId,
  onClose,
}: {
  store: ProjectionStore
  factId: string
  onClose: () => void
}) {
  const detail: FactDetailVM | null = useMemo(() => store.factDetail(factId), [store, factId])
  if (!detail) return null
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="事实详情"
    >
      <div
        className="pointer-events-auto flex max-h-[75%] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#131722] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-white/8 p-3">
          <FactTypeIcon type={detail.fact_type} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-[#e2e8f0]">{detail.fact_type_label}</div>
            <div className="mt-0.5 font-mono text-[9px] text-[#64748b]">{detail.fact_id}</div>
          </div>
          <button type="button" onClick={onClose} className="text-[#64748b] hover:text-[#cbd5e1]" aria-label="关闭详情">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex flex-wrap gap-1 text-[8px]">
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[#94a3b8]">对象 {detail.object_refs.join(', ')}</span>
            {detail.quality_label && (
              <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-status-evidence">{detail.quality_label}</span>
            )}
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[#94a3b8]">{detail.skill_id}</span>
          </div>

          <div className="mt-2.5 space-y-1">
            {detail.payload_rows.map((row) => (
              <div key={row.key} className="rounded border border-white/[0.05] bg-white/[0.02] px-2 py-1">
                <div className="text-[8px] uppercase tracking-wide text-[#475569]">{row.label}</div>
                <div className="mt-0.5 break-all text-[10px] leading-relaxed text-[#cbd5e1]">{row.value}</div>
              </div>
            ))}
          </div>

          {detail.referenced_by_evidence_ids.length > 0 && (
            <div className="mt-2.5">
              <div className="text-[9px] uppercase tracking-wider text-[#64748b]">被证据引用</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {detail.referenced_by_evidence_ids.map((id) => (
                  <span key={id} className="rounded bg-status-evidence/10 px-1.5 py-0.5 font-mono text-[8px] text-status-evidence">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2.5 text-[8px] text-[#475569]">
            来源 Skill：{detail.skill_id} · 执行 {detail.execution_id} · 原始引用 {detail.source_refs.join(', ')}
          </div>
        </div>
      </div>
    </div>
  )
}
