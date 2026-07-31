import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Target,
  RefreshCw,
  PlayCircle,
  Loader,
  CheckCircle2,
  XCircle,
  Database,
  Link2,
  Gauge,
  Flag,
  type LucideIcon,
} from 'lucide-react'

import type { RuntimeEvent } from '../../schemas'
import { EventType } from '../../schemas'
import { cn } from '@/lib/utils'

/**
 * EventTimeline — Runtime 事件时间线（底部面板）
 *
 * Renders the unified Runtime event stream as a scrollable, filterable timeline.
 * Pure presentation: it only formats payloads the Runtime already emitted — it
 * never derives facts / evidence / candidates itself (铁律 #2). Each event is
 * described by its type and color-coded by category.
 */
export interface EventTimelineProps {
  events: RuntimeEvent[]
}

type Category = 'plan' | 'skill' | 'fact' | 'evidence' | 'candidate' | 'conclusion'

interface EventMeta {
  icon: LucideIcon
  category: Category
  /** Tailwind text-color class for the icon + accent. */
  color: string
}

/** Per-event-type visual metadata (icon + category + accent color). */
const EVENT_META: Record<EventType, EventMeta> = {
  [EventType.PLAN_CREATED]: { icon: Target, category: 'plan', color: 'text-status-active' },
  [EventType.PLAN_REPLANNED]: { icon: RefreshCw, category: 'plan', color: 'text-status-warning' },
  [EventType.TASK_SUBMITTED]: { icon: PlayCircle, category: 'skill', color: 'text-status-muted' },
  [EventType.SKILL_STARTED]: { icon: Loader, category: 'skill', color: 'text-status-muted' },
  [EventType.SKILL_COMPLETED]: { icon: CheckCircle2, category: 'skill', color: 'text-status-evidence' },
  [EventType.SKILL_FAILED]: { icon: XCircle, category: 'skill', color: 'text-status-fault' },
  [EventType.FACT_CREATED]: { icon: Database, category: 'fact', color: 'text-status-evidence' },
  [EventType.EVIDENCE_CREATED]: { icon: Link2, category: 'evidence', color: 'text-status-evidence' },
  [EventType.CANDIDATE_UPDATED]: { icon: Gauge, category: 'candidate', color: 'text-status-active' },
  [EventType.CONCLUSION_REACHED]: { icon: Flag, category: 'conclusion', color: 'text-status-recovered' },
}

const CATEGORY_LABEL: Record<Category, string> = {
  plan: '计划',
  skill: '技能',
  fact: '事实',
  evidence: '证据',
  candidate: '候选',
  conclusion: '结论',
}

const SKILL_LABEL: Record<string, string> = {
  business_mapping: '业务映射',
  topology: '拓扑路径',
  alert: '告警查询',
  log: '日志分析',
  kpi: 'KPI 指标',
  link_health: '链路健康',
  similar_case: '相似案例',
}

const RELATION_LABEL: Record<string, string> = {
  SUPPORTS: '支持',
  WEAKENS: '削弱',
  CONFLICTS: '冲突',
  NEUTRAL: '中性',
}

const CONCLUSION_LABEL: Record<string, string> = {
  ROOT_CAUSE_CONFIRMED: '根因确认',
  PROBABLE_CAUSES: '可能根因',
  INSUFFICIENT_EVIDENCE: '证据不足',
}

/** Format an ISO timestamp as HH:mm:ss (falls back to the raw string). */
function formatTime(iso: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso)
  return match ? match[1] : iso
}

