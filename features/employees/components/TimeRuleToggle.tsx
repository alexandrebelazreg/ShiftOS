"use client"

import { cn } from "@/lib/utils"

/**
 * Le choix entre une BORNE et une HEURE IMPOSÉE, pour un même champ d'heure.
 *
 * « Ne commence pas avant 9 h » et « commence à 9 h » se saisissent dans la
 * même case et ne veulent pas dire la même chose : la première laisse le
 * solveur placer plus tard, la seconde le cloue. Les présenter comme deux
 * réglages séparés doublerait le nombre de règles apparentes et laisserait
 * saisir les deux ; ce sélecteur les présente pour ce qu'ils sont, deux
 * lectures du même horaire.
 */
export function TimeRuleToggle({
  value,
  onChange,
  looseLabel,
  exactLabel,
  ariaLabel,
}: {
  value: boolean
  onChange: (next: boolean) => void
  looseLabel: string
  exactLabel: string
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-input p-0.5"
    >
      {[
        { exact: false, label: looseLabel },
        { exact: true, label: exactLabel },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          aria-checked={value === option.exact}
          onClick={() => onChange(option.exact)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            value === option.exact
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
