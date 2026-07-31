import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Radar, Database, Eye, AlertTriangle, X } from 'lucide-react'

import ModelNavigator, { type LayerVisibility } from '@/components/ModelNavigator'
import DualPlaneCanvas from '@/components/DualPlaneCanvas'
import DiagnosisEntryButton, {
  type DiagnosisEntryPayload,
} from '@/components/DiagnosisEntryButton'
import DiagnosisPanel from '@/components/DiagnosisPanel'
import { buildActiveGraph, loadModelData, type GraphNode } from '@/lib/model-loader'
import { normalizeSymptom } from '@/lib/symptom-normalizer'
import { routeCase } from '@/lib/case-router'
import { loadCase } from '@/lib/case-loader'
import {
  createDiagnosisEngine,
  createContextFromEngine,
  runRound,
  type EngineContext,
} from '@/runtime/diagnosis-engine'
import { TOTAL_ROUNDS } from '@/runtime/planner'
import { RouteStatus, type DiagnosisSession, type RuntimeEvent } from '../schemas'

/**
 * Top-level shell. The first screen is always the model-exploration state
 * (铁律 #1): a full-bleed dual-plane WebGL canvas with floating glass panels —
 * the navigator on the left, a title/phase header at the top, and the diagnosis
 * entry button at the bottom-right. All diagnosis state is owned here and only
 * ever advanced by Runtime events; the view components render what they're given
 * (铁律 #2).
 */

/** Schema version baked into every model JSON (each declares `1.0.0`). */
const DATA_VERSION = '1.0.0'

/** Delay between diagnostic rounds — the "animation" cadence of the推演. */
const ROUND_INTERVAL_MS = 2000

/**
 * Demo phases following the four-stage main line. MODEL_OVERVIEW and
 * DIAGNOSIS_INPUT are user-driven; DIAGNOSIS_RUNNING / DIAGNOSIS_CONCLUDED are
 * advanced by Runtime events (铁律 — diagnosis state only moves on events).
 */
type DiagnosisPhase =
  | 'MODEL_OVERVIEW'
  | 'DIAGNOSIS_INPUT'
  | 'DIAGNOSIS_RUNNING'
  | 'DIAGNOSIS_CONCLUDED'

const PHASE_LABEL: Record<DiagnosisPhase, string> = {
  MODEL_OVERVIEW: '模型探索态',
  DIAGNOSIS_INPUT: '诊断录入',
  DIAGNOSIS_RUNNING: '诊断推演',
  DIAGNOSIS_CONCLUDED: '诊断结论',
}

/**
 * Produce an immutable snapshot of a Runtime session for React state. The engine
 * mutates its session in place across rounds; cloning the top-level object and
 * its arrays gives a new reference per round so React re-renders, while every
 * value still originates from the Runtime (the frontend never computes scores).
 */
function snapshotSession(s: DiagnosisSession): DiagnosisSession {
  return {
    ...s,
    candidates: s.candidates.map((c) => ({ ...c, evidenceIds: [...c.evidenceIds] })),
    evidence: [...s.evidence],
    facts: [...s.facts],
    plans: s.plans.map((p) => ({ ...p, tasks: [...p.tasks] })),
    events: [...s.events],
  }
}

