/**
 * 校验器分层（docs/19 §17.1）—— 公共类型。
 *
 * 7 类校验器：
 *   CASE_PACKAGE       文件存在、JSON、ID、引用、时间、8 幕和 Case 内一致性
 *   KNOWLEDGE_PACKAGE  KG code、层级、关系、唯一父场景、模板和来源
 *   INSTANCE_TOPOLOGY  资源、关系、包含树、状态、事件、空间和 L1 能力匹配
 *   ADAPTER_INTEGRATION 字段转换、code 绑定、Fixture、ReleaseEnvelope 和 Seed
 *   LEAK               初始响应、事件流、快照、日志和 Storyboard 的真值泄露
 *   RUNTIME_REPLAY     事件顺序、幂等、快照一致性和历史回放
 *   FRONTEND_CONTRACT  只消费 Known 集合、Binding 联动和 ViewState 隔离
 */

export type ValidatorKind =
  | 'CASE_PACKAGE'
  | 'KNOWLEDGE_PACKAGE'
  | 'INSTANCE_TOPOLOGY'
  | 'ADAPTER_INTEGRATION'
  | 'LEAK'
  | 'RUNTIME_REPLAY'
  | 'FRONTEND_CONTRACT'
  | 'BUSINESS_GATES'

/** 单个校验问题：code 使用规范错误码（docs/19 §17.2）。 */
export interface ValidatorIssue {
  code: string
  severity: 'ERROR' | 'WARN'
  validator: ValidatorKind
  message: string
}

/** 单个校验器结果。 */
export interface ValidatorResult {
  validator: ValidatorKind
  label: string
  issues: ValidatorIssue[]
  /** errors === 0（WARN 不阻塞）。 */
  ok: boolean
}

/** 校验器注册表条目：面向单一 Case 执行。 */
export interface ValidatorRunner {
  kind: ValidatorKind
  label: string
  /** 数据包级校验器（caseId 粒度）。 */
  run(caseId: string): ValidatorResult
  /** 是否为"全包级"（不需要逐 Case，如 Knowledge Package）。 */
  global?: boolean
  /** 全局校验器（一次跑全包）。 */
  runGlobal?(): ValidatorResult
}
