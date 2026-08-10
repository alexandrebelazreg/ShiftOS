import type { DemandInput } from "@/features/core/data-bridge"
import type { Contract, WeekDay } from "@/features/core/models"
import { contractualMinutes, WEEK_DAYS } from "@/features/core/models"
import { enumerateDates, weekDayOf } from "@/features/core/shared"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"

interface AllocationCandidate {
  readonly employee: EmployeeRecord
  readonly priority: number
  readonly originalIndex: number
  readonly availableDays: ReadonlySet<WeekDay>
  readonly minimumDailyMinutes: number
  readonly maximumByDay: ReadonlyMap<WeekDay, number>
  readonly contractMinutes: number
}

export interface AutomaticSectorAllocation {
  readonly assignedEmployeeIds: readonly string[]
  readonly weeklyMinutesByEmployee: ReadonlyMap<string, number>
  readonly dailyBudgetMinutes: Readonly<Record<WeekDay, number>>
  readonly requestedMinutes: number
  readonly allocatedMinutes: number
}

export type AutomaticSectorAllocationResult =
  | { readonly ok: true; readonly allocation: AutomaticSectorAllocation }
  | { readonly ok: false; readonly message: string }

interface FlowEdge {
  to: number
  reverse: number
  capacity: number
  initialCapacity: number
}

const clockMinutes = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null
}

function requirementMinutes(requirement: DemandInput["requirements"][number]): number | null {
  const start = clockMinutes(requirement.start)
  const end = clockMinutes(requirement.end)
  if (start === null || end === null) return null
  const endOffset = requirement.endDayOffset ?? (end < start ? 1 : 0)
  const duration = end + endOffset * 1_440 - start
  return duration >= 0 ? duration * Math.max(0, requirement.minEmployees) : null
}

function maximumForDay(
  employee: EmployeeRecord,
  contract: Contract,
  sector: SectorDemandConfiguration,
  day: WeekDay,
  step: number
): number {
  const hours = sector.hours.find((entry) => entry.day === day)
  if (!hours || hours.closed) return 0
  const opening = clockMinutes(hours.opensAt)
  const closing = clockMinutes(hours.closesAt)
  if (opening === null || closing === null || closing <= opening) return 0

  const employeeStart = employee.earliestStartTime
    ? clockMinutes(employee.earliestStartTime)
    : null
  const employeeEnd = employee.latestEndTime
    ? clockMinutes(employee.latestEndTime)
    : null
  const start = Math.max(opening, employeeStart ?? opening)
  const end = Math.min(closing, employeeEnd ?? closing)
  const windowMinutes = Math.max(0, end - start)
  let maximum = Math.min(
    sector.shiftRules.maximumDailyDuration,
    Math.round(contract.maxDailyHours * 60),
    windowMinutes
  )

  const continuous = sector.shiftRules.maximumContinuousDuration
  if (continuous !== null) {
    const maySplit =
      sector.shiftRules.splitShiftAllowed &&
      employee.splitShiftAllowed &&
      (sector.shiftRules.maximumSplitsPerDay ?? 1) >= 1
    if (!maySplit) {
      maximum = Math.min(maximum, continuous)
    } else {
      const minimumGap = sector.shiftRules.minimumSplitDuration ?? 0
      maximum = Math.min(maximum, 2 * continuous, windowMinutes - minimumGap)
    }
  }
  return Math.max(0, Math.floor(maximum / step) * step)
}

function addEdge(graph: FlowEdge[][], from: number, to: number, capacity: number): FlowEdge {
  const forward: FlowEdge = { to, reverse: graph[to].length, capacity, initialCapacity: capacity }
  const reverse: FlowEdge = { to: from, reverse: graph[from].length, capacity: 0, initialCapacity: 0 }
  graph[from].push(forward)
  graph[to].push(reverse)
  return forward
}

/** Small exact transportation solve: at most seven day nodes plus the roster. */
function maximumFlow(graph: FlowEdge[][], source: number, sink: number): number {
  let total = 0
  for (;;) {
    const parentNode = Array<number>(graph.length).fill(-1)
    const parentEdge = Array<number>(graph.length).fill(-1)
    const queue = [source]
    parentNode[source] = source
    for (let cursor = 0; cursor < queue.length && parentNode[sink] === -1; cursor++) {
      const node = queue[cursor]
      for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex++) {
        const edge = graph[node][edgeIndex]
        if (edge.capacity <= 0 || parentNode[edge.to] !== -1) continue
        parentNode[edge.to] = node
        parentEdge[edge.to] = edgeIndex
        queue.push(edge.to)
      }
    }
    if (parentNode[sink] === -1) return total

    let pushed = Number.POSITIVE_INFINITY
    for (let node = sink; node !== source; node = parentNode[node]) {
      pushed = Math.min(pushed, graph[parentNode[node]][parentEdge[node]].capacity)
    }
    for (let node = sink; node !== source; node = parentNode[node]) {
      const edge = graph[parentNode[node]][parentEdge[node]]
      edge.capacity -= pushed
      graph[node][edge.reverse].capacity += pushed
    }
    total += pushed
  }
}

