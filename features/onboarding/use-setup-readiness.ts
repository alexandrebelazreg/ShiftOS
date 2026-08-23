"use client"

import { useEffect, useMemo, useState } from "react"

import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import { evaluateSetupReadiness, type SetupSector } from "@/features/onboarding/setup-readiness"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/** React adapter around the first-run readiness policy. */
export function useSetupReadiness(store: StoreConfig | null) {
  const { employees, isLoading } = useEmployees()
  const [sectors, setSectors] = useState<readonly SetupSector[]>([])
  const [isSetupLoading, setIsSetupLoading] = useState(true)

  useEffect(() => {
    queueMicrotask(() => { void createSetupRepository().listSectors().then((list) => { setSectors(list); setIsSetupLoading(false) }) })
  }, [])

  const readiness = useMemo(
    () => evaluateSetupReadiness({ store, employees, sectors }),
    [store, employees, sectors]
  )

  return { ...readiness, sectors, isLoading: isLoading || isSetupLoading }
}
