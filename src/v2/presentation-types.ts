/**
 * Presentation Projection 协议层 —— 纯类型定义（P0，Issue #12「诊断过程展示优化」）。
 *
 * 本文件只定义"镜头阶段 + 语义主体 + 一屏一主体"的展示协议类型，不涉及相机、UI 或
 * Runtime 写回。数据全部由纯函数 presentationProjection 从快照推导（见
 * presentation-projection.ts），与 Runtime Event Contract / projection-store 保持单向只读。
 *
 * 核心口径（与 CLAUDE.md 对齐）：
 * - 一屏一主体：任意时刻只有一个 PresentationSubject 作为镜头语义焦点；
 * - focus_signature 唯一标识当前主体，变化才触发相机 Travel（避免同节点重复运镜）；
 * - 诊断支持分 0-100，不是概率/置信度。
 */

/** 镜头阶段 —— 对应相机的一次"语义运镜"（docs/04 相机协议）。 */
export const CameraPhase = {
  /** 会话开始：全景/业务视图，定位现象所在业务域。 */
  ORIENT: 'ORIENT',
  /** 从业务对象沿拓扑移动到目标资源（镜头移动中）。 */
  TRAVEL: 'TRAVEL',
  /** 聚焦到单对象/当前验证目标（镜头到达）。 */
  FOCUS: 'FOCUS',
  /** 对该对象执行 Skill 取证（检查/展开/查看指标）。 */
  INSPECT: 'INSPECT',
  /** 取证产出结果（Fact/证据）后的回放展示。 */
  RESULT: 'RESULT',
  /** 展示竞争解释/候选集合/证据图（多实体上下文）。 */
  CONTEXT: 'CONTEXT',
  /** 沿下一调查路径移动（重规划/结论门控前的路径预览）。 */
  ROUTE: 'ROUTE',
  /** 诊断终态：根因/影响链/结论展示。 */
  COMPLETE: 'COMPLETE',
} as const
export type CameraPhase = (typeof CameraPhase)[keyof typeof CameraPhase]

/** 跟随模式 —— 镜头由 Agent 自动跟随还是用户手动接管。 */
export const FollowMode = { AUTO: 'AUTO', MANUAL: 'MANUAL' } as const
export type FollowMode = (typeof FollowMode)[keyof typeof FollowMode]

// ─────────────────────────────────────────────────────────────────────────────
// PresentationSubject —— 当前镜头语义主体（一屏一主体）
// ─────────────────────────────────────────────────────────────────────────────

/** 单节点主体：聚焦到某个实例对象（如控制器、LUN、端口）。 */
export interface NodeSubject {
  kind: 'node'
  /** 实例节点 ID（如 'controller-0a'）。 */
  primary_id: string
  /** 显示名称。 */
  label: string
  /** 本体类型（如 'CONTROLLER'）。 */
  resource_type: string
}

/** 路径主体：沿一条拓扑路径聚焦（如受害业务路径 / 复制链路）。 */
export interface PathSubject {
  kind: 'path'
  /** 有序节点序列（如 ['host-b', 'lun-b', 'fc-port-0a']）。 */
  node_ids: string[]
  /** 路径终点/焦点节点。 */
  primary_id: string
  label: string
}

/** 关系组主体：聚焦一组共享资源/对等关系成员。 */
export interface RelationGroupSubject {
  kind: 'relation_group'
  /** 组成员 ID。 */
  member_ids: string[]
  /** 主节点。 */
  primary_id: string
  /** 关系类型（如 'peer', 'shared_resource'）。 */
  relation: string
  label: string
}

/** 终态主体：诊断结束后的根因链 + 影响链展示。 */
export interface TerminalSubject {
  kind: 'terminal'
  /** 根因链 + 影响链节点。 */
  node_ids: string[]
  /** 根因节点。 */
  primary_id: string
  label: string
  terminal_type: 'ROOT_CAUSE_CONFIRMED' | 'PROBABLE_CAUSES' | 'INSUFFICIENT_EVIDENCE'
}

export type PresentationSubject = NodeSubject | PathSubject | RelationGroupSubject | TerminalSubject

// ─────────────────────────────────────────────────────────────────────────────
// DiagnosisPresentationVM —— 协议层输出 View Model
// ─────────────────────────────────────────────────────────────────────────────

/** 终态摘要（terminal_summary）。 */
export type TerminalType = 'ROOT_CAUSE_CONFIRMED' | 'PROBABLE_CAUSES' | 'INSUFFICIENT_EVIDENCE'

export interface DiagnosisPresentationVM {
  /** 当前镜头阶段。 */
  phase: CameraPhase
  /** 当前语义主体（一屏一主体）。 */
  subject: PresentationSubject | null
  /** 主体唯一签名（变化才触发 Travel）。 */
  focus_signature: string
  /** 上下文对象（需保持可见的邻居/关联节点）。 */
  context_object_ids: string[]
  /** 下一调查路径预览节点。 */
  route_object_ids: string[]
  /** 当前正在执行的 Skill 列表。 */
  active_skills: Array<{
    skill_id: string
    action_text: string
    reason_text: string | null
    expected_result_text: string | null
  }>
  /** 本轮新增事实。 */
  new_fact_refs: string[]
  /** 候选变化摘要。 */
  candidate_deltas: Array<{
    candidate_id: string
    score_before: number
    score_after: number
    status_after: string
    reason: string | null
  }>
  /** 当前决策解释。 */
  reason: string | null
  /** 预期证据。 */
  expected_evidence: Array<{ requirement_id: string; description?: string }>
  /** 终态摘要。 */
  terminal_summary: {
    terminal_type: TerminalType
    root_cause_label: string | null
    chain_node_ids: string[]
    impact_node_ids: string[]
  } | null
}
