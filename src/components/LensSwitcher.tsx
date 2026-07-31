import {
  Activity,
  BookOpen,
  GitBranch,
  Network,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'
import { LensId } from '../../schemas'
import { LENS_DEFINITIONS } from '@/lib/model-loader'
import { cn } from '@/lib/utils'

const ICON: Record<LensId, LucideIcon> = {
  [LensId.TOPOLOGY]: Network,
  [LensId.KNOWLEDGE]: BookOpen,
  [LensId.DIAGNOSIS]: Activity,
  [LensId.IMPACT]: GitBranch,
  [LensId.AUDIT]: ScrollText,
}

export default function LensSwitcher({
  activeLens,
  onChange,
}: {
  activeLens: LensId
  onChange: (lens: LensId) => void
}) {
  return (
    <nav
      aria-label="Ontology Lens"
      className="ontology-lens-switcher pointer-events-auto absolute left-1/2 top-[62px] z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-[#11141c]/92 p-1 shadow-xl backdrop-blur-md"
    >
      {Object.values(LensId).map((lens) => {
        const Icon = ICON[lens]
        const definition = LENS_DEFINITIONS[lens]
        return (
          <button
            key={lens}
            type="button"
            title={definition.description}
            onClick={() => onChange(lens)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors',
              activeLens === lens
                ? 'bg-status-active/18 text-[#e2e8f0]'
                : 'text-[#64748b] hover:bg-white/5 hover:text-[#cbd5e1]',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {definition.label}
          </button>
        )
      })}
    </nav>
  )
}
