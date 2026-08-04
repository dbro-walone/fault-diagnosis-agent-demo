/**
 * 工程接口基线（docs/19 §16）—— 四个领域契约接口的统一入口。
 *
 * 设计原则（docs/19 §19：目录表达职责边界，不限定实现/物理目录）：
 * 本文件不复制实现，而是把既有稳定模块（阶段1~5）整理为文档定义的四个接口，
 * 用 re-export / 轻量 wrap 暴露，保持向后兼容：
 *
 *   1. Adapter          —— compile_case / create_runtime_seed / resolve_release
 *   2. Topology Service —— query_topology / query_topology_events / find_paths /
 *                          find_shared_resources / expand_by_relation
 *   3. Knowledge Service—— match_entries / expand_knowledge / get_evidence_requirements
 *   4. Runtime          —— append_event / get_snapshot / subscribe_events
 *
 * 所有接口遵循 docs/19 §13.2 写入边界：Adapter 不规划/不解释证据；Topology/Knowledge
 * 只读查询；Runtime 只归并事件。核心不可静默修复项（§17.2）显式报错。
 */

import type { AdaptedCase } from './case-adapter'
import type { RuntimeEvent } from './runtime-types'
import { errorCode, ErrorPrefix } from './error-codes'

// ─────────────────────────────────────────────────────────────────────────────
// 1. Adapter Contract（docs/19 §16.1、§8）—— CaseKnowledgeAdapter 的公开方法
// ─────────────────────────────────────────────────────────────────────────────

export interface AdapterProfile {
  /** 首轮候选泛化开关（默认 true，§10.4）。 */
  generalize?: boolean
  /** 泄露校验严格模式（默认 true）。 */
  strict_leak?: boolean
}

/** Session 初始化请求（§16.1 create_runtime_seed）。 */
export interface SessionInitRequest {
  session_id?: string
  entry_object_refs?: string[]
}

/** 释放查询的账本摘要：调用方给出事件流与游标，Adapter 计算该游标处释放增量。 */
export interface ReleaseLedgerDigest {
  events: RuntimeEvent[]
  through_sequence: number
}

/** Adapter 显式错误（§16.1 AdapterError）：code 为规范错误码。 */
export interface AdapterError {
  code: string
  message: string
}

export interface AdapterContract {
  compile_case(casePackage: AdaptedCase, kg?: unknown, profile?: AdapterProfile): AdapterCompileResult
  create_runtime_seed(compiled: AdapterCompileResult, sessionInit?: SessionInitRequest): RuntimeSeed
  resolve_release(compiled: AdapterCompileResult, event: RuntimeEvent, ledger: ReleaseLedgerDigest): ReleaseResult | AdapterError
}

import {
  compileCase,
  resolveRelease,
  type AdapterCompileResult,
  type ReleaseResult,
  type RuntimeSeed,
} from '../adapters/case-knowledge-adapter'

/**
 * Adapter 契约实现（阶段4 编译流水线 A0~A10 的统一入口）。
 * - kg 参数：阶段1~3 Adapter 直接从 model/ 读 KG 3.0.0，此处保留占位以对齐签名；
 * - compile_case 任一 Error 原子失败（抛 CKA-* 错误）；泄露 ERROR 返回 invalid 结果。
 */
export const caseKnowledgeAdapter: AdapterContract = {
  compile_case(casePackage, _kg, _profile): AdapterCompileResult {
    return compileCase(casePackage)
  },

  create_runtime_seed(compiled, _sessionInit): RuntimeSeed {
    if (!compiled.runtimeSeed) {
      throw new Error(`${errorCode(ErrorPrefix.CKA_SEED, 2)} 编译结果缺少 RuntimeSeed`)
    }
    return compiled.runtimeSeed
  },

  resolve_release(compiled, event, ledger): ReleaseResult | AdapterError {
    if (!ledger.events.some((e) => e.sequence === event.sequence && e.event_id === event.event_id)) {
      return {
        code: errorCode(ErrorPrefix.RT, 4),
        message: `resolve_release 收到事件 ${event.event_id} 不在调用方事件流中`,
      }
    }
    try {
      // 释放游标由调用方账本决定（through_sequence），而非事件自身序号——
      // 保证"首个终态事件之前不释放结论"的渐进语义可被校验。
      return resolveRelease(compiled, ledger.events, ledger.through_sequence)
    } catch (error) {
      return {
        code: errorCode(ErrorPrefix.CKA_RELEASE, 1),
        message: `释放计算失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Topology Service Contract（docs/19 §16.2）
// ─────────────────────────────────────────────────────────────────────────────

export type {
  TopologyQueryRequest,
  TopologyQueryResult,
  TopologyPath,
  PathQueryOptions,
  SharedResourceQueryOptions,
  SharedResourceResult,
  ExpandResult,
  TopologyEventsQuery,
  TopologyService,
} from './topology-service'
export {
  query_topology,
  query_topology_events,
  find_paths,
  find_shared_resources,
  expand_by_relation,
  createTopologyService,
} from './topology-service'

// ─────────────────────────────────────────────────────────────────────────────
// 3. Knowledge Service Contract（docs/19 §16.3）
// ─────────────────────────────────────────────────────────────────────────────

export type {
  KnowledgeEntryMatchSet,
  KnownKnowledgeDelta,
  EvidenceRequirementItem,
  EvidenceRequirementSet,
  KnowledgeService,
} from './knowledge-service'
export {
  match_entries,
  expand_knowledge,
  get_evidence_requirements,
  createKnowledgeService,
} from './knowledge-service'

// ─────────────────────────────────────────────────────────────────────────────
// 4. Runtime Contract（docs/19 §16.4）
// ─────────────────────────────────────────────────────────────────────────────

import { runtimeContract, type RuntimeContract } from './runtime-contract'
export type {
  RuntimeSessionHandle,
  RuntimeContract,
} from './runtime-contract'
export { runtimeContract } from './runtime-contract'

// ─────────────────────────────────────────────────────────────────────────────
// 契约注册表：一个入口列出全部四类接口（供 Gate 校验 / 文档自检）。
// ─────────────────────────────────────────────────────────────────────────────

import { createTopologyService } from './topology-service'
import { createKnowledgeService } from './knowledge-service'

export interface ContractSurface {
  adapter: AdapterContract
  topology: (topology: import('../adapters/v1_to_instance_topology').InstanceTopologySnapshot) => import('./topology-service').TopologyService
  knowledge: () => import('./knowledge-service').KnowledgeService
  runtime: RuntimeContract
}

/**
 * 四类契约的注册表。topology 需注入规范 InstanceTopologySnapshot（数据源），
 * knowledge 的 KG 3.0.0 为内置只读，故以工厂形式暴露；adapter/runtime 为全局单例。
 */
export const contractSurface: ContractSurface = {
  adapter: caseKnowledgeAdapter,
  topology: (topology) => createTopologyService(topology),
  knowledge: () => createKnowledgeService(),
  runtime: runtimeContract,
}
