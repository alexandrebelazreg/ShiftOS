import { cn } from "@/lib/utils"

import type { WarningLevel } from "@/features/planning/editor"

const BADGE: Record<WarningLevel, string> = {
  green: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-500 border-yellow-500/30",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
}

const DOT: Record<WarningLevel, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
}

/** A small coloured chip for a warning level. */
export function LevelBadge({
  level,
  children,
  className,
}: {
  level: WarningLevel
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium",
        BADGE[level],
        className
      )}
    >
      {children}
    </span>
  )
}

/** A tiny coloured status dot. */
export function LevelDot({ level, className }: { level: WarningLevel; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[level], className)} />
}
