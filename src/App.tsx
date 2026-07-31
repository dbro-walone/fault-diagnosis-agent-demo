import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Eye, Radar, X } from 'lucide-react'

import DiagnosisEntryButton, {
  type DiagnosisEntryPayload,
} from '@/components/DiagnosisEntryButton'
import DiagnosisPanel from '@/components/DiagnosisPanel'
import DualPlaneCanvas from '@/components/DualPlaneCanvas'
import LensSwitcher from '@/components/LensSwitcher'
import ModelNavigator, { type LayerVisibility } from '@/components/ModelNavigator'
import ObjectViewPanel from '@/components/ObjectViewPanel'
import { loadCase } from '@/lib/case-loader'
import { routeCase } from '@/lib/case-router'
import {
  buildActiveGraph,
  loadModelData,
  type GraphNode,
} from '@/lib/model-loader'
import { normalizeSymptom } from '@/lib/symptom-normalizer'
import { returnToLive, stepPlayback } from '@/lib/playback-controller'
import {
  createDiagnosisEngine,
  type DiagnosisEngine,
} from '@/runtime/diagnosis-engine'
import {
  DiagnosisPhase,
  LensId,
  RouteStatus,
  type ObjectSet,
} from '../schemas'

const DATA_VERSION = '2.0.0'
const EVENT_CADENCE_MS = 650

const PHASE_LABEL: Record<DiagnosisPhase, string> = {
  [DiagnosisPhase.MODEL_OVERVIEW]: '模型探索态',
  [DiagnosisPhase.SESSION_INITIALIZING]: 'Scenario 初始化',
  [DiagnosisPhase.SCOPE_LOCALIZATION]: '范围定位',
  [DiagnosisPhase.CANDIDATE_GENERATION]: '候选生成',
  [DiagnosisPhase.EVIDENCE_COLLECTION]: '证据取证',
  [DiagnosisPhase.COMPETING_EXPLANATION]: '竞争解释检查',
  [DiagnosisPhase.CONCLUSION_CHECK]: '终态门控',
  [DiagnosisPhase.DIAGNOSIS_REVIEW]: '诊断复盘',
}

