/**
 * LuiPanel —— 右侧五层 LUI（docs/04 §3、docs/07 §2）。
 *
 * 完全由 V2 ProjectionStore 的只读 View Model 驱动，不执行任何诊断计算：
 *   1. 会话状态栏（模式 / 阶段 / 现象 + 实时/回放切换）
 *   2. 诊断态势（领先候选、支持分、证据链进度、冲突）
 *   3. 当前行动（目标、Skill、对象、原因、期望、结果）
 *   4. 候选根因（分数、变化、缺口）
 *   5. 调查工作区（证据链 ｜ 计划 ｜ 历史 ｜ 详情）
 *
 * 铁律：agent_focus 只读自 Runtime；user_selection（候选/事实选择）只由用户交互更新；
 * 诊断支持分不带百分号；详情只覆盖调查工作区，不打断顶部 Agent 行动。
 */

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Crosshair,
  FastForward,
  FileSearch,
  History,
  Layers,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
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
  ChainItemStatus,
  type CaseRouteEntry,
  type CandidateItemVM,
  type CandidateListVM,
  type CurrentActionVM,
  type DiagnosisSessionSnapshot,
  type EvidenceChainItemVM,
  type FactDetailVM,
  type KnowledgeSnapshotVM,
  type PlannerReplanVM,
  type PlannerTargetVM,
  type PlannerTargetsVM,
  type ProjectionStore,
  type TimelineEventVM,
} from '../v2'

type DisplayMode = 'LIVE' | 'PAUSED' | 'REPLAY'
type WorkspaceTab = 'chain' | 'plan' | 'history' | 'detail'

export interface LuiPanelProps {
  knowledge: KnowledgeSnapshotVM
  action: CurrentActionVM
  candidates: CandidateListVM
  /** issue#6 阶段A：Planner 优先级目标列表 + 重规划差异。 */
  planner: PlannerTargetsVM
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
  const { knowledge, action, candidates, snapshot, store } = props
  const [tab, setTab] = useState<WorkspaceTab>('chain')

  // When the user drills into a fact, jump to the detail tab.
  const selectFact = (id: string | null) => {
    props.onSelectFact(id)
    if (id) setTab('detail')
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
      <SessionStatusBar {...props} />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {/* Layer 2 — 诊断态势 */}
        <DiagnosisSituation
          knowledge={knowledge}
          candidates={candidates}
          snapshot={snapshot}
          onReturnAgentView={props.onReturnAgentView}
        />

        {/* issue#6 阶段A：Planner 目标区（目标资源/故障模式/验证问题/期望发现/当前范围 + 重规划差异） */}
        <PlannerTargetsView planner={props.planner} />

        {/* Layer 3 — 主内容区（证据链/计划/历史/详情）：提高到诊断态势下方，更大更醒目 */}
        <div className="flex min-h-[240px] flex-1 flex-col overflow-hidden rounded-lg border border-white/8 bg-black/20">
          <div className="flex shrink-0 items-center gap-1 border-b border-white/8 px-2 py-1.5">
            <TabButton active={tab === 'chain'} onClick={() => setTab('chain')} icon={<Layers className="h-3.5 w-3.5" />}>
              证据链
            </TabButton>
            <TabButton active={tab === 'plan'} onClick={() => setTab('plan')} icon={<ListChecks className="h-3.5 w-3.5" />}>
              计划
            </TabButton>
            <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={<History className="h-3.5 w-3.5" />}>
              历史
            </TabButton>
            <TabButton active={tab === 'detail'} onClick={() => setTab('detail')} icon={<FileSearch className="h-3.5 w-3.5" />}>
              详情
            </TabButton>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'chain' && (
              <EvidenceChainView
                snapshot={snapshot}
                store={store}
                selectedCandidateId={props.selectedCandidateId}
                candidates={candidates}
                onSelectFact={selectFact}
              />
            )}
            {tab === 'plan' && <PlanView snapshot={snapshot} />}
            {tab === 'history' && (
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
            )}
            {tab === 'detail' && (
              <FactDetailView
                store={store}
                selectedFactId={props.selectedFactId}
                onClose={() => selectFact(null)}
              />
            )}
          </div>
        </div>

        {/* Layer 4 — 当前行动 */}
        <CurrentAction action={action} onSelectFact={selectFact} />

