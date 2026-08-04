/**
 * ViewState —— 前端投影 View State（docs/19 §14.4，阶段5 投影边界硬化）。
 *
 * 铁律（docs/19 §14.2/§14.4）：
 * - select / focus / filter / 聚合展开 / 缩放相机 只改变投影，不写 Runtime Event Log，
 *   不改变候选分 / 任务状态 / 证据 / 结论；
 * - agent_focus 只能由 Runtime 更新；ViewState 只携带 user_selection 类浏览状态；
 * - ViewState 是纯投影层状态：任何 action 都由 `viewStateReducer` 纯函数归并，
 *   与 DiagnosisSessionSnapshot 完全解耦（reducer 不接收、不触碰快照）；
 * - 相机预设/用户手动视角归前端画布管理（Layered3DCanvas 内部），本模块仅记录
 *   与相机相关的派生提示（active_lens / user_exploring）。
 *
 * 本模块不依赖 lib/ 与 runtime-types（除基础类型），保证校验器可独立加载。
 */

// ─────────────────────────────────────────────────────────────────────────────
// ViewState 结构
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewLayerVisibility {
  topology: boolean
  knowledge: boolean
}

export interface ViewState {
  /** 当前透镜（LensId；驱动相机预设 + ObjectSet 派生）。 */
  activeLens: string
  /** 分层条带展开（域/子层 TopoLayerCode → true）。 */
  expandedLayers: Partial<Record<string, boolean>>
  /** 左侧 Object Explorer 活动预设。 */
  activePreset: string
  /** 用户单击选中节点（user_selection，只由用户交互更新）。 */
  selectedNodeId: string | null
  /** 搜索过滤词（ObjectSet）。 */
  searchQuery: string
  /** ObjectSet 过滤开关（限定到搜索集合）。 */
  objectSetFilter: boolean
  /** 以某节点为中心的关系限定（around-root）。 */
  aroundRootId: string | null
  /** 拓扑/知识平面显隐（ModelNavigator）。 */
  layerVisibility: ViewLayerVisibility
  /** 双击展开的聚合设备节点（deviceId → expanded）。 */
  expandedDevices: Record<string, boolean>
  /** 知识图谱分层显隐（layer code → visible）。 */
  visibleKgLayers: Record<string, boolean>
  /** 是否显示跨层映射连线。 */
  showCrossLayer: boolean
  /** 左侧 Object Explorer / 时间线导航是否收起（F0）。 */
  navigatorCollapsed: boolean
  /** 用户是否已接管相机（浏览中；Agent 新事件不得抢回视角，docs/04 §8）。 */
  userExploring: boolean
}

export const DEFAULT_VIEW_STATE: ViewState = {
  activeLens: 'TOPOLOGY',
  expandedLayers: {},
  activePreset: 'OVERVIEW',
  selectedNodeId: null,
  searchQuery: '',
  objectSetFilter: false,
  aroundRootId: null,
  layerVisibility: { topology: true, knowledge: true },
  expandedDevices: {},
  visibleKgLayers: {},
  showCrossLayer: false,
  navigatorCollapsed: false,
  userExploring: false,
}

// ─────────────────────────────────────────────────────────────────────────────
// ViewAction / Reducer（纯函数，无副作用，不触碰诊断快照）
// ─────────────────────────────────────────────────────────────────────────────

export type ViewAction =
  | { type: 'SET_LENS'; lens: string }
  | { type: 'TOGGLE_LAYER'; code: string }
  | { type: 'SET_PRESET'; preset: string }
  | { type: 'SET_SELECTION'; nodeId: string | null }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_OBJECT_SET_FILTER'; enabled: boolean }
  | { type: 'SET_AROUND_ROOT'; rootId: string | null; clearFilter?: boolean }
  | { type: 'TOGGLE_PLANE'; plane: 'topology' | 'knowledge' }
  | { type: 'TOGGLE_DEVICE'; deviceId: string }
  | { type: 'TOGGLE_KG_LAYER'; code: string }
  | { type: 'TOGGLE_CROSS_LAYER' }
  | { type: 'SET_NAVIGATOR_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_USER_EXPLORING'; exploring: boolean }
  | { type: 'RESET' }

/**
 * 投影边界纯归并器：所有 ViewState 变更的唯一入口。
 *
 * 纯净性约束（阶段5 校验 VWB-004）：
 * - 入参只有 ViewState + action，绝不接收快照/Runtime；
 * - 返回全新对象，不修改入参；
 * - 不产生 Runtime Event、不执行诊断计算。
 */
export function viewStateReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'SET_LENS':
      return { ...state, activeLens: action.lens }
    case 'TOGGLE_LAYER':
      return {
        ...state,
        expandedLayers: { ...state.expandedLayers, [action.code]: !state.expandedLayers[action.code] },
      }
    case 'SET_PRESET':
      return { ...state, activePreset: action.preset }
    case 'SET_SELECTION':
      return { ...state, selectedNodeId: action.nodeId }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query, objectSetFilter: action.query ? state.objectSetFilter : false }
    case 'SET_OBJECT_SET_FILTER':
      return { ...state, objectSetFilter: action.enabled }
    case 'SET_AROUND_ROOT':
      return {
        ...state,
        aroundRootId: action.rootId,
        objectSetFilter: action.clearFilter ? false : state.objectSetFilter,
      }
    case 'TOGGLE_PLANE':
      return {
        ...state,
        layerVisibility: { ...state.layerVisibility, [action.plane]: !state.layerVisibility[action.plane] },
      }
    case 'TOGGLE_DEVICE':
      return { ...state, expandedDevices: { ...state.expandedDevices, [action.deviceId]: !state.expandedDevices[action.deviceId] } }
    case 'TOGGLE_KG_LAYER':
      return { ...state, visibleKgLayers: { ...state.visibleKgLayers, [action.code]: !state.visibleKgLayers[action.code] } }
    case 'TOGGLE_CROSS_LAYER':
      return { ...state, showCrossLayer: !state.showCrossLayer }
    case 'SET_NAVIGATOR_COLLAPSED':
      return { ...state, navigatorCollapsed: action.collapsed }
    case 'SET_USER_EXPLORING':
      return { ...state, userExploring: action.exploring }
    case 'RESET':
      return { ...DEFAULT_VIEW_STATE }
    default:
      return state
  }
}

/**
 * 串行应用一串 ViewAction（纯函数，供校验器/测试模拟用户交互序列）。
 */
export function applyViewActions(state: ViewState, actions: ViewAction[]): ViewState {
  return actions.reduce(viewStateReducer, state)
}

/**
 * ViewState 结构签名（用于变化检测；不含诊断语义）。
 */
export function viewStateSignature(state: ViewState): string {
  return JSON.stringify({
    lens: state.activeLens,
    layers: Object.entries(state.expandedLayers).filter(([, v]) => v).map(([k]) => k).sort().join(','),
    preset: state.activePreset,
    selected: state.selectedNodeId,
    search: state.searchQuery,
    filter: state.objectSetFilter,
    around: state.aroundRootId,
    planes: `${state.layerVisibility.topology ? 'T' : ''}${state.layerVisibility.knowledge ? 'K' : ''}`,
    devices: Object.keys(state.expandedDevices).sort().join(','),
    kg: Object.entries(state.visibleKgLayers).filter(([, v]) => !v).map(([k]) => k).sort().join(','),
    cross: state.showCrossLayer,
    nav: state.navigatorCollapsed,
    exploring: state.userExploring,
  })
}
