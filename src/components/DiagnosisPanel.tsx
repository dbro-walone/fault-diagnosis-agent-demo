import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type {
  DiagnosisSession,
  OntologyScenarioDefinition,
  RuntimeEvent,
} from '../../schemas'
import CandidatePanel from './CandidatePanel'
import DiagnosisStatusBar from './DiagnosisStatusBar'
import EventTimeline from './EventTimeline'

export default function DiagnosisPanel({
  session,
  definition,
  isPlaying,
  liveEvents,
  liveHead,
  isHistorical,
  selectedCandidateId,
  onSelectCandidate,
  onPlayPause,
  onStep,
  onSeek,
  onReturnCurrent,
  onExit,
}: {
  session: DiagnosisSession | null
  definition: OntologyScenarioDefinition | null
  isPlaying: boolean
  liveEvents: RuntimeEvent[]
  liveHead: number
  isHistorical: boolean
  selectedCandidateId: string | null
  onSelectCandidate: (id: string | null) => void
  onPlayPause: () => void
  onStep: () => void
  onSeek: (sequence: number) => void
  onReturnCurrent: () => void
  onExit: () => void
}) {
  if (!session || !definition) return null
  return (
    <div className="ontology-diagnosis-panel pointer-events-none absolute bottom-3 left-[308px] right-3 top-[110px] z-30">
      <PanelGroup direction="horizontal">
        <Panel order={1} minSize={42} className="flex min-w-0 flex-col">
          <PanelGroup direction="vertical">
            <Panel
              order={1}
              defaultSize={14}
              minSize={10}
              maxSize={24}
              className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 shadow-xl"
            >
              <DiagnosisStatusBar session={session} onExit={onExit} />
            </Panel>
            <PanelResizeHandle className="h-1.5" />
            <Panel order={2} minSize={34} className="pointer-events-none" />
            <PanelResizeHandle className="h-1.5 cursor-row-resize bg-white/[0.03]" />
            <Panel
              order={3}
              defaultSize={42}
              minSize={24}
              className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 shadow-xl"
            >
              <EventTimeline
                events={liveEvents}
                totalEvents={definition.events.length}
                liveHead={liveHead}
                isHistorical={isHistorical}
                currentSequence={session.version}
                isPlaying={isPlaying}
                onPlayPause={onPlayPause}
                onStep={onStep}
                onSeek={onSeek}
                onReturnCurrent={onReturnCurrent}
              />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="w-1.5 cursor-col-resize bg-white/[0.03]" />
        <Panel
          order={2}
          defaultSize={25}
          minSize={18}
          maxSize={36}
          className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 shadow-xl"
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
