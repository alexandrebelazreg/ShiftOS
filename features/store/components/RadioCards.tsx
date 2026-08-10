"use client"

import { useId } from "react"

import { cn } from "@/lib/utils"

export type RadioCardOption<T extends string> = {
  value: T
  label: string
  description?: string
}

/**
 * Reusable radio group rendered as selectable cards. Used for any
 * single-choice section (planning mode, split-shift policy, …).
 */
export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  invalid,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly RadioCardOption<T>[]
  invalid?: boolean
  className?: string
}) {
  const groupName = useId()

  return (
    <div
      role="radiogroup"
      aria-invalid={invalid || undefined}
      className={cn("gap-2", className)}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              selected
                ? "border-primary bg-primary/5"
                : "border-input hover:bg-muted/50"
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              aria-label={option.label}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              {option.description ? (
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </div>
          </label>
        )
      })}
    </div>
  )
}
