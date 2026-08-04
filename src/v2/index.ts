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

// InstanceTopology Contract 1.0 —— V1→规范转换器与渲染投影
export {
  convertV1ToInstanceTopology,
  instanceTopologyToGraph,
  deriveSnapshotAt,
  deriveSpatialDomain,
  stateDimensionForCode,
  V1_RESOURCE_TYPE_MAP,
  V1_LAYER_CODE_MAP,
  V1_RELATION_MAP,
  SYMMETRIC_RELATIONS,
  INSTANCE_TOPOLOGY_SCHEMA_NAME,
  INSTANCE_TOPOLOGY_SCHEMA_VERSION,
  type InstanceTopologySnapshot,
  type ResourceInstance,
  type TopologyRelation,
  type RelationSet,
  type InstanceState,
  type TopologyEvent,
  type ProjectedResource,
  type ProjectedEdge,
} from '../adapters/v1_to_instance_topology'

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

// 阶段4 —— CaseKnowledgeAdapter 真值隔离（docs/19 §7/§8：Seed/Bundle/Envelope/泄露校验）
export {
  DataPartition,
  ExposureState,
  PayloadKind,
  GENERALIZED_FAULT_MODE_PREFIX,
  GENERALIZED_OBJECT_ANOMALY,
  RELEASE_PRECONDITIONS,
  buildFaultModeScenarioIndex,
  generalizeCandidate,
  isGeneralizedCandidate,
  partitionOfFact,
  partitionOfCandidate,
  compileCase,
  loadCompiledCase,
  resolveRelease,
  releasedFactsFrom,
  validateLeakIsolation,
  type TruthGraph,
  type KnownGraph,
  type ViewGraph,
  type KnownLedger,
  type KnownLedgerEntry,
  type ReleaseCondition,
  type ReleaseEnvelope,
  type RuntimeSeed,
  type PrivateCaseBundle,
  type PartitionIndex,
  type LeakIssue,
  type LeakReport,
  type AdapterCompileResult,
  type ReleaseResult,
} from '../adapters/case-knowledge-adapter'

// 阶段3 —— CrossPlaneBinding 跨平面绑定（docs/19 §6）
export {
  BindingPlane,
  BindingStatus,
  CrossPlaneBindingType,
  STATIC_BINDING_TYPES,
  DYNAMIC_BINDING_TYPES,
  ALL_BINDING_TYPES,
  transitionBindingStatus,
  buildKnowledgePlaneIndex,
  compileStaticBindings,
  matchEvidenceToRule,
  deriveDynamicBindings,
  activeBindingsOf,
  resourceTypeResolverOf,
  v1TypeToCode,
  validateCrossPlaneBindings,
  ACTIVE_HYPOTHESIS_STATUSES,
  type CrossPlaneBinding,
  type BindingCreatedBy,
  type BindingLifecycleTrigger,
  type KnowledgePlaneIndex,
  type KnowledgeRuleDef,
  type TopologyCapabilityDef,
  type BindingValidationIssue,
} from './cross-plane-binding'

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
  type PlannerTargetsVM,
  type PlannerTargetVM,
  type PlannerReplanVM,
  type PlannerTargetStatus,
  type ObjectObservationPanelVM,
  type ObjectObservationVM,
  type ObjectObsCategoryVM,
  type ObjectObsItemVM,
  type ObjectObsKind,
  type ObjectObsStatus,
  type DiagnosisScanVM,
  type ExaminedObjectVM,
  type ExaminedVerdict,
  type KnowledgeGraphNodeRef,
  type KnowledgeGraphLinkRef,
} from './projection-store'
