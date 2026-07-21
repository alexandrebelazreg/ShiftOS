"use client"

import { useCallback, useEffect, useState } from "react"

import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * React state wrapper around `employeeService`. Holds the list as the single
 * source of truth for the UI and refreshes it after every mutation.
 */
export function useEmployees() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    const list = await employeeService.list()
    setEmployees(list)
  }, [])

  useEffect(() => {
    let active = true
    employeeService.list().then((list) => {
      if (active) {
        setEmployees(list)
        setIsLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const createEmployee = useCallback(
    async (draft: EmployeeDraft) => {
      const created = await employeeService.create(draft)
      await refresh()
      return created
    },
    [refresh]
  )

  const updateEmployee = useCallback(
    async (id: string, draft: EmployeeDraft) => {
      const updated = await employeeService.update(id, draft)
      await refresh()
      return updated
    },
    [refresh]
  )

  const disableEmployee = useCallback(
    async (id: string) => {
      const disabled = await employeeService.disable(id)
      await refresh()
      return disabled
    },
    [refresh]
  )

  return {
    employees,
    isLoading,
    createEmployee,
    updateEmployee,
    disableEmployee,
  }
}
