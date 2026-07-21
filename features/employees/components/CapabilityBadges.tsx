import { Split, Sunrise, Sunset } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type Capability = {
  label: string
  icon: typeof Sunrise
  enabled: boolean
}

/**
 * Compact on/off indicators for the three shift capabilities shown on cards:
 * can open, can close, split shift allowed.
 */
export function CapabilityBadges({
  canOpen,
  canClose,
  splitShiftAllowed,
}: {
  canOpen: boolean
  canClose: boolean
  splitShiftAllowed: boolean
}) {
  const capabilities: Capability[] = [
    { label: "Ouverture", icon: Sunrise, enabled: canOpen },
    { label: "Fermeture", icon: Sunset, enabled: canClose },
    { label: "Coupure", icon: Split, enabled: splitShiftAllowed },
  ]

  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.map(({ label, icon: Icon, enabled }) => (
        <Badge
          key={label}
          variant="outline"
          className={cn(
            "gap-1",
            enabled
              ? "border-border text-foreground"
              : "border-dashed text-muted-foreground/60"
          )}
        >
          <Icon className={cn(enabled ? "opacity-100" : "opacity-50")} />
          {label}
        </Badge>
      ))}
    </div>
  )
}