export default function App() {
  // Model assets are imported at module time; loadModelData is synchronous and
  // cached, so a lazy initializer loads them once before first paint.
  const [model] = useState(loadModelData)

  // --- model-exploration state (never mutates diagnosis state) -------------
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activePreset, setActivePreset] = useState(model.initialPreset)

  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    topology: true,
    knowledge: true,
  })
  const [visibleDomains, setVisibleDomains] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(model.domains.map((d) => [d.code, true])),
  )
  const [visibleKgLayers, setVisibleKgLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(model.kgLayers.map((l) => [l.code, true])),
  )
  const [showCrossLayer, setShowCrossLayer] = useState(false)

  // --- diagnosis phase (beyond manual entry, only Runtime events change it) --
  const [diagnosisPhase, setDiagnosisPhase] = useState<DiagnosisPhase>('MODEL_OVERVIEW')
  /** Runtime-built session snapshot; null while in pure model exploration. */
  const [session, setSession] = useState<DiagnosisSession | null>(null)
  /** Mirrored event stream for the timeline. */
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  /** Selected candidate id in the candidate panel (view-only selection). */
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  /** Routing / init failure message shown as a dismissible banner. */
  const [routeError, setRouteError] = useState<string | null>(null)

  // --- runtime engine refs (kept out of React state — mutated per round) ----
  const ctxRef = useRef<EngineContext | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // --- derived active subgraph --------------------------------------------
  const graphData = useMemo(
    () =>
      buildActiveGraph(model, {
        layerTopology: layerVisibility.topology,
        layerKnowledge: layerVisibility.knowledge,
        visibleDomains,
        visibleKgLayers,
        showCrossLayer,
      }),
    [model, layerVisibility, visibleDomains, visibleKgLayers, showCrossLayer],
  )

  /** The BUSINESS_PATH preset drives end-to-end path highlighting on the canvas. */
  const businessPath = activePreset === 'BUSINESS_PATH'

  const searchResults = useMemo<GraphNode[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return model.nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.kind.toLowerCase().includes(q) ||
          n.groupName.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q),
      )
      .slice(0, 20)
  }, [model.nodes, searchQuery])

  // --- diagnosis round orchestration --------------------------------------

  const stopRounds = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  /** Run one diagnostic round, snapshot the session, and stop if terminal. */
  const runOneRound = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    runRound(ctx)
    setSession(snapshotSession(ctx.session))
    setEvents([...ctx.events])
    // Terminal: conclusion resolved, or the engine has run every round.
    if (ctx.session.conclusion !== null || ctx.currentRound >= TOTAL_ROUNDS) {
      stopRounds()
      setDiagnosisPhase('DIAGNOSIS_CONCLUDED')
    }
  }, [stopRounds])

  // Clear the round interval if the shell unmounts.
  useEffect(() => () => stopRounds(), [stopRounds])

  // --- handlers -----------------------------------------------------------
  const handleToggleLayer = (plane: 'topology' | 'knowledge') =>
    setLayerVisibility((v) => ({ ...v, [plane]: !v[plane] }))

  const handleToggleDomain = (code: string) =>
    setVisibleDomains((m) => ({ ...m, [code]: m[code] === false }))

  const handleToggleKgLayer = (code: string) =>
    setVisibleKgLayers((m) => ({ ...m, [code]: m[code] === false }))

  const handleSearchSelect = (id: string) => {
    setSelectedNodeId(id)
    setFocusNodeId(id)
  }

  /**
   * Diagnosis entry pipeline (产品主线 §2, 铁律 #7):
   *   SymptomNormalizer → CaseRouter → CaseLoader → Engine → animated rounds.
   * The view never keyword-matches a Case itself.
   */
  const handleStartDiagnosis = async (payload: DiagnosisEntryPayload) => {
    setRouteError(null)

    // 1. Normalize the free-text symptom into a stable structured form.
    const normalized = normalizeSymptom(payload.symptom)

    // 2. Route the normalized symptom to a Case (no root-cause peeking).
    const route = routeCase(normalized)
    if (route.status !== RouteStatus.MATCHED || !route.caseId) {
      setRouteError(route.reason || '当前输入无法匹配诊断场景，请补充更具体的现象描述')
      setDiagnosisPhase('DIAGNOSIS_INPUT')
      return
    }

    try {
      // 3. Load the Case bundle (observations drive the mock Skills).
      const bundle = await loadCase(route.caseId)

      // 4. Create the engine + a mutable context reused across every round.
      const engine = createDiagnosisEngine(bundle.caseId, bundle.observations)
      const ctx = createContextFromEngine(engine)
      ctxRef.current = ctx

      // 5. Enter the推演 phase with a fresh session snapshot.
      setSelectedCandidateId(null)
      setSession(snapshotSession(ctx.session))
      setEvents([...ctx.events])
      setDiagnosisPhase('DIAGNOSIS_RUNNING')

      // 6. Run the first round immediately, then advance on an interval so the
      //    Planner→Skill→Fact→Evidence→Candidate chain plays back gradually.
      stopRounds()
      runOneRound()
      intervalRef.current = setInterval(runOneRound, ROUND_INTERVAL_MS)
    } catch (err) {
      setRouteError(
        `诊断引擎初始化失败：${err instanceof Error ? err.message : String(err)}`,
      )
      setDiagnosisPhase('DIAGNOSIS_INPUT')
    }
  }

  /** Leave the diagnosis workspace and return to pure model exploration. */
  const handleExitDiagnosis = () => {
    stopRounds()
    ctxRef.current = null
    setSession(null)
    setEvents([])
    setSelectedCandidateId(null)
    setRouteError(null)
    setDiagnosisPhase('MODEL_OVERVIEW')
  }

  const diagnosisActive = session !== null

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0f1117] text-[#e2e8f0]">
      {/* Center: full-bleed dual-plane WebGL canvas (sits behind every panel) */}
      <DualPlaneCanvas
        graphData={graphData}
        model={model}
        activePreset={activePreset}
        focusNodeId={focusNodeId}
        selectedNodeId={selectedNodeId}
        showCrossLayer={showCrossLayer}
        businessPath={businessPath}
        onNodeSelect={setSelectedNodeId}
        onNodeHover={() => {}}
      />

      {/* Left: floating model navigator (self-positions at left-4 / top-4) */}
      <ModelNavigator
        model={model}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        layerVisibility={layerVisibility}
        onToggleLayer={handleToggleLayer}
        visibleDomains={visibleDomains}
        onToggleDomain={handleToggleDomain}
        visibleKgLayers={visibleKgLayers}
        onToggleKgLayer={handleToggleKgLayer}
        showCrossLayer={showCrossLayer}
        onToggleCrossLayer={() => setShowCrossLayer((v) => !v)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchResults={searchResults}
        onSearchSelect={handleSearchSelect}
        selectedNodeId={selectedNodeId}
      />

      {/* Top: title + data version + phase badge */}
      <header className="pointer-events-none absolute left-1/2 top-5 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-[#11141c]/90 px-4 py-2 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-status-active" />
            <span className="text-[13px] font-semibold tracking-wide text-[#e2e8f0]">
              故障诊断 Agent
            </span>
          </div>
          <span className="h-4 w-px bg-white/10" />
          <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-[#94a3b8]">
            <Database className="h-3 w-3" />
            模型数据 v{DATA_VERSION}
          </span>
          <span
            className="flex items-center gap-1.5 rounded-full bg-status-active/15 px-2.5 py-1 text-[10px] text-[#cbd5e1]"
            title={diagnosisPhase}
          >
            <Eye className="h-3 w-3 text-status-active" />
            {PHASE_LABEL[diagnosisPhase]}
          </span>
        </div>
      </header>

      {/* Routing / init error banner */}
      {routeError && (
        <div className="pointer-events-auto absolute left-1/2 top-20 z-50 flex max-w-md items-start gap-2 rounded-lg border border-status-fault/30 bg-status-fault/10 px-3 py-2 text-[12px] text-status-fault shadow-xl backdrop-blur-md">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{routeError}</span>
          <button
            type="button"
            onClick={() => setRouteError(null)}
            className="shrink-0 text-status-fault/70 transition-colors hover:text-status-fault"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Diagnosis workspace — gated internally by session presence (铁律 #1) */}
      <DiagnosisPanel
        session={session}
        events={events}
        phase={PHASE_LABEL[diagnosisPhase]}
        totalRounds={TOTAL_ROUNDS}
        selectedCandidateId={selectedCandidateId}
        onSelectCandidate={setSelectedCandidateId}
        onExit={handleExitDiagnosis}
      />

      {/* Bottom-right: diagnosis entry (hidden while a session is active) */}
      {!diagnosisActive && <DiagnosisEntryButton onStartDiagnosis={handleStartDiagnosis} />}
    </div>
  )
}
