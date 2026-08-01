import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Eye, Radar, X } from 'lucide-react'

import DiagnosisEntryButton, {
  type DiagnosisEntryPayload,
} from '@/components/DiagnosisEntryButton'
import DualPlaneCanvas from '@/components/DualPlaneCanvas'
import LuiPanel from '@/components/LuiPanel'
import LensSwitcher from '@/components/LensSwitcher'
import ModelNavigator, { type LayerVisibility } from '@/components/ModelNavigator'
import ObjectViewPanel from '@/components/ObjectViewPanel'
import {
  buildActiveGraph,
  loadModelData,
} from '@/lib/model-loader'
import { routeToCase, type RouteCandidate } from '@/lib/v2-case-router'
import { LensId } from '../schemas'
import {
  listCases,
  createDiagnosisRuntime,
  ProjectionStore,
  type DiagnosisRuntime,
} from './v2'

const DATA_VERSION = '2.0'
const EVENT_CADENCE_MS = 700

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [model] = useState(loadModelData)
  const [activeLens, setActiveLens] = useState(LensId.TOPOLOGY)
  const [activePreset, setActivePreset] = useState(model.initialPreset)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [objectSetFilter, setObjectSetFilter] = useState(false)
  const [aroundRootId, setAroundRootId] = useState<string | null>(null)
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    topology: true,
    knowledge: true,
  })
  const [expandedDevices, setExpandedDevices] = useState<Record<string, boolean>>({})
  const [visibleDomains, setVisibleDomains] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(model.domains.map((domain) => [domain.code, true])),
  )
  const [visibleKgLayers, setVisibleKgLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(model.kgLayers.map((layer) => [layer.code, true])),
  )
  const [showCrossLayer, setShowCrossLayer] = useState(false)

  // V2 runtime + projection state.
  const [runtime, setRuntime] = useState<DiagnosisRuntime | null>(null)
  const runtimeRef = useRef<DiagnosisRuntime | null>(null)
  runtimeRef.current = runtime
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  const [routeCandidates, setRouteCandidates] = useState<RouteCandidate[] | null>(null)

  // user_selection (Projection-only; never written by Runtime).
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null)
  // userExploring: user has taken the camera; new agent events must not grab it.
  const [userExploring, setUserExploring] = useState(false)

  const snapshot = runtime?.snapshot ?? null
  const agentFocus = snapshot?.session.agent_focus

  const objectSet = useMemo(
    () => model.registry.objectSet({ text: searchQuery, lens: activeLens }, undefined),
    [activeLens, model.registry, searchQuery],
  )

  const restrictedObjectIds = useMemo(() => {
    if (aroundRootId) {
      return new Set(
        model.registry
          .searchAround(aroundRootId, 1, activeLens, undefined)
          .objects.map((object) => object.id),
      )
    }
    if (objectSetFilter && searchQuery.trim()) {
      return new Set(objectSet.objects.map((object) => object.id))
    }
    return undefined
  }, [
    activeLens,
    aroundRootId,
    model.registry,
    objectSet.objects,
    objectSetFilter,
    searchQuery,
  ])

  // D3 关键对象保留：agent_focus ∪ 根因（docs/05 §6 DETACHED_CRITICAL）。
  // 仅依赖 snapshot，避免与 graphData 形成循环依赖。
  const criticalObjectIds = useMemo(() => {
    const ids = new Set<string>(agentFocus?.object_refs ?? [])
    const c = snapshot?.conclusion
    if (c) {
      if (c.root_cause?.object_id) ids.add(c.root_cause.object_id)
      for (const id of c.root_cause_chain ?? []) ids.add(id)
    }
    return ids
  }, [agentFocus, snapshot?.conclusion])

  const graphData = useMemo(
    () =>
      buildActiveGraph(model, {
        lens: activeLens,
        overlay: undefined,
        layerTopology: layerVisibility.topology,
        layerKnowledge: layerVisibility.knowledge,
        visibleDomains,
        visibleKgLayers,
        showCrossLayer,
        objectIds: restrictedObjectIds,
        expandedDeviceIds: new Set(Object.keys(expandedDevices).filter((k) => expandedDevices[k])),
        criticalObjectIds,
      }),
    [
      activeLens,
      layerVisibility,
      model,
      restrictedObjectIds,
      showCrossLayer,
      visibleDomains,
      visibleKgLayers,
      expandedDevices,
      criticalObjectIds,
    ],
  )

  const graphNodesById = useMemo(
    () => new Map(graphData.nodes.map((node) => [node.id, node])),
    [graphData.nodes],
  )

  const selectedObjectView = selectedNodeId && !runtime
    ? model.registry.objectView(selectedNodeId, activeLens, undefined, undefined)
    : null

  // agent_focus → canvas node ids (Runtime-driven highlight).
  const agentFocusIds = useMemo(() => {
    const refs = agentFocus?.object_refs ?? []
    return new Set(refs.filter((id) => graphNodesById.has(id)))
  }, [agentFocus, graphNodesById])

  // Runtime conclusion → 画布节点状态叠加集（docs/04 §8 ROOT_CAUSE / IMPACTED）。
  const rootCauseIds = useMemo(() => {
    const ids = new Set<string>()
    const c = snapshot?.conclusion
    if (c) {
      if (c.root_cause?.object_id) ids.add(c.root_cause.object_id)
      for (const id of c.root_cause_chain ?? []) ids.add(id)
    }
    return ids
  }, [snapshot?.conclusion])

  const impactedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of snapshot?.conclusion?.impact_chain ?? []) ids.add(id)
    return ids
  }, [snapshot?.conclusion])

  // Camera target: user node while exploring, agent node otherwise. App owns
  // this decision so DualPlaneCanvas never grabs the camera on agent events
  // while the user is browsing (docs/04 §5).
  const agentFocusPrimaryId = useMemo(() => {
    const refs = agentFocus?.object_refs ?? []
    return refs.find((id) => graphNodesById.has(id)) ?? null
  }, [agentFocus, graphNodesById])
  const focusNodeId = userExploring ? selectedNodeId : agentFocusPrimaryId

  // LIVE auto-advance. advance() appends the next authored Runtime Event — the
  // sole diagnosis-state write.
  useEffect(() => {
    if (!isPlaying || !runtime || runtime.complete) {
      if (runtime?.complete) setIsPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      setRuntime((current) => (current ? current.advance() : current))
    }, EVENT_CADENCE_MS / playbackSpeed)
    return () => window.clearTimeout(timer)
  }, [runtime, isPlaying, playbackSpeed])

  const handleLensChange = (lens: LensId) => {
    setActiveLens(lens)
    setAroundRootId(null)
    setObjectSetFilter(false)
    if (lens === LensId.TOPOLOGY) setActivePreset('TOPOLOGY_ONLY')
    else if (lens === LensId.KNOWLEDGE) setActivePreset('KNOWLEDGE_ONLY')
    else setActivePreset('OVERVIEW')
  }

  const startSession = (caseId: string, note: string | null) => {
    try {
      const created = createDiagnosisRuntime(caseId).advance()
      setRuntime(created)
      setSelectedCandidateId(null)
      setSelectedFactId(null)
      setSelectedNodeId(null)
      setUserExploring(false)
      setActiveLens(LensId.DIAGNOSIS)
      setActivePreset('OVERVIEW')
      setIsPlaying(true)
      setRouteCandidates(null)
      setRouteError(null)
      setRouteNote(note)
    } catch (error) {
      setRouteError(
        `诊断会话初始化失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const handleStartDiagnosis = (payload: DiagnosisEntryPayload) => {
    setRouteError(null)
    setRouteNote(null)
    setRouteCandidates(null)
    const route = routeToCase(payload.symptom, payload.business_scope)
    if (route.status === 'UNIQUE_MATCH' && route.caseId) {
      startSession(route.caseId, null)
    } else if (route.status === 'AMBIGUOUS') {
      // 现象可匹配多个 Case：交由用户选择，不猜测（docs/13 §9.4）。
      setRouteCandidates(route.candidates)
    } else {
      setRouteError(route.error_code ? `[${route.error_code}] ${route.reason}` : route.reason)
    }
  }

  const handleSelectRoutedCase = (caseId: string) => {
    startSession(caseId, '由用户在歧义路由中显式选择')
  }

  const handleExitDiagnosis = () => {
    setIsPlaying(false)
    setRuntime(null)
    setSelectedCandidateId(null)
    setSelectedFactId(null)
    setSelectedNodeId(null)
    setUserExploring(false)
    setActiveLens(LensId.TOPOLOGY)
  }

  const handleSeek = useCallback((sequence: number) => {
    setIsPlaying(false)
    setRuntime((current) => (current ? current.seek(sequence) : current))
  }, [])

  const handleReturnLive = useCallback(() => {
    setRuntime((current) => (current ? current.returnLive() : current))
  }, [])

  const handlePlayPause = useCallback(() => {
    // Resuming from a historical cursor snaps back to live first.
    const current = runtimeRef.current
    if (current && current.isHistorical) {
      setRuntime(current.returnLive())
    }
    setIsPlaying((value) => !value)
  }, [])

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed)
  }, [])

  const handleStep = useCallback(() => {
    setRuntime((current) => (current ? current.advance() : current))
  }, [])

  const handleCandidateSelect = (id: string | null) => {
    setSelectedCandidateId(id)
    if (id) {
      // Selecting a candidate is a user browse action → exploration on.
      setUserExploring(true)
    }
  }

  // Canvas / navigator node selection is a pure user_selection update.
  const handleNodeSelect = (id: string | null) => {
    setSelectedNodeId(id)
    setUserExploring(true)
    // D3 设备级聚合：点击设备聚合节点切换展开/收起（成员局部显露，不重新洗牌）。
    if (id && model.deviceGroups.some((g) => g.deviceId === id)) {
      setExpandedDevices((cur) => ({ ...cur, [id]: !cur[id] }))
    }
  }

  const handleSearchSelect = (id: string) => {
    setSelectedNodeId(id)
    setUserExploring(true)
  }

  const handleReturnAgentView = () => {
    setUserExploring(false)
  }

  const handleSearchAround = () => {
    if (!selectedNodeId) return
    setAroundRootId(selectedNodeId)
    setObjectSetFilter(false)
  }

  const clearRestriction = () => {
    setAroundRootId(null)
    setObjectSetFilter(false)
  }

  const businessPath = activePreset === 'BUSINESS_PATH' || activeLens === LensId.IMPACT

  // Derived session display state.
  const isHistorical = runtime?.isHistorical ?? false
  const liveHead = runtime?.liveHead ?? 0
  const cursor = runtime?.cursor ?? 0
  const totalEvents = runtime?.events.length ?? 0
  const displayMode: 'LIVE' | 'PAUSED' | 'REPLAY' = isHistorical
    ? 'REPLAY'
    : isPlaying
      ? 'LIVE'
      : 'PAUSED'
  const phaseLabel = snapshot?.session.phase
    ? phaseLabelOf(snapshot.session.phase)
    : '模型探索态'

  // Projection store → View Models (read-only consumption of the snapshot).
  const vms = useMemo(() => {
    if (!snapshot) return null
    const store = new ProjectionStore()
    store.bind(snapshot)
    return {
      store,
      knowledge: store.knowledgeSnapshot(),
      action: store.currentAction(),
      candidates: store.candidateList(),
      timeline: store.timeline(),
    }
  }, [snapshot])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0f1117] text-[#e2e8f0]">
      <div className="mobile-viewport-notice" role="status">
        <Radar className="h-5 w-5 text-status-active" />
        <strong>需要桌面视口</strong>
        <span>3D 双平面诊断工作台建议在至少 1024px 宽的窗口中使用。</span>
      </div>
      <DualPlaneCanvas
        graphData={graphData}
        model={model}
        activePreset={activePreset}
        focusNodeId={focusNodeId}
        agentFocusIds={agentFocusIds}
        rootCauseIds={rootCauseIds}
        impactedIds={impactedIds}
        selectedNodeId={selectedNodeId}
        showCrossLayer={showCrossLayer}
        businessPath={businessPath}
        onNodeSelect={handleNodeSelect}
        onNodeHover={() => undefined}
      />

      <ModelNavigator
        model={model}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        layerVisibility={layerVisibility}
        onToggleLayer={(plane) =>
          setLayerVisibility((value) => ({ ...value, [plane]: !value[plane] }))
        }
        visibleDomains={visibleDomains}
        onToggleDomain={(code) =>
          setVisibleDomains((value) => ({ ...value, [code]: value[code] === false }))
        }
        visibleKgLayers={visibleKgLayers}
        onToggleKgLayer={(code) =>
          setVisibleKgLayers((value) => ({ ...value, [code]: value[code] === false }))
        }
        showCrossLayer={showCrossLayer}
        onToggleCrossLayer={() => setShowCrossLayer((value) => !value)}
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value)
          if (!value) setObjectSetFilter(false)
        }}
        objectSet={objectSet}
        objectSetFilter={objectSetFilter}
        onToggleObjectSet={() => setObjectSetFilter((value) => !value)}
        aroundRootId={aroundRootId}
        onClearRestriction={clearRestriction}
        onSearchSelect={handleSearchSelect}
        selectedNodeId={selectedNodeId}
      />

      <header className="ontology-header pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-[#11141c]/92 px-4 py-2 shadow-2xl backdrop-blur-md">
          <Radar className="h-4 w-4 text-status-active" />
          <span className="text-[13px] font-semibold tracking-wide">
            Fault Operations Ontology
          </span>
          <span className="h-4 w-px bg-white/10" />
          <span className="flex items-center gap-1.5 text-[10px] text-[#94a3b8]">
            <Database className="h-3 w-3" />
            Runtime v{DATA_VERSION}
          </span>
          <span className="flex items-center gap-1.5 rounded bg-status-active/15 px-2 py-1 text-[10px]">
            <Eye className="h-3 w-3 text-status-active" />
            {phaseLabel}
          </span>
        </div>
      </header>

      <LensSwitcher activeLens={activeLens} onChange={handleLensChange} />

      {selectedObjectView && (
        <ObjectViewPanel
          view={selectedObjectView}
          onClose={() => setSelectedNodeId(null)}
          onSelectObject={handleSearchSelect}
          onSearchAround={handleSearchAround}
        />
      )}

      {routeError && (
        <div className="absolute left-1/2 top-[118px] z-50 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-lg border border-status-fault/30 bg-[#24191d]/95 px-3 py-2 text-[12px] text-status-fault shadow-xl">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{routeError}</span>
          <button type="button" onClick={() => setRouteError(null)} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {routeCandidates && (
        <div className="absolute left-1/2 top-[118px] z-50 flex max-w-md -translate-x-1/2 flex-col gap-1.5 rounded-lg border border-status-active/30 bg-[#11141c]/95 px-3 py-2.5 text-[12px] shadow-xl">
          <div className="flex items-center gap-2 text-[#cbd5e1]">
            <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning" />
            <span className="flex-1">现象可匹配多个故障场景，请选择最接近的一个：</span>
            <button
              type="button"
              onClick={() => setRouteCandidates(null)}
              aria-label="关闭"
              className="text-[#64748b] transition-colors hover:text-[#cbd5e1]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {routeCandidates.map((c) => (
            <button
              key={c.caseId}
              type="button"
              onClick={() => handleSelectRoutedCase(c.caseId)}
              className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-status-active/50 hover:bg-status-active/10"
            >
              <span className="flex-1">
                <span className="block text-[12px] font-medium text-[#e2e8f0]">{c.name}</span>
                <span className="block text-[10px] text-[#64748b]">
                  route_score {c.score} · {c.explanation}
                </span>
              </span>
              <span className="ml-2 shrink-0 text-[10px] text-status-active">选择 →</span>
            </button>
          ))}
        </div>
      )}

      {runtime && vms && snapshot && (
        <LuiPanel
          knowledge={vms.knowledge}
          action={vms.action}
          candidates={vms.candidates}
          snapshot={snapshot}
          store={vms.store}
          timelineEvents={vms.timeline}
          replayBookmarks={snapshot?.replay_bookmarks ?? []}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={handleCandidateSelect}
          selectedFactId={selectedFactId}
          onSelectFact={setSelectedFactId}
          mode={displayMode}
          cursor={cursor}
          liveHead={liveHead}
          totalEvents={totalEvents}
          isPlaying={isPlaying}
          caseEntry={listCases().find((c) => c.caseId === runtime.caseId) ?? null}
          onPlayPause={handlePlayPause}
          onStep={handleStep}
          onSpeedChange={handleSpeedChange}
          playbackSpeed={playbackSpeed}
          onSeek={handleSeek}
          onReturnLive={handleReturnLive}
          onReturnAgentView={handleReturnAgentView}
          onExit={handleExitDiagnosis}
          routeNote={routeNote}
        />
      )}

      {!runtime && <DiagnosisEntryButton onStartDiagnosis={handleStartDiagnosis} />}
    </div>
  )
}

function phaseLabelOf(phase: string): string {
  const map: Record<string, string> = {
    INPUT_COMPLETION: '输入补全',
    SYMPTOM_VALIDATION: '现象校验',
    SCOPE_LOCALIZATION: '范围定位',
    CANDIDATE_GENERATION: '候选生成',
    CANDIDATE_EVIDENCE: '候选取证',
    COMPETING_EXPLANATION: '竞争解释',
    CONCLUSION_CHECK: '终态门控',
    SUPPLEMENTARY_PLANNING: '补充规划',
  }
  return map[phase] ?? phase
}
