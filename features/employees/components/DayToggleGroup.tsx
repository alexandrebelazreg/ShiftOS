"use client"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { WEEK_DAY_SHORT_LABELS } from "@/features/employees/utils/employee.labels"
import { cn } from "@/lib/utils"

/**
 * Reusable week-day multi-select rendered as toggle pills. Used for working
 * days, fixed days off and forbidden days.
 */
export function DayToggleGroup({
  value,
  onChange,
  ariaLabel,
}: {
  value: WeekDay[]
  onChange: (next: WeekDay[]) => void
  ariaLabel?: string
}) {
  function toggle(day: WeekDay) {
    onChange(
      value.includes(day)
        ? value.filter((d) => d !== day)
        : [...value, day]
    )
  }

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {WEEK_DAYS.map((day) => {
        const selected = value.includes(day)
        return (
          <button
            key={day}
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={() => toggle(day)}
            className={cn(
              "h-8 min-w-11 rounded-md border px-2.5 text-xs font-medium transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {WEEK_DAY_SHORT_LABELS[day]}
          </button>
        )
      })}
    </div>
  )
}
