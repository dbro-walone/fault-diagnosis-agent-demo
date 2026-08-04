import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AlertTriangle, Radar, X } from 'lucide-react'

import DiagnosisEntryButton, {
  type DiagnosisEntryPayload,
} from '@/components/DiagnosisEntryButton'
import Layered3DCanvas from '@/components/Layered3DCanvas'
import LuiPanel from '@/components/LuiPanel'
import ModelNavigator from '@/components/ModelNavigator'
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
  activeBindingsOf,
  releasedFactsFrom,
  DEFAULT_VIEW_STATE,
  viewStateReducer,
  type DiagnosisRuntime,
  type ViewState,
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

  // 阶段5：ViewState 集中管理（docs/19 §14.4）。聚合/展开/缩放/聚焦/筛选/相机只改变
  // 投影，经 viewStateReducer 纯归并，绝不写入 Runtime 诊断 store。
  const [viewState, dispatchView] = useReducer(
    viewStateReducer,
    model.initialPreset
      ? { ...DEFAULT_VIEW_STATE, activePreset: model.initialPreset }
      : DEFAULT_VIEW_STATE,
  )
  const {
    activeLens,
    expandedLayers,
    activePreset,
    selectedNodeId,
    searchQuery,
    objectSetFilter,
    aroundRootId,
    layerVisibility,
    expandedDevices,
    visibleKgLayers,
    showCrossLayer,
    navigatorCollapsed: leftPanelCollapsed,
    userExploring,
  } = viewState

  // V2 runtime + projection state.
  const [runtime, setRuntime] = useState<DiagnosisRuntime | null>(null)
  const runtimeRef = useRef<DiagnosisRuntime | null>(null)
  runtimeRef.current = runtime
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeNote, setRouteNote] = useState<string | null>(null)

  // issue#7 D：LUI 悬浮在画布右侧；诊断会话中按 LUI 宽度把画布右边界左移避让。
  // LUI 宽 = wide(806px，左侧收起) 或 448px；right-4=16px 外边距 + 16px 间隙。
  const canvasRightInset = runtime ? (leftPanelCollapsed ? 806 : 448) + 32 : 0

  // user_selection (Projection-only; never written by Runtime).
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null)
  // userExploring 移入 ViewState：用户已接管相机，Agent 新事件不得抢回视角（docs/04 §8）。

  const snapshot = runtime?.snapshot ?? null
  const agentFocus = snapshot?.session.agent_focus

  // ViewState.activeLens 存 LensId 字符串（ViewState 模块保持与 LensId 解耦）；此处收敛为 LensId 类型。
  const activeLensTyped = activeLens as LensId

  const objectSet = useMemo(
    () => model.registry.objectSet({ text: searchQuery, lens: activeLensTyped }, undefined),
    [activeLensTyped, model.registry, searchQuery],
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
    ? model.registry.objectView(selectedNodeId, activeLensTyped, undefined, undefined)
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
      // 阶段5：诊断会话初始化 = ViewState RESET（清空浏览选择/展开）+ 进入诊断透镜
      // + 收起左侧导航；ViewState 变更不写 Runtime 诊断 store。
      dispatchView({ type: 'RESET' })
      dispatchView({ type: 'SET_LENS', lens: LensId.DIAGNOSIS })
      dispatchView({ type: 'SET_PRESET', preset: 'OVERVIEW' })
      dispatchView({ type: 'SET_NAVIGATOR_COLLAPSED', collapsed: true })
      setIsPlaying(true)
      // F2：分层视图跟随诊断 Case，使红色逻辑链对象落在当前分层模型中。
      setLayeredCaseId(caseId)
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
    // 阶段5：退出诊断 = ViewState RESET（回到浏览默认）+ 恢复左侧导航；不写诊断 store。
    dispatchView({ type: 'RESET' })
    dispatchView({ type: 'SET_NAVIGATOR_COLLAPSED', collapsed: false })
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
      dispatchView({ type: 'SET_USER_EXPLORING', exploring: true })
    }
  }

  // Canvas / navigator node selection is a pure user_selection update.
  // 单击只选中 + 详情（BA-GRAPH-008），绝不改变层级/展开状态/诊断候选。
  const handleNodeSelect = (id: string | null) => {
    dispatchView({ type: 'SET_SELECTION', nodeId: id })
    dispatchView({ type: 'SET_USER_EXPLORING', exploring: true })
  }

  // 双击聚合设备节点 → 展开其直接成员 / 收起（BA-GRAPH-009，局部显露不洗牌）。
  const handleNodeDoubleClick = (id: string) => {
    if (model.deviceGroups.some((g) => g.deviceId === id)) {
      dispatchView({ type: 'TOGGLE_DEVICE', deviceId: id })
    }
  }

  // 分层条带：点击层聚合头展开/收起（域或子层，递归）。
  const handleToggleLayer = (code: TopoLayerCode) => {
    dispatchView({ type: 'TOGGLE_LAYER', code })
  }

  const handleSearchSelect = (id: string) => {
    dispatchView({ type: 'SET_SELECTION', nodeId: id })
    dispatchView({ type: 'SET_USER_EXPLORING', exploring: true })
  }

  const handleReturnAgentView = () => {
    dispatchView({ type: 'SET_USER_EXPLORING', exploring: false })
  }

  const handleSearchAround = () => {
    if (!selectedNodeId) return
    dispatchView({ type: 'SET_AROUND_ROOT', rootId: selectedNodeId, clearFilter: true })
  }

  const clearRestriction = () => {
    dispatchView({ type: 'SET_AROUND_ROOT', rootId: null, clearFilter: false })
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
    // 阶段3：传入静态 Binding + InstanceTopology，供"当前 ACTIVE CrossPlaneBinding"投影。
    const adapted = loadAdaptedCase(runtime?.caseId ?? '')
    // 阶段4：对象观测数据源只取"已释放 Fact"（Known Ledger），回放不泄露未来观测
    // （docs/19 §7.1：前端只收 Known 集合；DISCOVERABLE 数据经查询命中后进入 Known）。
    store.bind(snapshot, {
      observationsFacts: releasedFactsFrom(snapshot, adapted.facts),
      knowledgeNodes: knowledgeRefs,
      knowledgeLinks: knowledgeLinkRefs,
      staticBindings: adapted.staticBindings,
      instanceTopology: adapted.instanceTopology,
    })
    // 阶段5：binding/planner 只算一次，decision/viewProjection 复用，避免投影层重复派生。
    const bindings = store.activeBindings()
    const planner = store.plannerTargets()
    return {
      store,
      knowledge: store.knowledgeSnapshot(),
      candidates: store.candidateList(),
      planner,
      timeline: store.timeline(),
      scan: store.diagnosisScan(),
      bindings,
      // 阶段5：LUI 三问之"为什么"——当前决策（理由/证据缺口/目标候选/预期证据）。
      decision: store.currentDecision(planner),
      // 阶段5：视图投影（Known Fact + ACTIVE Binding + View Hint + 诊断语义指纹）。
      projection: store.viewProjection(bindings),
    }
  }, [snapshot, runtime, knowledgeRefs, knowledgeLinkRefs])

  // 阶段3：画布跨平面光柱只消费 ACTIVE CrossPlaneBinding。
  // 诊断会话中取投影 Store 汇出（静态 + 动态 ACTIVE）；浏览态取当前分层 Case 静态 Binding。
  const canvasActiveBindings = useMemo(() => {
    if (runtime && vms) return vms.bindings
    return activeBindingsOf(loadAdaptedCase(layeredCaseId).staticBindings)
  }, [runtime, vms, layeredCaseId])

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
        activeLens={activeLensTyped}
        onNodeSelect={handleNodeSelect}
        knowledgeNodes={knowledgeNodes}
        knowledgeLinks={knowledgeLinks}
        visibleKgLayers={visibleKgLayers}
        diagnosisScan={vms?.scan ?? null}
        activeBindings={canvasActiveBindings}
      />

      {/* F0：诊断会话默认收起 Object Explorer；退出/手动展开后恢复 */}
      {!leftPanelCollapsed && (
        <ModelNavigator
          model={model}
          activePreset={activePreset}
          onPresetChange={(preset) => dispatchView({ type: 'SET_PRESET', preset })}
          layerVisibility={layerVisibility}
          onToggleLayer={(plane) => dispatchView({ type: 'TOGGLE_PLANE', plane })}
          visibleKgLayers={visibleKgLayers}
          onToggleKgLayer={(code) => dispatchView({ type: 'TOGGLE_KG_LAYER', code })}
          showCrossLayer={showCrossLayer}
          onToggleCrossLayer={() => dispatchView({ type: 'TOGGLE_CROSS_LAYER' })}
          searchQuery={searchQuery}
          onSearchChange={(value) => dispatchView({ type: 'SET_SEARCH', query: value })}
          objectSet={objectSet}
          objectSetFilter={objectSetFilter}
          onToggleObjectSet={() =>
            dispatchView({ type: 'SET_OBJECT_SET_FILTER', enabled: !objectSetFilter })
          }
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
          onClose={() => dispatchView({ type: 'SET_SELECTION', nodeId: null })}
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
          decision={vms.decision}
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
          onToggleLeftPanel={() =>
            dispatchView({ type: 'SET_NAVIGATOR_COLLAPSED', collapsed: !leftPanelCollapsed })
          }
        />
      )}

      {!runtime && <DiagnosisEntryButton onStartDiagnosis={handleStartDiagnosis} />}
    </div>
  )
}