function allocateCandidateSet(
  candidates: readonly AllocationCandidate[],
  openDays: readonly WeekDay[],
  demandByDay: Readonly<Record<WeekDay, number>>,
  step: number
): Pick<AutomaticSectorAllocation, "weeklyMinutesByEmployee" | "dailyBudgetMinutes" | "allocatedMinutes"> | null {
  const budgets = Object.fromEntries(WEEK_DAYS.map((day) => [day, 0])) as Record<WeekDay, number>
  const minimumByCandidate = candidates.map(() => 0)
  const minimumByDay = openDays.map((day) =>
    candidates.reduce((sum, candidate, employeeIndex) => {
      if (!candidate.availableDays.has(day)) return sum
      minimumByCandidate[employeeIndex] += candidate.minimumDailyMinutes
      return sum + candidate.minimumDailyMinutes
    }, 0)
  )

  for (const [dayIndex, day] of openDays.entries()) {
    const requested = demandByDay[day]
    const budget = Math.max(requested, minimumByDay[dayIndex])
    const maximum = candidates.reduce(
      (sum, candidate) => sum + (candidate.maximumByDay.get(day) ?? 0),
      0
    )
    if (budget > maximum || budget % step !== 0) return null
    budgets[day] = budget
  }

  if (candidates.some((candidate, index) => minimumByCandidate[index] > candidate.contractMinutes)) {
    return null
  }

  // Lower bounds are installed directly. The max-flow only transports the
  // remaining quarter-hours while respecting both daily and weekly ceilings.
  const dayCount = openDays.length
  const employeeCount = candidates.length
  const source = 0
  const firstDay = 1
  const firstEmployee = firstDay + dayCount
  const sink = firstEmployee + employeeCount
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => [])
  const dayEmployeeEdges = new Map<string, FlowEdge>()
  let requiredExtraSteps = 0

  for (const [dayIndex, day] of openDays.entries()) {
    const extra = (budgets[day] - minimumByDay[dayIndex]) / step
    requiredExtraSteps += extra
    addEdge(graph, source, firstDay + dayIndex, extra)
    // Rotate the first edge from one day to the next. Edmonds–Karp is exact but
    // deterministic; without this rotation it would always give every optional
    // minute to the first priority employee before considering the next one.
    for (let offset = 0; offset < employeeCount; offset++) {
      const employeeIndex = (dayIndex + offset) % employeeCount
      const candidate = candidates[employeeIndex]
      if (!candidate.availableDays.has(day)) continue
      const maximum = candidate.maximumByDay.get(day) ?? 0
      const edge = addEdge(
        graph,
        firstDay + dayIndex,
        firstEmployee + employeeIndex,
        (maximum - candidate.minimumDailyMinutes) / step
      )
      dayEmployeeEdges.set(`${dayIndex}:${employeeIndex}`, edge)
    }
  }
  for (const [employeeIndex, candidate] of candidates.entries()) {
    addEdge(
      graph,
      firstEmployee + employeeIndex,
      sink,
      (candidate.contractMinutes - minimumByCandidate[employeeIndex]) / step
    )
  }

  if (maximumFlow(graph, source, sink) !== requiredExtraSteps) return null

  const weeklyMinutes = new Map<string, number>()
  for (const [employeeIndex, candidate] of candidates.entries()) {
    let total = minimumByCandidate[employeeIndex]
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
      const edge = dayEmployeeEdges.get(`${dayIndex}:${employeeIndex}`)
      if (edge) total += (edge.initialCapacity - edge.capacity) * step
    }
    weeklyMinutes.set(candidate.employee.id, total)
  }

  return {
    weeklyMinutesByEmployee: weeklyMinutes,
    dailyBudgetMinutes: budgets,
    allocatedMinutes: Object.values(budgets).reduce((sum, minutes) => sum + minutes, 0),
  }
}

/**
 * Size one independently-generated sector from its coverage instead of adding
 * every assigned employee's complete employment contract.
 *
 * The returned contract minutes are transient planning volumes. Persisted
 * employee contracts are never changed. Employees are considered in sector
 * priority order and only the smallest viable prefix is retained, avoiding the
 * mandatory-minimum trap where six assigned people would each have to work at
 * least four hours on a day whose whole need is thirteen hours.
 */
