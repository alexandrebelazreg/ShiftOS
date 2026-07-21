"use client"

import { useEffect } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { employeeSchema } from "@/features/employees/schemas/employee.schema"
import type {
  EmployeeRecord,
  EmployeeFormValues,
} from "@/features/employees/types/employee.types"
import {
  createEmptyEmployeeFormValues,
  employeeToFormValues,
} from "@/features/employees/utils/employee.mappers"

/**
 * Configures the React Hook Form instance shared by the create and edit flows.
 * When `employee` changes (e.g. selecting another card), the form resets to the
 * matching values.
 */
export function useEmployeeForm(employee: EmployeeRecord | null) {
  const form = useForm<EmployeeFormValues>({
    // The form holds raw values (numbers as strings); Zod coerces them. The
    // cast reconciles the input/output type gap of a coercing schema.
    resolver: zodResolver(employeeSchema) as unknown as Resolver<EmployeeFormValues>,
    defaultValues: employee
      ? employeeToFormValues(employee)
      : createEmptyEmployeeFormValues(),
    mode: "onSubmit",
  })

  const { reset } = form
  useEffect(() => {
    reset(
      employee ? employeeToFormValues(employee) : createEmptyEmployeeFormValues()
    )
  }, [employee, reset])

  return form
}