export default function App() {
  const [model] = useState(loadModelData)
  const [activeLens, setActiveLens] = useState(LensId.TOPOLOGY)
  const [activePreset, setActivePreset] = useState(model.initialPreset)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [objectSetFilter, setObjectSetFilter] = useState(false)
  const [aroundRootId, setAroundRootId] = useState<string | null>(null)
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    topology: true,
    knowledge: true,
  })
  const [visibleDomains, setVisibleDomains] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(model.domains.map((domain) => [domain.code, true])),
  )
  const [visibleKgLayers, setVisibleKgLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(model.kgLayers.map((layer) => [layer.code, true])),
  )
  const [showCrossLayer, setShowCrossLayer] = useState(false)

  const [engine, setEngine] = useState<DiagnosisEngine | null>(null)
  const engineRef = useRef<DiagnosisEngine | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)

  engineRef.current = engine
  const session = engine?.session ?? null
  const overlay = session?.overlay

  const objectSet = useMemo<ObjectSet>(
    () =>
      model.registry.objectSet(
        { text: searchQuery, lens: activeLens },
        overlay,
      ),
    [activeLens, model.registry, overlay, searchQuery],
  )

  const restrictedObjectIds = useMemo(() => {
    if (aroundRootId) {
      return new Set(
        model.registry
          .searchAround(aroundRootId, 1, activeLens, overlay)
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
    overlay,
    searchQuery,
  ])

  const graphData = useMemo(
    () =>
      buildActiveGraph(model, {
        lens: activeLens,
        overlay,
        layerTopology: layerVisibility.topology,
        layerKnowledge: layerVisibility.knowledge,
        visibleDomains,
        visibleKgLayers,
        showCrossLayer,
        objectIds: restrictedObjectIds,
      }),
    [
      activeLens,
      layerVisibility,
      model,
      overlay,
      restrictedObjectIds,
      showCrossLayer,
      visibleDomains,
      visibleKgLayers,
    ],
  )

  const graphNodesById = useMemo(
    () => new Map(graphData.nodes.map((node) => [node.id, node])),
    [graphData.nodes],
  )

  const selectedObjectView = selectedNodeId
    ? model.registry.objectView(selectedNodeId, activeLens, overlay, engine?.catalog)
    : null

  useEffect(() => {
    if (!isPlaying || !engine || engine.complete) {
      if (engine?.complete) setIsPlaying(false)
      return
    }
    // The timer controls playback cadence only. `advance()` appends the next
    // authored Runtime Event, which remains the sole diagnosis-state write.
    const timer = window.setTimeout(() => {
      setEngine((current) => (current ? current.advance() : current))
    }, EVENT_CADENCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, isPlaying])

  const handleLensChange = (lens: LensId) => {
    setActiveLens(lens)
    setAroundRootId(null)
    setObjectSetFilter(false)
    if (lens === LensId.TOPOLOGY) setActivePreset('TOPOLOGY_ONLY')
    else if (lens === LensId.KNOWLEDGE) setActivePreset('KNOWLEDGE_ONLY')
    else setActivePreset('OVERVIEW')
  }

  const handleStartDiagnosis = async (payload: DiagnosisEntryPayload) => {
    setRouteError(null)
    const normalized = normalizeSymptom(payload.symptom, {
      occurredAt: payload.occurred_at,
      businessScope: payload.business_scope,
    })
    const route = routeCase(normalized)
    if (route.status !== RouteStatus.MATCHED || !route.caseId) {
      setRouteError(route.reason)
      return
    }
    try {
      const bundle = await loadCase(route.caseId)
      const created = createDiagnosisEngine(bundle.scenario, normalized).advance()
      setEngine(created)
      setSelectedCandidateId(null)
      setActiveLens(LensId.DIAGNOSIS)
      setActivePreset('OVERVIEW')
      setIsPlaying(true)
    } catch (error) {
      setRouteError(
        `Scenario 初始化失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const handleExitDiagnosis = () => {
    setIsPlaying(false)
    setEngine(null)
    setSelectedCandidateId(null)
    setActiveLens(LensId.TOPOLOGY)
    setSelectedNodeId(null)
    setAroundRootId(null)
  }

  const handleSeek = useCallback((sequence: number) => {
    setIsPlaying(false)
    setEngine((current) => (current ? current.seek(sequence) : current))
  }, [])

  const handleReturnCurrent = () => {
    const current = engineRef.current
    if (!current) return
    setEngine(returnToLive(current))
  }

  const handleCandidateSelect = (id: string | null) => {
    setSelectedCandidateId(id)
    if (id) {
      setSelectedNodeId(id)
      setFocusNodeId(id)
      setActiveLens(LensId.DIAGNOSIS)
    }
  }

  const handleSearchSelect = (id: string) => {
    setSelectedNodeId(id)
    setFocusNodeId(id)
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

  const phase = session?.phase ?? DiagnosisPhase.MODEL_OVERVIEW
  const businessPath = activePreset === 'BUSINESS_PATH' || activeLens === LensId.IMPACT

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
        focusNode={focusNodeId ? graphNodesById.get(focusNodeId) ?? null : null}
        selectedNodeId={selectedNodeId}
        showCrossLayer={showCrossLayer}
        businessPath={businessPath}
        onNodeSelect={setSelectedNodeId}
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
            Registry v{DATA_VERSION}
          </span>
          <span className="flex items-center gap-1.5 rounded bg-status-active/15 px-2 py-1 text-[10px]">
            <Eye className="h-3 w-3 text-status-active" />
            {PHASE_LABEL[phase]}
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

      <DiagnosisPanel
        session={session}
        definition={engine?.definition ?? null}
        liveEvents={engine?.liveEvents ?? []}
        liveHead={engine?.liveHead ?? 0}
        isHistorical={engine?.isHistorical ?? false}
        isPlaying={isPlaying}
        selectedCandidateId={selectedCandidateId}
        onSelectCandidate={handleCandidateSelect}
        onPlayPause={() => setIsPlaying((value) => !value)}
        onStep={() => setEngine((current) => (current ? stepPlayback(current) : current))}
        onSeek={handleSeek}
        onReturnCurrent={handleReturnCurrent}
        onExit={handleExitDiagnosis}
      />

      {!engine && <DiagnosisEntryButton onStartDiagnosis={handleStartDiagnosis} />}
    </div>
  )
}
