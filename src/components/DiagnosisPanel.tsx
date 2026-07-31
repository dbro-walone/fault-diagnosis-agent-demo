import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import type { DiagnosisSession, RuntimeEvent } from '../../schemas'
import { cn } from '@/lib/utils'
import DiagnosisStatusBar from './DiagnosisStatusBar'
import CandidatePanel from './CandidatePanel'
import EventTimeline from './EventTimeline'

/**
 * DiagnosisPanel — 诊断工作台容器
 *
 * Gates the diagnosis UI: when no session is active it renders nothing, so the
 * first screen stays the pure model-exploration state (铁律 #1). Once a Runtime
 * session exists it lays out the three diagnosis surfaces — a status bar across
 * the top, the candidate panel docked to the right, and the event timeline
 * along the bottom — with react-resizable-panels. The central gap is kept
 * transparent (pointer-events-none) so the 3D canvas underneath stays fully
 * explorable while a diagnosis runs.
 */
export interface DiagnosisPanelProps {
  /** Active Runtime session, or null while in model-exploration state. */
  session: DiagnosisSession | null
  events: RuntimeEvent[]
  /** Coarse UI phase label forwarded to the status bar. */
  phase: string
  totalRounds: number
  selectedCandidateId: string | null
  onSelectCandidate: (id: string | null) => void
  /** Exit the diagnosis workspace and return to model exploration. */
  onExit?: () => void
}

/** Vertical resize handle (sits between the status bar / canvas gap / timeline). */
function VHandle() {
  return (
    <PanelResizeHandle
      className={cn(
        'group pointer-events-auto relative h-1.5 w-full shrink-0 bg-white/5 transition-colors hover:bg-status-active/30',
      )}
    >
      <span className="absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded bg-white/15 transition-colors group-hover:bg-status-active/60" />
    </PanelResizeHandle>
  )
}

/** Horizontal resize handle (sits between the workspace and the candidate dock). */
function HHandle() {
  return (
    <PanelResizeHandle
      className={cn(
        'group pointer-events-auto relative h-full w-1.5 shrink-0 bg-white/5 transition-colors hover:bg-status-active/30',
      )}
    >
      <span className="absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-white/15 transition-colors group-hover:bg-status-active/60" />
    </PanelResizeHandle>
  )
}

export default function DiagnosisPanel({
  session,
  events,
  phase,
  totalRounds,
  selectedCandidateId,
  onSelectCandidate,
  onExit,
}: DiagnosisPanelProps) {
  // 铁律 #1: no session → no diagnosis UI; the canvas model view stands alone.
  if (!session) return null

  return (
    <div className="pointer-events-none absolute bottom-3 left-[306px] right-3 top-[60px] z-30 flex">
      <PanelGroup direction="horizontal">
        {/* Left region: status bar (top) + transparent canvas gap + timeline (bottom) */}
        <Panel order={1} minSize={35} className="flex min-w-0 flex-col">
          <PanelGroup direction="vertical">
            <Panel order={1} defaultSize={13} minSize={8} maxSize={22} className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 shadow-2xl">
              <DiagnosisStatusBar
                session={session}
                phase={phase}
                totalRounds={totalRounds}
                onExit={onExit}
              />
            </Panel>

            <VHandle />

            {/* Transparent spacer: the 3D canvas shows through and stays interactive. */}
            <Panel order={2} minSize={28} className="pointer-events-none" />

            <VHandle />

            <Panel order={3} defaultSize={44} minSize={18} className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 shadow-2xl">
              <EventTimeline events={events} />
            </Panel>
          </PanelGroup>
        </Panel>

        <HHandle />

        {/* Right dock: candidate panel (full height) */}
        <Panel
          order={2}
          defaultSize={26}
          minSize={16}
          maxSize={42}
          className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 shadow-2xl"
        >
          <CandidatePanel
            session={session}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={onSelectCandidate}
          />
        </Panel>
      </PanelGroup>
    </div>
  )
}