        {/* Layer 5 — 候选根因 */}
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
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — 会话状态栏
// ─────────────────────────────────────────────────────────────────────────────

function SessionStatusBar(props: LuiPanelProps) {
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
// issue#6 阶段A — Planner 目标区
// ─────────────────────────────────────────────────────────────────────────────

function PlannerTargetsView({ planner }: { planner: PlannerTargetsVM }) {
  const { targets, replans, original_scope, has_replan } = planner
  const lastReplan = replans[replans.length - 1]
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

      {original_scope && (
        <div className="mb-1.5 flex items-start gap-1 text-[9px] text-[#64748b]">
          <span className="shrink-0">范围：</span>
          <span className="min-w-0 flex-1 leading-relaxed text-[#94a3b8]" title={original_scope}>
            {original_scope}
          </span>
        </div>
      )}

      {targets.length === 0 ? (
        <div className="py-2 text-center text-[10px] text-[#64748b]">等待 Planner 生成目标…</div>
      ) : (
        <div className="space-y-1.5">
          {targets.map((t) => (
            <PlannerTargetRow key={t.seq} target={t} />
          ))}
        </div>
      )}

      {has_replan && lastReplan && <ReplanBanner replan={lastReplan} />}
    </section>
  )
}

function PlannerTargetRow({ target }: { target: PlannerTargetVM }) {
  const tone = plannerTargetTone(target)
  return (
    <div
      className={cn(
        'rounded-md border p-2 transition-colors',
        tone.box,
        target.is_active && 'ring-1 ring-status-active/40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 text-[9px] tabular text-[#475569]">{String(target.seq).padStart(2, '0')}</span>
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
// Layer 3 — 当前行动
// ─────────────────────────────────────────────────────────────────────────────

function CurrentAction({
  action,
  onSelectFact,
}: {
  action: CurrentActionVM
  onSelectFact: (id: string) => void
}) {
  if (!action.has_activity) {
    return (
      <section className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
          <Activity className="h-3.5 w-3.5 text-status-active" />
          当前行动
        </div>
        <div className="mt-1.5 text-[10px] text-[#64748b]">暂无进行中的诊断行动</div>
      </section>
    )
  }
  const done = action.status_label === '成功' || action.status_label === '已跳过'
  return (
    <section
      className={cn(
        'rounded-lg border p-2.5',
        done ? 'border-status-recovered/25 bg-status-recovered/[0.04]' : 'border-status-active/25 bg-status-active/[0.05]',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        <Activity className={cn('h-3.5 w-3.5', done ? 'text-status-recovered' : 'text-status-active')} />
        当前行动
        {action.status_label && (
          <span
            className={cn(
              'ml-auto rounded px-1.5 py-0.5 text-[9px]',
              done ? 'bg-status-recovered/15 text-status-recovered' : 'bg-status-active/15 text-status-active',
            )}
          >
            {action.status_label}
          </span>
        )}
      </div>
      {action.goal && (
        <div className="mt-1.5 text-[11px] font-medium text-[#e2e8f0]">{action.goal}</div>
      )}
      {action.action_text && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-[#cbd5e1]">
          <span className="truncate">{action.action_text}</span>
          {action.target_object_refs.length > 0 && (
            <span className="ml-auto shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] tabular text-[#94a3b8]">
              {action.target_object_refs.join(', ')}
            </span>
          )}
        </div>
      )}
      {action.reason_text && (
        <div className="mt-1 text-[9px] leading-relaxed text-[#94a3b8]">
          <span className="text-[#64748b]">为什么：</span>
          {action.reason_text}
        </div>
      )}
      {action.expected_result_text && (
        <div className="mt-0.5 text-[9px] leading-relaxed text-[#94a3b8]">
          <span className="text-[#64748b]">期望：</span>
          {action.expected_result_text}
        </div>
      )}
      {action.result_summary && (
        <div className="mt-1 text-[9px] leading-relaxed text-status-evidence">
          <span className="text-[#64748b]">结果：</span>
          {action.result_summary}
        </div>
      )}
      {action.facts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[9px] text-[#64748b]">产出事实：</span>
          {action.facts.map((f) => (
            <button
              key={f.fact_id}
              type="button"
              onClick={() => onSelectFact(f.fact_id)}
              className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-[9px] text-status-evidence transition-colors hover:bg-status-evidence/25"
            >
              {f.fact_type_label}
            </button>
          ))}
        </div>
      )}
      {(action.evidence_refs.length > 0 || action.candidate_update_refs.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {action.evidence_refs.length > 0 && (
            <span className="rounded bg-status-evidence/10 px-1.5 py-0.5 text-[9px] text-status-evidence">
              证据 {action.evidence_refs.length}
            </span>
          )}
          {action.candidate_update_refs.length > 0 && (
            <span className="rounded bg-status-active/10 px-1.5 py-0.5 text-[9px] text-status-active">
              候选变化 {action.candidate_update_refs.length}
            </span>
          )}
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 4 — 候选根因
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
// Layer 5 · 证据链 — 最小证据链条目 + 事实预览（docs/07 §4）
// ─────────────────────────────────────────────────────────────────────────────

function EvidenceChainView({
  snapshot,
  store,
  selectedCandidateId,
  candidates,
  onSelectFact,
}: {
  snapshot: DiagnosisSessionSnapshot
  store: ProjectionStore
  selectedCandidateId: string | null
  candidates: CandidateListVM
  onSelectFact: (id: string) => void
}) {
  // 证据链归属候选：用户选中 > 领先候选 > 首个。
  const chainCandidateId =
    selectedCandidateId ?? candidates.leading_id ?? candidates.items[0]?.candidate_id ?? ''

  // 最小证据链条目（requirement_id / label / status / evidence_refs）。
  const chain = snapshot.minimum_evidence_chain
  const items = chain?.items ?? []

  // 用 ProjectionStore 的证据视图（已含事实 headline 预览），按 evidence_id 索引。
  const chainVm = useMemo(
    () => (chainCandidateId ? store.evidenceChain(chainCandidateId) : { candidate_id: '', items: [] }),
    [store, chainCandidateId],
  )
  const evItemById = useMemo(
    () => new Map(chainVm.items.map((i) => [i.evidence_id, i])),
    [chainVm],
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2">
      <div className="mb-2 flex items-center gap-1.5 text-[9px] text-[#64748b]">
        <span>证据链候选：</span>
        <span className="truncate font-medium text-[#cbd5e1]">
          {candidates.items.find((c) => c.candidate_id === chainCandidateId)?.display_name ?? chainCandidateId}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[10px] text-[#64748b]">
          等待最小证据链更新…
        </div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item) => {
            const evItems: EvidenceChainItemVM[] = (item.evidence_refs ?? [])
              .map((id) => evItemById.get(id))
              .filter((x): x is EvidenceChainItemVM => Boolean(x))
            return (
              <li
                key={item.requirement_id}
                className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2"
              >
                <div className="flex items-center gap-1.5">
                  <ChainStatusDot status={item.status} />
                  <span className="text-[10px] font-medium text-[#cbd5e1]">{item.label ?? item.requirement_id}</span>
                  {item.required ? (
                    <span className="rounded bg-white/5 px-1 py-0.5 text-[8px] text-[#64748b]">必需</span>
                  ) : (
                    <span className="rounded bg-white/5 px-1 py-0.5 text-[8px] text-[#475569]">可选</span>
                  )}
                  <span className="ml-auto font-mono text-[8px] text-[#475569]">{item.requirement_id}</span>
                </div>
                {evItems.length === 0 ? (
                  <div className="mt-1.5 pl-4 text-[9px] text-[#64748b]">
                    {item.status === ChainItemStatus.PENDING ? '尚无关联证据' : '无关联证据'}
                  </div>
                ) : (
                  <div className="mt-1.5 space-y-1 pl-4">
                    {evItems.map((ev) => (
                      <EvidencePreview key={ev.evidence_id} item={ev} onSelectFact={onSelectFact} />
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function EvidencePreview({
  item,
  onSelectFact,
}: {
  item: EvidenceChainItemVM
  onSelectFact: (id: string) => void
}) {
  const tone = effectTone(item.effect)
  return (
    <div className="rounded border border-white/[0.05] bg-black/20 p-1.5">
      <div className="flex items-center gap-1 text-[9px]">
        <span className={cn('rounded px-1 py-0.5 font-medium', tone.badge)}>{item.effect_label}</span>
        <span className="text-[#64748b]">{item.evidence_type_label}</span>
        {item.score_delta !== 0 && (
          <span className={cn('ml-auto tabular', item.score_delta > 0 ? 'text-status-evidence' : 'text-status-warning')}>
            {item.score_delta > 0 ? '+' : ''}{item.score_delta}
          </span>
        )}
      </div>
      {item.facts.map((fact) => (
        <button
          key={fact.fact_id}
          type="button"
          onClick={() => onSelectFact(fact.fact_id)}
          className="mt-1 flex w-full items-start gap-1.5 rounded bg-white/[0.02] px-1.5 py-1 text-left hover:bg-white/[0.05]"
        >
          <FactTypeIcon type={fact.fact_type} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] text-[#cbd5e1]" title={fact.headline}>
              {fact.headline}
            </span>
            <span className="font-mono text-[8px] text-[#475569]">{fact.fact_id}</span>
          </span>
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-[#475569]" />
        </button>
      ))}
    </div>
  )
}

function ChainStatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    SATISFIED: 'bg-status-recovered',
    IN_PROGRESS: 'bg-status-active',
    PENDING: 'bg-status-muted',
    CONFLICTING: 'bg-status-fault',
    UNAVAILABLE: 'bg-[#475569]',
  }
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', map[status] ?? 'bg-status-muted')} />
}

function effectTone(effect: string): { badge: string } {
  if (effect === 'STRONG_SUPPORT' || effect === 'SUPPORT') {
    return { badge: 'bg-status-evidence/15 text-status-evidence' }
  }
  if (effect === 'CONFLICT') return { badge: 'bg-status-fault/15 text-status-fault' }
  if (effect === 'WEAKEN') return { badge: 'bg-status-warning/15 text-status-warning' }
  return { badge: 'bg-white/5 text-[#94a3b8]' }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Layer 5 · 计划 — 计划任务 + 重规划 + 候选分数历史
// ─────────────────────────────────────────────────────────────────────────────

function PlanView({ snapshot }: { snapshot: DiagnosisSessionSnapshot }) {
  const updates = snapshot.candidate_updates
  const candName = new Map(snapshot.candidates.map((c) => [c.candidate_id, c.display_name ?? c.candidate_id]))
  return (
    <div className="flex h-full flex-col overflow-y-auto p-2">
      <div className="mb-2 text-[9px] uppercase tracking-wider text-[#64748b]">计划</div>
      <div className="space-y-1.5">
        {snapshot.plans.length === 0 && (
          <div className="text-[10px] text-[#64748b]">等待 Planner 生成计划…</div>
        )}
        {snapshot.plans.map((plan) => (
          <div key={plan.plan_id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="font-medium text-[#cbd5e1]">{plan.plan_id}</span>
              <span className="rounded bg-white/5 px-1 py-0.5 text-[8px] text-[#64748b]">{plan.phase}</span>
              <span className="ml-auto text-[8px] tabular text-[#475569]">{plan.tasks.length} 任务</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {plan.tasks.map((tid) => {
                const task = snapshot.tasks.find((t) => t.task_id === tid)
                return (
                  <span
                    key={tid}
                    className="rounded border border-white/8 px-1.5 py-0.5 text-[8px] text-[#94a3b8]"
                    title={task?.display_name ?? tid}
                  >
                    {task?.skill_id ?? tid}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-1.5 mt-3 text-[9px] uppercase tracking-wider text-[#64748b]">候选分数轨迹</div>
      <div className="space-y-1">
        {updates.length === 0 && <div className="text-[10px] text-[#64748b]">尚无候选更新</div>}
        {updates.slice(-12).map((u) => (
          <div
            key={`${u.candidate_id}-${u.sequence ?? ''}`}
            className="flex items-center gap-1.5 rounded bg-white/[0.02] px-1.5 py-1 text-[9px]"
          >
            <span className="min-w-0 flex-1 truncate text-[#cbd5e1]">{candName.get(u.candidate_id) ?? u.candidate_id}</span>
            <span className="tabular text-[#64748b]">
              {u.score_before}→<span className="font-semibold text-status-evidence">{u.score_after}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 5 · 详情 — Fact Detail（docs/07 §5/§7）
// ─────────────────────────────────────────────────────────────────────────────

function FactDetailView({
  store,
  selectedFactId,
  onClose,
}: {
  store: ProjectionStore
  selectedFactId: string | null
  onClose: () => void
}) {
  const detail: FactDetailVM | null = useMemo(
    () => (selectedFactId ? store.factDetail(selectedFactId) : null),
    [store, selectedFactId],
  )
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[10px] text-[#64748b]">
        点击证据链中的事实预览以查看三级详情
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto p-2.5">
      <div className="flex items-start gap-2">
        <FactTypeIcon type={detail.fact_type} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-[#e2e8f0]">{detail.fact_type_label}</div>
          <div className="mt-0.5 font-mono text-[9px] text-[#64748b]">{detail.fact_id}</div>
        </div>
        <button type="button" onClick={onClose} className="text-[#64748b] hover:text-[#cbd5e1]" aria-label="关闭详情">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1 text-[8px]">
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
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-semibold transition-colors',
        active
          ? 'bg-status-active/20 text-status-active'
          : 'text-[#94a3b8] hover:bg-white/5 hover:text-[#e2e8f0]',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
