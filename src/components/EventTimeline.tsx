/**
 * EventTimeline —— V2 Runtime 事件时间线（docs/04 §4.4 回放语义）。
 *
 * 回放只展示游标已知信息，不泄露未来：
 * - 事件列表只含 sequence ≤ cursor 的事件（由 ProjectionStore 按 snapshot 裁剪）；
 * - 游标之后的实时新事件以「新进展」提示显示数量，不展开内容；
 * - 点击事件 → onSeek(sequence) 进入只读 REPLAY。
 */

import { ChevronRight, FastForward, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimelineEventVM } from '../v2'

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return /T(\d{2}:\d{2}:\d{2})/.exec(iso)?.[1] ?? iso
}

function eventTone(type: TimelineEventVM['event_type']): string {
  switch (type) {
    case 'ROOT_CAUSE_CONFIRMED':
      return 'text-status-recovered'
    case 'PROBABLE_CAUSES_REPORTED':
    case 'INSUFFICIENT_EVIDENCE_REPORTED':
      return 'text-status-fault'
    case 'PLAN_REPLANNED':
    case 'CONFLICT_DETECTED':
      return 'text-status-warning'
    case 'EVIDENCE_CREATED':
    case 'FACT_DISCOVERED':
    case 'MINIMUM_CHAIN_UPDATED':
      return 'text-status-evidence'
    case 'CANDIDATES_GENERATED':
    case 'CANDIDATE_UPDATED':
      return 'text-status-active'
    default:
      return 'text-[#94a3b8]'
  }
}

export interface EventTimelineProps {
  /** Cursor-bounded events (ProjectionStore.timeline() already respects REPLAY). */
  events: TimelineEventVM[]
  cursor: number
  liveHead: number
  totalEvents: number
  isPlaying: boolean
  onPlayPause: () => void
  onStep: () => void
  onSeek: (sequence: number) => void
  onReturnLive: () => void
  /** 八幕书签（#8/§16.1）：scene → 目标事件 sequence，点击按幕跳转。 */
  replayBookmarks: Array<{ scene_id?: string; sequence: number; title?: string }>
}

export default function EventTimeline({
  events,
  cursor,
  liveHead,
  totalEvents,
  isPlaying,
  onPlayPause,
  onStep,
  onSeek,
  onReturnLive,
  replayBookmarks,
}: EventTimelineProps) {
  // 实时新事件 = 已应用到 live 快照但游标尚未追上的事件数。
  const newCount = Math.max(0, liveHead - cursor)
  const isReplay = cursor < liveHead

  return (
    <section className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/8 px-2 py-1.5">
        <button
          type="button"
          onClick={onPlayPause}
          title={isPlaying ? '暂停' : '播放'}
          className="flex h-6 w-6 items-center justify-center rounded bg-status-active/15 text-status-active hover:bg-status-active/25"
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={onStep}
          title="下一步"
          className="rounded p-1 text-[#64748b] hover:bg-white/5"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onReturnLive}
          disabled={!isReplay}
          title="跳到最新事件"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-[#64748b] hover:bg-white/5 disabled:opacity-30"
        >
          <FastForward className="h-3 w-3" />
          最新
        </button>
        <span className="ml-auto text-[9px] tabular text-[#64748b]">
          {cursor}/{totalEvents}
        </span>
      </div>

      {replayBookmarks.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-white/8 px-2 py-1">
          {replayBookmarks.map((b) => (
            <button
              key={`${b.scene_id ?? ''}-${b.sequence}`}
              type="button"
              onClick={() => onSeek(b.sequence)}
              title={b.title ?? b.scene_id}
              className={cn(
                'rounded px-1.5 py-0.5 text-[8px]',
                b.sequence <= cursor
                  ? 'bg-status-active/15 text-status-active hover:bg-status-active/25'
                  : 'bg-white/5 text-[#64748b] hover:bg-white/10',
              )}
            >
              {b.title ?? b.scene_id}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[10px] text-[#64748b]">
            等待 Runtime Event…
          </div>
        ) : (
          <ol className="space-y-1">
            {events.map((event) => (
              <li key={event.event_id}>
                <button
                  type="button"
                  onClick={() => onSeek(event.sequence)}
                  className={cn(
                    'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                    event.sequence === cursor
                      ? 'border-status-active/40 bg-status-active/[0.08]'
                      : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-white/5 px-1 py-0.5 text-[8px] tabular text-[#64748b]">
                      #{event.sequence}
                    </span>
                    <span className={cn('text-[9px] font-medium', eventTone(event.event_type))}>
                      {event.label}
                    </span>
                    <span className="ml-auto text-[8px] tabular text-[#475569]">
                      {formatTime(event.occurred_at)}
                    </span>
                  </div>
                  {event.summary && (
                    <p className="mt-0.5 text-[9px] leading-relaxed text-[#94a3b8]">{event.summary}</p>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {isReplay && newCount > 0 && (
        <button
          type="button"
          onClick={onReturnLive}
          className="flex shrink-0 items-center justify-center gap-1.5 border-t border-status-warning/20 bg-status-warning/[0.08] py-1.5 text-[9px] font-medium text-status-warning hover:bg-status-warning/[0.14]"
          title="查看最新进展"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-warning opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-status-warning" />
          </span>
          {newCount} 条新进展 · 点击返回实时
        </button>
      )}
    </section>
  )
}
