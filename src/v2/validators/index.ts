/**
 * 校验器分层注册表（docs/19 §17.1）—— 7 类校验器的统一入口。
 *
 * 映射：
 *   1. CASE_PACKAGE        → validateCasePackage（本层新增）
 *   2. KNOWLEDGE_PACKAGE   → scripts/validate-knowledge-package.mjs（既有，全包级）
 *   3. INSTANCE_TOPOLOGY   → validateInstanceTopology（既有，src/adapters/instance-topology-validate.ts）
 *   4. ADAPTER_INTEGRATION → validateAdapterIntegration（本层新增，wrap 阶段4 compileCase）
 *   5. LEAK                → validateLeakIsolation / scripts/validate-leak-isolation.mjs（既有，阶段4）
 *   6. RUNTIME_REPLAY      → validateRuntimeReplay / validateDeterministicStream（本层新增）
 *   7. FRONTEND_CONTRACT   → validateFrontendContract（本层新增，阶段5 VWB-* 复核）
 *
 * 用法：`validateAll(caseIds)` 跑全部 Case 级校验器，`runValidator(kind, caseId)` 单跑。
 */

import { validateCasePackage } from './case-package'
import { validateAdapterIntegration } from './adapter-integration'
import { validateRuntimeReplay, validateDeterministicStream } from './runtime-replay'
import { validateFrontendContract } from './frontend-contract'
import { validateBusinessGates } from './business-gates'
import type { ValidatorKind, ValidatorResult, ValidatorRunner } from './validator-types'

export type { ValidatorKind, ValidatorIssue, ValidatorResult, ValidatorRunner } from './validator-types'
export { validateCasePackage } from './case-package'
export { validateAdapterIntegration } from './adapter-integration'
export { validateRuntimeReplay, validateDeterministicStream } from './runtime-replay'
export { validateFrontendContract } from './frontend-contract'
export { validateBusinessGates } from './business-gates'

/**
 * 内置 Case 级校验器注册表。global 校验器（Knowledge Package）由 scripts/ 承载，
 * 不在此列（见 VALIDATOR_CATALOG 文档表）。
 */
export const VALIDATORS: ReadonlyArray<ValidatorRunner> = [
  {
    kind: 'CASE_PACKAGE',
    label: 'Case Package',
    run: (caseId) => validateCasePackage(caseId),
  },
  {
    kind: 'ADAPTER_INTEGRATION',
    label: 'Adapter Integration',
    run: (caseId) => validateAdapterIntegration(caseId),
  },
  {
    kind: 'RUNTIME_REPLAY',
    label: 'Runtime Replay',
    run: (caseId) => validateRuntimeReplay(caseId),
  },
  {
    kind: 'FRONTEND_CONTRACT',
    label: 'Frontend Contract',
    run: (caseId) => validateFrontendContract(caseId),
  },
]

/** 附加：确定性校验（同一 Case 事件流两次生成一致）。 */
export const VALIDATORS_DETERMINISM: ValidatorRunner = {
  kind: 'RUNTIME_REPLAY',
  label: 'Runtime Determinism',
  run: (caseId) => validateDeterministicStream(caseId),
}

/** 7 类校验器与既有脚本/实现的映射目录（供 validate-all 与文档展示）。 */
export const VALIDATOR_CATALOG: ReadonlyArray<{
  kind: ValidatorKind
  label: string
  implementation: string
  codes: string
}> = [
  { kind: 'CASE_PACKAGE', label: 'Case Package Validator', implementation: 'src/v2/validators/case-package.ts', codes: 'CKA-PKG-* / CKA-FIXTURE-* / CKA-MAP-* / CKA-COMPAT-* / IT-TIME-*' },
  { kind: 'KNOWLEDGE_PACKAGE', label: 'Knowledge Package Validator', implementation: 'scripts/validate-knowledge-package.mjs', codes: 'KG-*' },
  { kind: 'INSTANCE_TOPOLOGY', label: 'Instance Topology Validator', implementation: 'src/adapters/instance-topology-validate.ts', codes: 'IT-REF-* / IT-KG-* / IT-SEM-* / IT-TIME-* / IT-STATE-*' },
  { kind: 'ADAPTER_INTEGRATION', label: 'Adapter Integration Validator', implementation: 'src/v2/validators/adapter-integration.ts + compileCase(A0~A10)', codes: 'CKA-SEED-* / CKA-RELEASE-* / CKA-KG-* / CKA-FIXTURE-* / CKA-MAP-*' },
  { kind: 'LEAK', label: 'Leak Validator', implementation: 'src/adapters/case-knowledge-adapter.ts + scripts/validate-leak-isolation.mjs', codes: 'CKA-LEAK-*' },
  { kind: 'RUNTIME_REPLAY', label: 'Runtime Replay Validator', implementation: 'src/v2/validators/runtime-replay.ts', codes: 'RT-*' },
  { kind: 'FRONTEND_CONTRACT', label: 'Frontend Contract Validator', implementation: 'src/v2/validators/frontend-contract.ts + scripts/validate-view-boundary.mjs', codes: 'VWB-*' },
  { kind: 'BUSINESS_GATES', label: 'Business Gates Validator（阶段7）', implementation: 'src/v2/validators/business-gates.ts', codes: 'BGT-*' },
]

/** 批量运行全部 Case 级校验器；返回逐 Case 逐校验器结果。 */
export function validateAll(caseIds: string[]): ValidatorResult[] {
  const results: ValidatorResult[] = []
  for (const caseId of caseIds) {
    for (const validator of VALIDATORS) {
      results.push(validator.run(caseId))
    }
    results.push(VALIDATORS_DETERMINISM.run(caseId))
  }
  return results
}
