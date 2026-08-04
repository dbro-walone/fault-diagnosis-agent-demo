/**
 * 规范错误码（docs/19 §17.2）—— 校验器/接口的单一错误码来源。
 *
 * 前缀（§17.2）：
 *   KG-*           知识包错误
 *   IT-REF-*       实例引用错误
 *   IT-KG-*        L1类型能力不匹配
 *   IT-SEM-*       包含、关系或空间语义错误
 *   IT-TIME-*      生命周期和时态错误
 *   IT-STATE-*     状态冲突
 *   CKA-PKG-*      Case包读取和版本错误
 *   CKA-MAP-*      资源、关系、状态和Skill映射错误
 *   CKA-KG-*       KG绑定与入口匹配错误
 *   CKA-FIXTURE-*  Task/Evidence/Trace/Conclusion编译错误
 *   CKA-SEED-*     RuntimeSeed构造错误
 *   CKA-RELEASE-*  ReleaseEnvelope错误
 *   CKA-LEAK-*     真值、未来事实或私有字段泄露
 *   CKA-COMPAT-*   Case V1兼容错误
 *   RT-*           Runtime事件、归约与快照错误
 *
 * 另有阶段5 既定的 Frontend Contract 前缀 VWB-*（validate-view-boundary），
 * 以及 CrossPlaneBinding 既定前缀 BIND-*（docs/19 §6 生命周期校验，非 §17.2 列表，
 * 概念上归 IT-KG-*：L1 类型能力/跨平面引用不匹配）。既有前缀保持向后兼容。
 */

/** 错误码前缀常量（§17.2）。 */
export const ErrorPrefix = {
  KG: 'KG',
  IT_REF: 'IT-REF',
  IT_KG: 'IT-KG',
  IT_SEM: 'IT-SEM',
  IT_TIME: 'IT-TIME',
  IT_STATE: 'IT-STATE',
  CKA_PKG: 'CKA-PKG',
  CKA_MAP: 'CKA-MAP',
  CKA_KG: 'CKA-KG',
  CKA_FIXTURE: 'CKA-FIXTURE',
  CKA_SEED: 'CKA-SEED',
  CKA_RELEASE: 'CKA-RELEASE',
  CKA_LEAK: 'CKA-LEAK',
  CKA_COMPAT: 'CKA-COMPAT',
  RT: 'RT',
  /** 阶段5 既定：前端投影边界（Frontend Contract Validator）。 */
  VWB: 'VWB',
  /** 阶段3 既定：CrossPlaneBinding 生命周期校验（概念归 IT-KG）。 */
  BIND: 'BIND',
  /** 阶段7：九道 Gate 验收的业务断言（Business Gates Validator，Gate 5.2~5.4 / Gate 9）。 */
  BGT: 'BGT',
} as const
export type ErrorPrefix = (typeof ErrorPrefix)[keyof typeof ErrorPrefix]

/**
 * 组装规范错误码：`<PREFIX>-<SEQ>`（seq 三位补零）。
 * 例：errorCode(ErrorPrefix.IT_REF, 1) → 'IT-REF-001'。
 */
export function errorCode(prefix: ErrorPrefix, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`
}

/**
 * §17.2 禁止静默修复的核心不可静默项（供接口/校验器明确报错的锚点）。
 * 每一项都给出规范错误码前缀与说明；实现方在检测到对应情况时必须显式报错，
 * 不得"猜测修复"（如多义 code 猜一个、分数冲突取平均值等）。
 */
export const FATAL_SILENT_REPAIRS: ReadonlyArray<{
  code: string
  prefix: ErrorPrefix
  description: string
}> = [
  { code: errorCode(ErrorPrefix.CKA_MAP, 1), prefix: ErrorPrefix.CKA_MAP, description: '多义 code：同一输入命中多个候选语义，禁止猜测' },
  { code: errorCode(ErrorPrefix.CKA_MAP, 2), prefix: ErrorPrefix.CKA_MAP, description: '无法映射的资源类型：resource_type_code 无 KG L1 对应' },
  { code: errorCode(ErrorPrefix.IT_REF, 1), prefix: ErrorPrefix.IT_REF, description: '悬空端点：关系/状态/事件引用不存在的资源' },
  { code: errorCode(ErrorPrefix.IT_TIME, 1), prefix: ErrorPrefix.IT_TIME, description: '无法解析的事件时间：occurred_at 非法或晚于会话游标' },
  { code: errorCode(ErrorPrefix.CKA_FIXTURE, 2), prefix: ErrorPrefix.CKA_FIXTURE, description: '分数口径冲突：同一候选的 trace 分数前后矛盾' },
  { code: errorCode(ErrorPrefix.CKA_FIXTURE, 3), prefix: ErrorPrefix.CKA_FIXTURE, description: 'Conclusion 根因不在候选集合：root_cause.candidate_id 无对应候选' },
  { code: errorCode(ErrorPrefix.CKA_SEED, 1), prefix: ErrorPrefix.CKA_SEED, description: '初始上下文含最终答案：RuntimeSeed 携带 Ground Truth' },
  { code: errorCode(ErrorPrefix.CKA_LEAK, 1), prefix: ErrorPrefix.CKA_LEAK, description: 'Storyboard 越权：展示提示引用未发现/未来资源' },
]

/** 全部规范前缀（校验器汇总表用）。 */
export const ALL_ERROR_PREFIXES: ReadonlyArray<ErrorPrefix> = [
  ErrorPrefix.KG,
  ErrorPrefix.IT_REF,
  ErrorPrefix.IT_KG,
  ErrorPrefix.IT_SEM,
  ErrorPrefix.IT_TIME,
  ErrorPrefix.IT_STATE,
  ErrorPrefix.CKA_PKG,
  ErrorPrefix.CKA_MAP,
  ErrorPrefix.CKA_KG,
  ErrorPrefix.CKA_FIXTURE,
  ErrorPrefix.CKA_SEED,
  ErrorPrefix.CKA_RELEASE,
  ErrorPrefix.CKA_LEAK,
  ErrorPrefix.CKA_COMPAT,
  ErrorPrefix.RT,
]
