"use client"

import { EmployeeForm } from "@/features/employees/components/EmployeeForm"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * Right-side drawer hosting the employee form (create or edit). Not a modal
 * dialog — a side panel, per spec.
 */
export function EmployeeDrawer({
  open,
  onOpenChange,
  employee,
  onSubmit,
  onDisable,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeRecord | null
  onSubmit: (draft: EmployeeDraft) => void | Promise<void>
  onDisable?: (employee: EmployeeRecord) => void | Promise<void>
}) {
  const isEdit = Boolean(employee)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>
            {isEdit && employee ? getFullName(employee) : "Nouvel employé"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Mettez à jour les informations et contraintes de cet employé."
              : "Ajoutez un nouveau membre à votre équipe."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-hidden p-4">
          <EmployeeForm
            key={employee?.id ?? "new"}
            employee={employee}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
            onDisable={onDisable}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