/** Build a one-line human description from an event payload (read-only). */
function describeEvent(event: RuntimeEvent): string {
  const p = event.payload ?? {}
  switch (event.type) {
    case EventType.PLAN_CREATED:
      return `目标：${p.goal ?? '—'}${p.taskCount ? `（${p.taskCount} 个任务）` : ''}`
    case EventType.PLAN_REPLANNED:
      return `重规划 → ${p.newGoal ?? '—'}`
    case EventType.TASK_SUBMITTED:
      return `提交任务：${SKILL_LABEL[p.skillType] ?? p.skillType ?? '—'}`
    case EventType.SKILL_STARTED:
      return `启动技能：${SKILL_LABEL[p.skillType] ?? p.skillType ?? '—'}`
    case EventType.SKILL_COMPLETED:
      return `${p.success ? '完成' : '失败'}：${SKILL_LABEL[p.skillType] ?? p.skillType ?? '—'}`
    case EventType.SKILL_FAILED:
      return `技能失败：${SKILL_LABEL[p.skillType] ?? p.skillType ?? '—'}`
    case EventType.FACT_CREATED:
      return `产生事实（${SKILL_LABEL[p.skillType] ?? p.skillType ?? '—'}）`
    case EventType.EVIDENCE_CREATED:
      return `${RELATION_LABEL[p.relation] ?? p.relation ?? '关联'}「${p.candidateName ?? '—'}」（权重 ${p.weight ?? 0}）`
    case EventType.CANDIDATE_UPDATED: {
      const delta: number = p.delta ?? 0
      const sign = delta >= 0 ? '+' : ''
      return `${p.candidateName ?? '—'} ${p.oldScore ?? 0} → ${p.newScore ?? 0}（${sign}${delta}）`
    }
    case EventType.CONCLUSION_REACHED:
      return `${CONCLUSION_LABEL[p.conclusion] ?? p.conclusion ?? '结论'}：${p.rootCause ?? '证据不足'}`
    default:
      return event.type
  }
}

export default function EventTimeline({ events }: EventTimelineProps) {
  const [filter, setFilter] = useState<'ALL' | EventType>('ALL')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Distinct event types present in the stream, for the filter dropdown.
  const presentTypes = useMemo(() => {
    const seen = new Set<EventType>()
    for (const e of events) seen.add(e.type)
    return Array.from(seen).sort()
  }, [events])

  const visible = useMemo(
    () => (filter === 'ALL' ? events : events.filter((e) => e.type === filter)),
    [events, filter],
  )

  // Auto-scroll to the newest event as the stream grows.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length])

  return (
    <section className="flex h-full w-full flex-col overflow-hidden border-t border-white/8 bg-[#11141c]/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-active" />
          <span className="text-[12px] font-semibold text-[#e2e8f0]">推演事件链</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] tabular text-[#64748b]">
            {events.length} 条
          </span>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-[#64748b]">筛选</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'ALL' | EventType)}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-[#cbd5e1] focus:border-status-active/60 focus:outline-none [color-scheme:dark]"
          >
            <option value="ALL">全部类型</option>
            {presentTypes.map((t) => (
              <option key={t} value={t}>
                {CATEGORY_LABEL[EVENT_META[t].category]} · {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scrollable timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-[#64748b]">
            等待 Runtime 事件…
          </div>
        ) : (
          <ol className="relative space-y-1.5 before:absolute before:bottom-1 before:left-[11px] before:top-1 before:w-px before:content-[''] before:bg-white/8">
            {visible.map((event) => {
              const meta = EVENT_META[event.type] ?? {
                icon: Flag,
                category: 'conclusion' as Category,
                color: 'text-status-muted',
              }
              const Icon = meta.icon
              return (
                <li
                  key={event.id}
                  className="relative flex items-start gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.03]"
                >
                  {/* node dot / icon */}
                  <span
                    className={cn(
                      'relative z-10 mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#1a1d27]',
                      meta.color,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>

                  {/* body */}
                  <div className="min-w-0 flex-1 pt-px">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/5 px-1.5 py-px text-[9px] font-medium tabular text-[#64748b]">
                        #{event.seq}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-[#475569]">
                        {CATEGORY_LABEL[meta.category]}
                      </span>
                      <span className="ml-auto text-[10px] tabular text-[#475569]">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    <p className={cn('mt-0.5 text-[11px] leading-snug text-[#cbd5e1]')}>
                      <span className={cn('font-medium', meta.color)}>{event.type}</span>
                      <span className="text-[#475569]"> · </span>
                      {describeEvent(event)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
