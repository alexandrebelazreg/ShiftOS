"use client"

import { ChevronDown } from "lucide-react"
import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

/**
 * A titled section that folds away, built on native `<details>`/`<summary>`.
 *
 * Native rather than state-driven on purpose: the disclosure semantics,
 * keyboard handling and "find in page" behaviour come for free and stay correct
 * without a single line of ours, and the section keeps working before hydration.
 *
 * `summary` is what the section says while it is CLOSED — the reason a manager
 * can leave it closed and still know something is set inside.
 */
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  revealWhen = false,
  className,
  children,
}: {
  title: string
  summary?: readonly string[]
  defaultOpen?: boolean
  /**
   * Forces the section open when it becomes true — for the one case a fold must
   * not win: something inside needs the user NOW, typically a validation error.
   *
   * A rejected submit that lands on a hidden field is worse than no message at
   * all: the form says "corrigez les champs signalés" and the user finds an
   * intact-looking screen. Opening is one-way on purpose — it reveals, then
   * stops interfering, so the user may fold it back while still in error.
   */
  revealWhen?: boolean
  className?: string
  children: React.ReactNode
}) {
  const active = summary !== undefined && summary.length > 0
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (revealWhen && ref.current) ref.current.open = true
  }, [revealWhen])

  return (
    <details
      ref={ref}
      open={defaultOpen}
      className={cn("group rounded-lg border border-border", className)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {active ? (
            <p className="truncate text-xs text-muted-foreground group-open:hidden">
              {summary.join(" · ")}
            </p>
          ) : null}
        </div>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-4 border-t border-border p-3">{children}</div>
    </details>
  )
}
