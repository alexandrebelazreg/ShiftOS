import { WEEK_DAYS, type EmployeeId, type ShiftId, type ShiftSegment } from "@/features/core/models"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WEEK_DAY_LABELS } from "@/features/store/lib/constants"
import type { EmployeeSummary } from "@/features/planning/editor"
import { LevelBadge } from "@/features/planning/editor/ui/level-badge"

interface EmployeeViewProps {
  readonly employees: readonly { id: EmployeeId; name: string }[]
  readonly selectedEmployeeId: EmployeeId | null
  readonly onSelectEmployee: (id: EmployeeId) => void
  readonly summary: EmployeeSummary | null
  readonly onEditShiftTime: (shiftId: ShiftId, segment: Partial<ShiftSegment>) => void
  readonly onDeleteShift: (shiftId: ShiftId) => void
  readonly readOnly?: boolean
}

function hrs(value: number): string {
  const minutes = Math.round(Math.abs(value) * 60), hours = Math.floor(minutes / 60), remainder = minutes % 60
  return `${value < 0 ? "-" : ""}${hours} h${remainder ? ` ${String(remainder).padStart(2, "0")}` : ""}`
}

/**
 * Employee View — the entire week for one selected employee, with an
 * always-visible summary (contract vs planned, opening/closing/Saturday counts,
 * warnings) and inline start/end editing. Same single planning as the Sector
 * View; switching is pure state, no reload or regeneration.
 */
export function EmployeeView({
  employees,
  selectedEmployeeId,
  onSelectEmployee,
  summary,
  onEditShiftTime,
  onDeleteShift,
  readOnly = false,
}: EmployeeViewProps) {
  return (
    <div className="space-y-4">
      <select
        value={selectedEmployeeId ?? ""}
        onChange={(event) => onSelectEmployee(event.target.value as EmployeeId)}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      >
        {employees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.name}
          </option>
        ))}
      </select>

      {summary ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{summary.name}</CardTitle>
                <LevelBadge level={summary.level} className="uppercase">
                  {summary.level}
                </LevelBadge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow label="Heures contractuelles" value={hrs(summary.contractHours)} />
              <SummaryRow label="Heures planifiées" value={hrs(summary.plannedHours)} />
              <SummaryRow
                label="Écart"
                value={`${summary.differenceHours >= 0 ? "+" : ""}${hrs(summary.differenceHours)}`}
              />
              <SummaryRow label="Ouvertures" value={String(summary.openingCount)} />
              <SummaryRow label="Fermetures" value={String(summary.closingCount)} />
              <SummaryRow label="Samedis" value={String(summary.saturdayCount)} />
              {summary.warnings.length > 0 ? (
                <ul className="space-y-1 pt-2">
                  {summary.warnings.map((warning, index) => (
                    <li key={index} className="text-xs text-muted-foreground">
                      • {warning}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pt-2 text-xs text-muted-foreground">Aucune alerte.</p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
                <CardTitle className="text-base">Semaine</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {WEEK_DAYS.map((day) => {
                  const dailyShifts = summary.shifts.filter((shift) => shift.weekDay === day).slice(0, 2)
                  return <li key={day} className="grid gap-2 py-3 text-sm sm:grid-cols-[7rem_1fr]">
                    <span className="font-medium">{WEEK_DAY_LABELS[day]}</span>
                    {dailyShifts.length === 0 ? <span className="text-muted-foreground">Repos</span> : <div className="space-y-2">{dailyShifts.map((shift) => <div key={shift.assignmentId} className="flex flex-wrap items-center gap-2"><input type="time" disabled={readOnly} defaultValue={shift.start} onChange={(event) => onEditShiftTime(shift.shiftId as ShiftId, { startTime: event.target.value })} className="h-8 rounded border bg-background px-2 text-xs" aria-label="Début du service" /><span className="text-muted-foreground">–</span><input type="time" disabled={readOnly} defaultValue={shift.end} onChange={(event) => onEditShiftTime(shift.shiftId as ShiftId, { endTime: event.target.value })} className="h-8 rounded border bg-background px-2 text-xs" aria-label="Fin du service" /><span className="tabular-nums">{hrs(shift.hours)}</span>{dailyShifts.length > 1 ? <span className="text-xs text-muted-foreground">(coupure)</span> : null}<button type="button" disabled={readOnly} onClick={() => onDeleteShift(shift.shiftId as ShiftId)} className="ml-auto text-xs text-muted-foreground hover:text-destructive" aria-label="Supprimer le service">Supprimer</button></div>)}</div>}
                  </li>
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sélectionnez un employé.</p>
      )}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}