export function allocateAutomaticSectorHours(input: {
  readonly sector: SectorDemandConfiguration
  readonly employees: readonly EmployeeRecord[]
  readonly contracts: readonly Contract[]
  readonly demand: DemandInput
  readonly period: { readonly start: string; readonly end: string }
  readonly minimumShiftMinutes: number
  readonly timeStepMinutes?: number
}): AutomaticSectorAllocationResult {
  const step = input.timeStepMinutes ?? 15
  const dates = enumerateDates(input.period.start, input.period.end)
  const openDays = dates
    .map((date) => weekDayOf(date))
    .filter((day) => input.sector.hours.some((hours) => hours.day === day && !hours.closed))
  if (openDays.length === 0) {
    return { ok: false, message: `Le rayon « ${input.sector.name} » n'a aucun jour ouvert sur cette semaine.` }
  }

  const demandByDay = Object.fromEntries(WEEK_DAYS.map((day) => [day, 0])) as Record<WeekDay, number>
  for (const requirement of input.demand.requirements) {
    if (!requirement.id.startsWith(`req_${input.sector.id}_`)) continue
    const duration = requirementMinutes(requirement)
    if (duration === null || duration % step !== 0) {
      return {
        ok: false,
        message: `Le besoin ${requirement.id} n'est pas exprimé par pas de ${step} minutes.`,
      }
    }
    demandByDay[weekDayOf(requirement.date)] += duration
  }
  const requestedMinutes = Object.values(demandByDay).reduce((sum, minutes) => sum + minutes, 0)
  if (requestedMinutes === 0) {
    return {
      ok: false,
      message: `Le besoin du rayon « ${input.sector.name} » est de 0 h : renseignez au moins un salarié requis dans la couverture.`,
    }
  }

  const contractsByEmployee = new Map(input.contracts.map((contract) => [String(contract.employeeId), contract]))
  const candidates: AllocationCandidate[] = input.employees
    .map((employee, originalIndex): AllocationCandidate | null => {
      if (employee.status !== "active" || !employee.sectors?.includes(input.sector.name)) return null
      const contract = contractsByEmployee.get(employee.id)
      if (!contract) return null
      const fixedRest = new Set([...employee.fixedDaysOff, ...employee.forbiddenDays])
      const availableDays = new Set(
        openDays.filter((day) => contract.workingDays.includes(day) && !fixedRest.has(day))
      )
      if (availableDays.size === 0) return null
      const minimumDailyMinutes = Math.max(
        input.minimumShiftMinutes,
        Math.round(contract.minDailyHours * 60)
      )
      const maximumByDay = new Map(
        [...availableDays].map((day) => [
          day,
          maximumForDay(employee, contract, input.sector, day, step),
        ])
      )
      const contractMinutes = contractualMinutes(contract)
      if (
        minimumDailyMinutes <= 0 ||
        minimumDailyMinutes % step !== 0 ||
        contractMinutes % step !== 0 ||
        [...maximumByDay.values()].some(
          (maximum) => maximum < minimumDailyMinutes || maximum % step !== 0
        )
      ) return null
      return {
        employee,
        priority: employee.sectors.indexOf(input.sector.name),
        originalIndex,
        availableDays,
        minimumDailyMinutes,
        maximumByDay,
        contractMinutes,
      }
    })
    .filter((candidate): candidate is AllocationCandidate => candidate !== null)
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex)

  if (candidates.length === 0) {
    return {
      ok: false,
      message: `Aucun salarié actif affecté au rayon « ${input.sector.name} » ne possède un contrat compatible avec ses jours ouverts.`,
    }
  }

  for (let count = 1; count <= candidates.length; count++) {
    const selected = candidates.slice(0, count)
    const allocation = allocateCandidateSet(selected, openDays, demandByDay, step)
    if (!allocation) continue
    return {
      ok: true,
      allocation: {
        assignedEmployeeIds: selected.map((candidate) => candidate.employee.id),
        ...allocation,
        requestedMinutes,
      },
    }
  }

  const requestedHours = (requestedMinutes / 60).toLocaleString("fr-FR", { maximumFractionDigits: 2 })
  return {
    ok: false,
    message: `Le rayon « ${input.sector.name} » demande ${requestedHours} h sur la semaine, mais aucun groupe prioritaire de salariés ne peut les répartir en respectant contrats, jours disponibles et durées quotidiennes.`,
  }
}
