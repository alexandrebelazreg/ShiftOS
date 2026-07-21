import { Badge } from "@/components/ui/badge"
import type { EmployeeStatus } from "@/features/core/models"
import { EMPLOYEE_STATUS_LABELS } from "@/features/employees/utils/employee.labels"
import { cn } from "@/lib/utils"

/** Colored status pill (active = accent, inactive = muted). */
export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const isActive = status === "active"
  return (
    <Badge
      variant={isActive ? "outline" : "secondary"}
      className={cn(
        "gap-1.5",
        isActive ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-emerald-500" : "bg-muted-foreground/50"
        )}
      />
      {EMPLOYEE_STATUS_LABELS[status]}
    </Badge>
  )
}
