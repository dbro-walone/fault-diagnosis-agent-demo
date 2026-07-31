/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,css}",
    "./*.{html,ts,tsx}",
    "./ui/**/*.{html,ts,tsx}",
    "./modules/**/*.{html,ts,tsx}",
    "./routing/**/*.{html,ts,tsx}",
    "./runtime/**/*.{html,ts,tsx}",
    "./schemas/**/*.{html,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 语义 Token — 故障诊断状态色彩
        'status-fault': 'rgb(235 64 52)',      // 当前故障、强异常、根因对象 — 克制珊瑚红
        'status-warning': 'rgb(245 158 11)',   // 冲突、证据缺失、待验证 — 琥珀色
        'status-active': 'rgb(59 130 246)',    // 当前计划、当前 Skill、当前焦点 — 电光蓝
        'status-evidence': 'rgb(20 184 166)',  // 新事实、支持证据、证据链 — 青绿色
        'status-recovered': 'rgb(34 197 94)',  // 已恢复、有效冗余路径 — 低饱和绿色
        'status-muted': 'rgb(107 114 128)',    // 未参与、历史状态、弱关联 — 中性灰
      },
      fontSize: {
        'tabular': ['inherit', { fontVariantNumeric: 'tabular-nums' }],
      },
      animation: {
        'fade-in': 'opacity 120ms ease-in-out',
        'slide-up': 'transform 180ms ease-out',
        'pulse-once': 'pulse 0.6s ease-in-out 1',
      },
    },
  },
  plugins: [],
}
