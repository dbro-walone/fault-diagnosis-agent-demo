/**
 * Diagnosis Runtime V2 —— 公共 API 汇出。
 *
 * 分层（docs/01 §2）：
 *   Case V1.0 → case-adapter → diagnosis-runtime (events) → event-reducer (snapshot)
 *             → projection-store (View Models)
 *   manifest 负责案例发现与路由元数据。
 */

// 类型与枚举
export * from './runtime-types'

// Case 发现与路由
export { listCases, listCaseIds, getCase, caseExists, type CaseRouteEntry } from './manifest'

// V1→V2 适配
export {
  loadAdaptedCase,
  converters,
  skillCodeToSkillId,
  confidenceToScore,
  mapCandidateStatus,
  mapTaskStatus,
  mapTerminalStatus,
  mapStanceToEffect,
  mapEvidenceQuality,
  type AdaptedCase,
  type TraceScorePoint,
} from './case-adapter'

// 纯函数归并器
export {
  createEmptySnapshot,
  applyEvent,
  reduceEvents,
  replayToSequence,
} from './event-reducer'

// 运行时编排器
export {
  createDiagnosisRuntime,
  generateEvents,
  replayCase,
  type DiagnosisRuntime,
} from './diagnosis-runtime'

// 投影层
export {
  ProjectionStore,
  activeDiagnosisPath,
  EMPTY_USER_SELECTION,
  type UserSelection,
  type KnowledgeSnapshotVM,
  type CandidateListVM,
  type CandidateItemVM,
  type CurrentActionVM,
  type EvidenceChainVM,
  type EvidenceChainItemVM,
  type FactDetailVM,
  type FactDetailRowVM,
  type FactSummaryVM,
  type TimelineEventVM,
  type ChainProgressVM,
} from './projection-store'
