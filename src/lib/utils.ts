// Shared helpers and semantic color tokens for the fault diagnosis demo.
//
// Color rule (see CLAUDE.md): colors come from semantic status tokens. In the
// default MODEL_OVERVIEW state there is no diagnosis, so every node is neutral —
// blue for the topology plane, purple for the knowledge-graph plane. Fault /
// warning / evidence colors are reserved for Runtime-event-driven overlays and
// must never be set by a view component on its own.

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes with conditional inputs (clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Semantic status colors — mirrors the tokens in tailwind.config.js and the CSS
 * variables in index.css. Used for diagnosis overlays (Runtime-event-driven),
 * never for the neutral overview palette.
 */
export const STATUS_COLORS = {
  fault: 'rgb(235 64 52)',
  warning: 'rgb(245 158 11)',
  active: 'rgb(59 130 246)',
  evidence: 'rgb(20 184 166)',
  recovered: 'rgb(34 197 94)',
  muted: 'rgb(107 114 128)',
} as const

/**
 * Neutral per-plane palette for the model exploration state.
 *   topology → status-active blue
 *   knowledge → violet
 */
export const PLANE_COLORS = {
  topology: '#3b82f6',
  knowledge: '#a78bfa',
} as const

/**
 * Link palette by category. Kept low-opacity so structure reads as a calm mesh
 * until interaction or diagnosis lifts a path's visual weight.
 */
export const LINK_COLORS = {
  /** In-plane topology link (physical / access / service relations). */
  topology: 'rgba(59, 130, 246, 0.32)',
  /** In-plane knowledge-graph link (exhibits / caused-by / evidenced-by …). */
  knowledge: 'rgba(167, 139, 250, 0.28)',
  /** Baseline INSTANCE_OF cross-layer mapping (structural, contextual, faint). */
  crossBaseline: 'rgba(148, 163, 184, 0.16)',
  /** Cross-layer mapping shown once the master toggle is on. */
  crossActive: 'rgba(20, 184, 166, 0.55)',
  /** End-to-end business access path (BUSINESS_PATH preset). */
  businessPath: 'rgba(56, 189, 248, 0.9)',
  /** F2 活动逻辑链（根因 → 证据 → 影响路径）：随诊断推进实时延伸的红色虚拟连线。 */
  logic: '#ef4444',
} as const

/** Clamp a number into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Map a domain health_status string to a zh-CN label for display. */
export function formatHealthStatus(status: string | undefined | null): string {
  if (!status) return '未知'
  switch (status) {
    case 'NORMAL':
      return '正常'
    case 'WARNING':
      return '注意'
    case 'FAULT':
    case 'ABNORMAL':
      return '异常'
    default:
      return status
  }
}

/**
 * Debounce a function by `wait` ms (trailing edge). Used for the navigator
 * search box so filtering does not run on every keystroke.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
