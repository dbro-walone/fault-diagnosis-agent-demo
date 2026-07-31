import type { Plan, PlanTask } from '../../schemas/types'
import { TaskStatus } from '../../schemas/enums'

/**
 * V1 确定性 Planner — Controller 热复位 Case
 * 按固定轮次生成诊断计划
 */

export interface RoundResult {
  round: number
  plan: Plan
  isReplan?: boolean
  triggerEvidenceId?: string
  replanChanges?: string[]
  isTerminal?: boolean
  generateCandidates?: boolean
}

let planIdCounter = 0
let taskIdCounter = 0

function nextPlanId(): string {
  planIdCounter++
  return `plan-${String(planIdCounter).padStart(3, '0')}`
}

function nextTaskId(): string {
  taskIdCounter++
  return `task-${String(taskIdCounter).padStart(3, '0')}`
}

function makeTask(
  skillType: string,
  targetObjectIds: string[],
  reason: string,
  expectedEvidence: string,
): PlanTask {
  return {
    id: nextTaskId(),
    skillType,
    targetObjectIds,
    reason,
    expectedEvidence,
    status: TaskStatus.PENDING,
  }
}

export function getRoundPlan(round: number): RoundResult | null {
  const now = new Date().toISOString()

  switch (round) {
    case 1:
      return {
        round: 1,
        plan: {
          id: nextPlanId(),
          round: 1,
          goal: '定位业务影响范围',
          selectionReason: '需要确认哪个业务和 LUN 受到时延升高影响',
          tasks: [
            makeTask(
              'business_mapping',
              ['db-business-01'],
              '查询业务到 LUN 的映射关系，确认受影响对象',
              '业务-LUN 映射结果 + IOPS/时延变化',
            ),
            makeTask(
              'kpi',
              ['lun-db01'],
              '查看 LUN 级别 KPI 指标变化',
              'LUN 时延和 IOPS 数据',
            ),
          ],
          createdAt: now,
        },
      }

    case 2:
      return {
        round: 2,
        plan: {
          id: nextPlanId(),
          round: 2,
          goal: '展开端到端拓扑路径',
          selectionReason: '需要理解完整的业务到存储访问路径，识别可能的故障域',
          tasks: [
            makeTask(
              'topology',
              ['db-business-01', 'db-host-01'],
              '展开从业务到存储的端到端访问路径',
              '完整拓扑路径 + 冗余路径',
            ),
          ],
          createdAt: now,
        },
        generateCandidates: true,
      }

    case 3:
      return {
        round: 3,
        plan: {
          id: nextPlanId(),
          round: 3,
          goal: '查询故障窗口内告警',
          selectionReason: '告警通常直接指向故障来源，需要检查故障时间窗内的所有告警',
          tasks: [
            makeTask(
              'alert',
              ['controller-0a', 'controller-0b', 'lun-db01'],
              '查询故障时间窗内的告警事件',
              '告警列表，特别关注控制器和 LUN 相关告警',
            ),
          ],
          createdAt: now,
        },
      }

    case 4:
      // REPLAN 1: 告警发现 Controller-0A 热复位后触发
      return {
        round: 4,
        isReplan: true,
        triggerEvidenceId: 'evidence-alert-warm-reset',
        replanChanges: [
          '新增：Controller-0A 日志分析（查找热复位原因）',
          '新增：Controller-0B 日志分析（确认主备切换）',
          '新增：Controller-0A 吞吐量 KPI（确认吞吐归零）',
          '新增：Controller-0B 吞吐量 KPI（确认接管负载）',
        ],
        plan: {
          id: nextPlanId(),
          round: 4,
          goal: '深入验证控制器异常机制和主备切换影响',
          selectionReason: 'Controller-0A 热复位告警强烈指向控制器故障，需要验证触发机制和影响链',
          tasks: [
            makeTask(
              'log',
              ['controller-0a'],
              '分析 Controller-0A 日志，查找热复位触发原因',
              'watchdog_timeout 或其他触发机制的日志指纹',
            ),
            makeTask(
              'log',
              ['controller-0b'],
              '分析 Controller-0B 日志，确认主备切换过程',
              'takeover_started 日志 + 切换时间',
            ),
            makeTask(
              'kpi',
              ['controller-0a'],
              '查看 Controller-0A 吞吐量变化',
              '吞吐量归零时段和持续时间',
            ),
            makeTask(
              'kpi',
              ['controller-0b'],
              '查看 Controller-0B 吞吐量变化',
              '吞吐量激增（接管负载）数据',
            ),
          ],
          createdAt: now,
        },
      }

    case 5:
      return {
        round: 5,
        plan: {
          id: nextPlanId(),
          round: 5,
          goal: '验证 LUN 时延恢复和业务影响链',
          selectionReason: '需要确认业务影响程度和恢复时间，完善影响链证据',
          tasks: [
            makeTask(
              'kpi',
              ['lun-db01'],
              '查看 LUN-DB01 时延恢复曲线',
              '时延峰值和恢复时间',
            ),
            makeTask(
              'link_health',
              ['switch-01', 'switch-02'],
              '检查 FC 链路健康状况',
              '链路降级状态和恢复时间',
            ),
          ],
          createdAt: now,
        },
      }

    case 6:
      // REPLAN 2: 主动检查竞争候选
      return {
        round: 6,
        isReplan: true,
        triggerEvidenceId: 'evidence-link-recovered',
        replanChanges: [
          '新增：相似案例搜索（验证根因一致性）',
          '调整：FC 链路故障候选已被证据削弱，确认排除',
        ],
        plan: {
          id: nextPlanId(),
          round: 6,
          goal: '最终竞争候选检查和相似案例验证',
          selectionReason: '需要确认没有其他可能的解释，并通过相似案例增强根因信心',
          tasks: [
            makeTask(
              'similar_case',
              ['controller-0a'],
              '搜索与当前症状相似的历史案例',
              '相似案例的根因和处理方式',
            ),
          ],
          createdAt: now,
        },
      }

    case 7:
      return {
        round: 7,
        isTerminal: true,
        plan: {
          id: nextPlanId(),
          round: 7,
          goal: '结论收敛 — 检查证据链完整性',
          selectionReason: '所有证据已收集完毕，进入终态门控检查',
          tasks: [],
          createdAt: now,
        },
      }

    default:
      return null
  }
}

export const TOTAL_ROUNDS = 7
