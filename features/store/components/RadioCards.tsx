"use client"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
}: {
  value: T
  onChange: (value: T) => void
  options: readonly RadioCardOption<T>[]
  invalid?: boolean
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-invalid={invalid || undefined}
      className="gap-2"
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <div
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              selected
                ? "border-primary bg-primary/5"
                : "border-input hover:bg-muted/50"
            )}
          >
            <RadioGroupItem
              value={option.value}
              aria-label={option.label}
              className="mt-0.5"
            />
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              {option.description ? (
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </RadioGroup>
  )
}
