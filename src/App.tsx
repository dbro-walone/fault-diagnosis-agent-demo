import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Radar, X } from 'lucide-react'

import DiagnosisEntryButton, {
  type DiagnosisEntryPayload,
} from '@/components/DiagnosisEntryButton'
import Layered3DCanvas from '@/components/Layered3DCanvas'
import LuiPanel from '@/components/LuiPanel'
import ModelNavigator, {
  type LayerVisibility,
} from '@/components/ModelNavigator'
import ObjectViewPanel from '@/components/ObjectViewPanel'
import {
  buildLayeredModelData,
  type TopoLayerCode,
} from '@/lib/layered-topology'
import { loadModelData } from '@/lib/model-loader'
import { routeToCase } from '@/lib/v2-case-router'
import { LensId } from '../schemas'
import {
  listCases,
  createDiagnosisRuntime,
  loadAdaptedCase,
  ProjectionStore,
  activeDiagnosisPath,
  type DiagnosisRuntime,
} from './v2'

const EVENT_CADENCE_MS = 700

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [model] = useState(loadModelData)
  // 分层视图可加载任意 Case（issue #4「兼而有之」）：切 Case 重建模型。
  const [layeredCaseId, setLayeredCaseId] = useState('layered_topology_demo_001')
  const layeredModel = useMemo(() => buildLayeredModelData(layeredCaseId), [layeredCaseId])
  const [activeLens, setActiveLens] = useState(LensId.TOPOLOGY)
  const [expandedLayers, setExpandedLayers] = useState<Partial<Record<TopoLayerCode, boolean>>>({})
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
  // F0：诊断会话中默认收起左侧 Object Explorer，LUI 宽度放大（issue #5 F0）。
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)

  // issue#7 D：LUI 悬浮在画布右侧；诊断会话中按 LUI 宽度把画布右边界左移避让。
  // LUI 宽 = wide(806px，左侧收起) 或 448px；right-4=16px 外边距 + 16px 间隙。
  const canvasRightInset = runtime ? (leftPanelCollapsed ? 806 : 448) + 32 : 0

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

  // D3 关键对象保留：agent_focus ∪ 根因（docs/05 §6 DETACHED_CRITICAL）。
  // 仅依赖 snapshot，避免与分层图构建形成循环依赖。
  const criticalObjectIds = useMemo(() => {
    const ids = new Set<string>(agentFocus?.object_refs ?? [])
    const c = snapshot?.conclusion
    if (c) {
      if (c.root_cause?.object_id) ids.add(c.root_cause.object_id)
      for (const id of c.root_cause_chain ?? []) ids.add(id)
    }
    return ids
  }, [agentFocus, snapshot?.conclusion])

  // F2 活动逻辑路径（根因起点 → 证据 hop → 影响链）：随快照推进逐步延伸，
  // layered 分层画布用同一路径绘制红色逻辑链（issue #5 F2）。
  const logicPath = useMemo(
    () => (snapshot ? activeDiagnosisPath(snapshot) : []),
    [snapshot],
  )

  // 分层模型节点查找表：agent_focus 等运行时高亮对象以分层模型为准（issue #4）。
  const layeredNodesById = useMemo(
    () => new Map(layeredModel.nodes.map((node) => [node.id, node])),
    [layeredModel],
  )

  // 下层知识图谱数据（静态 model 的 knowledge 平面，稳定引用，供主画布下层使用）。
  const knowledgeNodes = useMemo(
    () => model.nodes.filter((n) => n.plane === 'knowledge'),
    [model],
  )
  const knowledgeLinks = useMemo(
    () => model.links.filter((l) => l.category === 'knowledge'),
    [model],
  )

  // issue#6 阶段C：知识图谱节点/连线参考（供 ProjectionStore 图谱原始点/关联点亮推导）。
  const knowledgeRefs = useMemo(
    () =>
      model.nodes
        .filter((n) => n.plane === 'knowledge')
        .map((n) => ({
          id: n.id,
          layer: n.group,
          node_type:
            typeof n.object.properties.knowledgeKind === 'string'
              ? (n.object.properties.knowledgeKind as string)
              : null,
          code:
            typeof n.object.properties.code === 'string'
              ? (n.object.properties.code as string)
              : null,
          fault_mode_code:
            ((n.object.properties.attributes as Record<string, unknown> | undefined)?.[
              'fault_mode_code'
            ] as string | undefined) ?? null,
        })),
    [model],
  )
  const knowledgeLinkRefs = useMemo(() => {
    const kgNodeIdSet = new Set(knowledgeRefs.map((n) => n.id))
    return model.links
      .filter((l) => {
        if (l.category === 'knowledge') return true
        // 知识内部跨层映射（如 CASE_MATCH：现象 → 历史案例）并入图谱扩展。
        if (l.category === 'cross') {
          return kgNodeIdSet.has(l.source as string) && kgNodeIdSet.has(l.target as string)
        }
        return false
      })
      .map((l) => ({
        source: l.source as string,
        target: l.target as string,
        relation: l.relation,
      }))
  }, [model, knowledgeRefs])

  const selectedObjectView = selectedNodeId && !runtime
    ? model.registry.objectView(selectedNodeId, activeLens, undefined, undefined)
    : null

  // agent_focus → canvas node ids (Runtime-driven highlight)。
  const agentFocusIds = useMemo(() => {
    const refs = agentFocus?.object_refs ?? []
    return new Set(refs.filter((id) => layeredNodesById.has(id)))
  }, [agentFocus, layeredNodesById])

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

  // 候选根因指向的对象 ids（docs/05 §5 候选数）——layered 聚合共用。
  const candidateObjectIds = useMemo(() => {
    const ids = new Set<string>()
    for (const candidate of snapshot?.candidates ?? []) {
      if (candidate.object_id) ids.add(candidate.object_id)
    }
    return ids
  }, [snapshot?.candidates])

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
      // F0：进入诊断会话自动收起左侧 Object Explorer（退出时恢复）。
      setLeftPanelCollapsed(true)
      // F2：分层视图跟随诊断 Case，使红色逻辑链对象落在当前分层模型中。
      setLayeredCaseId(caseId)
      setExpandedLayers({})
      setRouteError(null)
      setRouteNote(note)
    } catch (error) {
      setRouteError(
        `诊断会话初始化失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 随机选取一个候选执行：AMBIGUOUS 从排名候选中随机，NO_MATCH 同样落到候选（issue #5 B1）。 */
  const pickRandomCandidate = (candidates: Array<{ caseId: string; name: string }>): string | null => {
    if (!candidates.length) return null
    return candidates[Math.floor(Math.random() * candidates.length)].caseId
  }

  const handleStartDiagnosis = (payload: DiagnosisEntryPayload) => {
    setRouteError(null)
    setRouteNote(null)
    const route = routeToCase(payload.symptom, payload.business_scope)
    if (route.status === 'UNIQUE_MATCH' && route.caseId) {
      startSession(route.caseId, null)
    } else {
      // B1：弱输入不弹候选面板 —— 自动随机选一个候选场景执行，不强约束用户补充。
      const picked = pickRandomCandidate(route.candidates)
      if (picked) {
        const entry = route.candidates.find((c) => c.caseId === picked)
        startSession(
          picked,
          route.status === 'AMBIGUOUS'
            ? `现象可匹配多个故障场景，已自动匹配到「${entry?.name ?? picked}」`
            : `未完全识别场景信号，已自动落到「${entry?.name ?? picked}」`,
        )
      } else {
        setRouteError(
          route.error_code ? `[${route.error_code}] ${route.reason}` : route.reason,
        )
      }
    }
  }

  const handleExitDiagnosis = () => {
    setIsPlaying(false)
    setRuntime(null)
    setSelectedCandidateId(null)
    setSelectedFactId(null)
    setSelectedNodeId(null)
    setUserExploring(false)
    setActiveLens(LensId.TOPOLOGY)
    // F0：退出诊断恢复左侧 Object Explorer。
    setLeftPanelCollapsed(false)
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
  // 单击只选中 + 详情（BA-GRAPH-008），绝不改变层级/展开状态/诊断候选。
  const handleNodeSelect = (id: string | null) => {
    setSelectedNodeId(id)
    setUserExploring(true)
  }

  // 双击聚合设备节点 → 展开其直接成员 / 收起（BA-GRAPH-009，局部显露不洗牌）。
  const handleNodeDoubleClick = (id: string) => {
    if (model.deviceGroups.some((g) => g.deviceId === id)) {
      setExpandedDevices((cur) => ({ ...cur, [id]: !cur[id] }))
    }
  }

  // 分层条带：点击层聚合头展开/收起（域或子层，递归）。
  const handleToggleLayer = (code: TopoLayerCode) => {
    setExpandedLayers((cur) => ({ ...cur, [code]: !cur[code] }))
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

  // Projection store → View Models (read-only consumption of the snapshot).
  const vms = useMemo(() => {
    if (!snapshot) return null
    const store = new ProjectionStore()
    // issue#6 阶段B：传入 Case 全量观测 Fact（原始日志/未被证据引用的告警），
    // 供"对象观测三标签"补全 items 内容（快照内已发现 Fact 优先，回放不泄露未来）。
    // issue#6 阶段C：传入知识图谱参考，供"图谱原始点 + 关联知识点点亮"推导。
    store.bind(snapshot, {
      observationsFacts: loadAdaptedCase(runtime?.caseId ?? '').facts,
      knowledgeNodes: knowledgeRefs,
      knowledgeLinks: knowledgeLinkRefs,
    })
    return {
      store,
      knowledge: store.knowledgeSnapshot(),
      candidates: store.candidateList(),
      planner: store.plannerTargets(),
      timeline: store.timeline(),
      scan: store.diagnosisScan(),
    }
  }, [snapshot, runtime, knowledgeRefs, knowledgeLinkRefs])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0f1117] text-[#e2e8f0]">
      <div className="mobile-viewport-notice" role="status">
        <Radar className="h-5 w-5 text-status-active" />
        <strong>需要桌面视口</strong>
        <span>3D 双平面诊断工作台建议在至少 1024px 宽的窗口中使用。</span>
      </div>
      {/* 主画布：3D 力导向双平面（issue #4 方向修正）——
          上层 = S1→S3 空间分层拓扑（Y 域带 + Z 子层带），下层 = 故障知识图谱（X 分层列），
          跨层映射与 F2 红逻辑链均为 3D 连线。 */}
      <Layered3DCanvas
        model={layeredModel}
        expandedLayers={expandedLayers}
        onToggleLayer={handleToggleLayer}
        aggregateContext={{
          criticalIds: criticalObjectIds,
          impactedIds,
          candidateObjectIds,
        }}
        criticalObjectIds={criticalObjectIds}
        agentFocusIds={agentFocusIds}
        rootCauseIds={rootCauseIds}
        impactedIds={impactedIds}
        logicPath={logicPath}
        selectedNodeId={selectedNodeId}
        navigatorCollapsed={leftPanelCollapsed}
        rightInset={canvasRightInset}
        activeLens={activeLens}
        onNodeSelect={handleNodeSelect}
        knowledgeNodes={knowledgeNodes}
        knowledgeLinks={knowledgeLinks}
        visibleKgLayers={visibleKgLayers}
        diagnosisScan={vms?.scan ?? null}
      />

      {/* F0：诊断会话默认收起 Object Explorer；退出/手动展开后恢复 */}
      {!leftPanelCollapsed && (
        <ModelNavigator
          model={model}
          activePreset={activePreset}
          onPresetChange={setActivePreset}
          layerVisibility={layerVisibility}
          onToggleLayer={(plane) =>
            setLayerVisibility((value) => ({ ...value, [plane]: !value[plane] }))
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
          expandedDevices={expandedDevices}
          onToggleDevice={handleNodeDoubleClick}
        />
      )}

      {selectedObjectView && (
        <ObjectViewPanel
          view={selectedObjectView}
          onClose={() => setSelectedNodeId(null)}
          onSelectObject={handleSearchSelect}
          onSearchAround={handleSearchAround}
        />
      )}

      {routeError && (
        <div className="absolute left-1/2 top-4 z-50 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-lg border border-status-fault/30 bg-[#24191d]/95 px-3 py-2 text-[12px] text-status-fault shadow-xl">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{routeError}</span>
          <button type="button" onClick={() => setRouteError(null)} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {runtime && vms && snapshot && (
        <LuiPanel
          knowledge={vms.knowledge}
          candidates={vms.candidates}
          planner={vms.planner}
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
          wide={leftPanelCollapsed}
          leftPanelCollapsed={leftPanelCollapsed}
          onToggleLeftPanel={() => setLeftPanelCollapsed((value) => !value)}
        />
      )}

      {!runtime && <DiagnosisEntryButton onStartDiagnosis={handleStartDiagnosis} />}
    </div>
  )
}
