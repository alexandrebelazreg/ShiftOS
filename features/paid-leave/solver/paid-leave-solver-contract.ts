import { z } from "zod"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import {
  effectiveRequestedWeeks,
  preferenceRank,
} from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveReinforcementAllocation,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

const weekIdSchema = z.string().regex(/^\d{4}-W\d{2}$/)

export const paidLeaveSolveRequestSchema = z.object({
  campaignId: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
  weeks: z.array(weekIdSchema),
  sectors: z.array(z.object({ id: z.string(), name: z.string() })),
  employees: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sectorId: z.string().nullable(),
    contractHours: z.number().nonnegative(),
    targetWeeks: z.number().int().nonnegative(),
    linkedEmployeeId: z.string().nullable(),
    seniorityOrder: z.number().int().nonnegative(),
    firstChoiceHistory: z.number().int().nonnegative(),
    choices: z.array(z.object({ weekId: weekIdSchema, rank: z.union([z.literal(1), z.literal(2), z.literal(3)]) })),
  })),
  coverage: z.array(z.object({
    sectorId: z.string(),
    weekId: weekIdSchema,
    baseContractHours: z.number().nonnegative(),
    minimumHours: z.number().nonnegative(),
    toleratedDeficitHours: z.number().nonnegative(),
  })),
  reinforcementPools: z.array(z.object({
    id: z.string(),
    totalHours: z.number().nonnegative(),
    startWeekId: weekIdSchema,
    endWeekId: weekIdSchema,
    scope: z.union([z.literal("global"), z.literal("sector")]),
    sectorId: z.string().nullable(),
  })),
})

export type PaidLeaveSolveRequest = z.infer<typeof paidLeaveSolveRequestSchema>

export const paidLeaveSolveResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("optimal"),
    grants: z.record(z.string(), z.array(weekIdSchema)),
    reinforcementAllocations: z.array(z.object({
      poolId: z.string(),
      sectorId: z.string(),
      weekId: weekIdSchema,
      hours: z.number().nonnegative(),
    })),
    objectiveValues: z.record(z.string(), z.number()),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("infeasible"),
    message: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("non_optimal"),
    message: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string(),
    durationMs: z.number().nonnegative(),
  }),
])

export type PaidLeaveSolveResponse = z.infer<typeof paidLeaveSolveResponseSchema>

export function buildPaidLeaveSolveRequest({
  campaign,
  employees,
  sectors,
  timeoutSeconds = 60,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly timeoutSeconds?: number
}): PaidLeaveSolveRequest {
  const weeks = campaignWeeks(campaign.year, campaign.period)
  const weekIds = new Set(weeks.map((week) => week.id))
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const sectorByName = new Map(activeSectors.map((sector) => [sector.name, sector]))
  const activeEmployees = employees.filter((employee) => employee.status === "active")
  const seniority = [...activeEmployees].sort((left, right) => {
    const leftDate = campaign.employeeSettings[left.id]?.entryDate ?? left.createdAt
    const rightDate = campaign.employeeSettings[right.id]?.entryDate ?? right.createdAt
    return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id)
  })
  const seniorityOrder = new Map(
    seniority.map((employee, index) => [employee.id, seniority.length - index])
  )

  const solverEmployees = activeEmployees.map((employee) => {
    const request = campaign.requests[employee.id] ?? {
      employeeId: employee.id,
      requestedWeeks: 0,
      wish1: [],
      wish2: [],
      wish3: [],
    }
    const choices = [...new Set([...request.wish1, ...request.wish2, ...request.wish3])]
      .filter((weekId) => weekIds.has(weekId))
      .flatMap((weekId) => {
        const rank = preferenceRank(request, weekId)
        return rank ? [{ weekId, rank }] : []
      })
    const settings = campaign.employeeSettings[employee.id]
    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      sectorId: sectorByName.get(employee.sectors?.[0] ?? "")?.id ?? null,
      contractHours: contractHours(employee),
      // `effectiveRequestedWeeks` compte désormais les mêmes vœux que `choices`
      // — ceux qui tombent dans la période. Le `min` n'est plus un garde-fou
      // contre une divergence, il n'y en a plus : il reste pour dire que la
      // cible ne peut pas dépasser ce qu'il y a à donner.
      targetWeeks: Math.min(effectiveRequestedWeeks(request, weekIds), choices.length),
      linkedEmployeeId: settings?.priority ? settings.linkedEmployeeId : null,
      seniorityOrder: seniorityOrder.get(employee.id) ?? 0,
      firstChoiceHistory: settings?.firstChoiceHistory ?? 0,
      choices,
    }
  })

  const baseBySector = new Map<string, number>()
  for (const employee of solverEmployees) {
    if (!employee.sectorId) continue
    baseBySector.set(
      employee.sectorId,
      (baseBySector.get(employee.sectorId) ?? 0) + employee.contractHours
    )
  }

  return paidLeaveSolveRequestSchema.parse({
    campaignId: campaign.id,
    timeoutSeconds,
    weeks: weeks.map((week) => week.id),
    sectors: activeSectors.map((sector) => ({ id: sector.id, name: sector.name })),
    employees: solverEmployees,
    coverage: activeSectors.flatMap((sector) =>
      weeks.map((week) => {
        const rule = campaign.coverage[sector.id]?.[week.id]
        return {
          sectorId: sector.id,
          weekId: week.id,
          baseContractHours: baseBySector.get(sector.id) ?? 0,
          minimumHours: rule?.minimumHours ?? 0,
          toleratedDeficitHours: rule?.toleratedDeficitHours ?? 0,
        }
      })
    ),
    reinforcementPools: campaign.reinforcementPools,
  })
}

export async function solvePaidLeaveCampaign(
  request: PaidLeaveSolveRequest,
  signal?: AbortSignal
): Promise<PaidLeaveSolveResponse> {
  try {
    const response = await fetch("/api/conges/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    })
    const value: unknown = await response.json()
    if (!response.ok) {
      const message = typeof value === "object" && value !== null && "message" in value
        ? String(value.message)
        : `Erreur HTTP ${response.status}`
      return { status: "error", message, durationMs: 0 }
    }
    const parsed = paidLeaveSolveResponseSchema.safeParse(value)
    return parsed.success
      ? parsed.data
      : { status: "error", message: "Réponse du solveur invalide.", durationMs: 0 }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Le solveur ne répond pas.",
      durationMs: 0,
    }
  }
}

export function isOptimalPaidLeaveResponse(
  response: PaidLeaveSolveResponse
): response is Extract<PaidLeaveSolveResponse, { status: "optimal" }> {
  return response.status === "optimal"
}

function contractHours(employee: EmployeeRecord): number {
  return typeof employee.weeklyMinutes === "number"
    ? employee.weeklyMinutes / 60
    : employee.weeklyHours
}

export type { PaidLeaveReinforcementAllocation }
