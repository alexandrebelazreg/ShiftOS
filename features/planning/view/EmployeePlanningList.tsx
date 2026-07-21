import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { WEEK_DAY_LABELS } from "@/features/store/lib/constants"
import type { EmployeePlanningRow } from "@/features/planning/view/employee-planning-view-model"

function formatHours(hours: number): string {
  return `${Math.round(hours * 100) / 100}h`
}

/**
 * Planning grouped by employee — one card per employee with their contracted
 * days, total hours and each shift (start / end / hours, flagged when split).
 * Pure presentation of the view-model rows.
 */
export function EmployeePlanningList({ rows }: { rows: readonly EmployeePlanningRow[] }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <Card key={row.employeeId}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{row.name}</CardTitle>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatHours(row.totalHours)} · {row.shifts.length} service(s)
              </span>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {row.workingDays.map((day) => (
                <Badge key={day} variant="secondary">
                  {WEEK_DAY_LABELS[day]}
                </Badge>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {row.shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun service affecté.</p>
            ) : (
              <ul className="divide-y">
                {row.shifts.map((shift, index) => (
                  <li
                    key={`${shift.date}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="font-medium tabular-nums">{shift.date}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {shift.start} – {shift.end}
                    </span>
                    <span className="tabular-nums">{formatHours(shift.hours)}</span>
                    {shift.isSplit ? (
                      <Badge variant="outline">
                        Coupure ·{" "}
                        {shift.segments.map((s) => `${s.start}–${s.end}`).join(" / ")}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
