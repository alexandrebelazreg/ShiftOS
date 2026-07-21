import { contractualMinutes, type Contract, type Employee, type EmployeeId, type Store } from "@/features/core/models"
import { intervalMinutes, weekDayOf } from "@/features/core/shared"
import type { GenerationSettings, SectorPlanningRules } from "@/features/core/planning-generator/types"
import type { CoverageRequirement } from "@/features/core/demand-engine"
import { allocateDailyContractMinutes } from "@/features/core/planning-generator/pipeline/weekly-distribution"

export interface EmployeeDailyAllocation { readonly employeeId: EmployeeId; readonly minutesByDate: Readonly<Record<string, number>> }
export interface DailyAllocationTotal { readonly date: string; readonly targetMinutes: number; readonly allocatedMinutes: number; readonly differenceMinutes: number }
export interface WeeklyMinuteAllocation { readonly rows: readonly EmployeeDailyAllocation[]; readonly dailyTotals: readonly DailyAllocationTotal[]; readonly exactDailyBudgets: boolean; readonly errors: readonly string[] }

interface Edge { to: number; reverse: number; capacity: number; cost: number }
interface UnitEdge { edge: Edge; employeeId: EmployeeId; date: string }
export interface AllocationAvailability { readonly maximumContinuousMinutes: number; readonly reason?: string }

export function allocateWeeklyMinutes(input: { employees: readonly Employee[]; contracts: readonly Contract[]; dates: readonly string[]; store: Store; sector: SectorPlanningRules; settings: GenerationSettings; requirements?: readonly CoverageRequirement[]; availabilityByEmployeeDate?: ReadonlyMap<string, AllocationAvailability> }): WeeklyMinuteAllocation {
  const { sector, settings } = input, increment = settings.timeIncrementMinutes ?? 15, minimum = sector.minimumShiftDuration
  const employees = [...input.employees].filter((employee) => employee.status === "active" && sector.assignedEmployeeIds.includes(employee.id)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const dates = [...input.dates].sort(), errors: string[] = []
  const totalMinutes = employees.reduce((sum, employee) => { const contract = input.contracts.find((item) => item.employeeId === employee.id); return sum + (contract ? contractualMinutes(contract) : 0) }, 0)
  const targetByDay = new Map(allocateDailyContractMinutes(totalMinutes, sector.weeklyDistribution, increment).map((target) => [target.day, target.targetMinutes]))
  const targetByDate = new Map(dates.map((date) => [date, targetByDay.get(weekDayOf(date)) ?? 0]))
  const base = new Map<string, number>(), maximum = new Map<string, number>(), supplyByEmployee = new Map<EmployeeId, number>()
  for (const employee of employees) {
    const contract = input.contracts.find((item) => item.employeeId === employee.id)
    if (!contract) { errors.push(`Aucun contrat pour ${employee.firstName}.`); continue }
    const contractUnits = contractualMinutes(contract) / increment
    if (!Number.isInteger(contractUnits)) { errors.push(`Le contrat de ${employee.firstName} n’est pas multiple de ${increment} minutes.`); continue }
    let baseUnits = 0, capacityUnits = 0, requiredDays = 0
    for (const date of dates) {
      const day = weekDayOf(date), storeHours = input.store.openingHours.find((item) => item.day === day), sectorHours = sector.hours?.find((item) => item.day === day)
      const openMinutes = storeHours && !storeHours.closed && storeHours.opensAt && storeHours.closesAt ? intervalMinutes(storeHours.opensAt, storeHours.closesAt) ?? 0 : 0
      const sectorMinutes = sectorHours && !sectorHours.closed ? intervalMinutes(sectorHours.opensAt as never, sectorHours.closesAt as never) ?? 0 : openMinutes
      const allowed = contract.workingDays.includes(day) && openMinutes > 0 && sectorMinutes > 0
      const key = `${employee.id}|${date}`, availability = input.availabilityByEmployeeDate?.get(key), dailyMaximum = Math.min(settings.maximumDailyMinutes ?? 600, contract.maxDailyHours * 60, openMinutes, sectorMinutes, availability?.maximumContinuousMinutes ?? Number.POSITIVE_INFINITY)
      const required = sector.workEveryNonFixedRestDay === true && allowed
      if (required) requiredDays++
      const lower = required ? minimum : 0, upper = allowed ? Math.floor(dailyMaximum / increment) * increment : 0
      if (required && upper < minimum) errors.push(`${employee.firstName} ne peut pas placer le shift minimum de ${minimum} minutes le ${date}${availability?.reason ? ` (${availability.reason})` : ""}.`)
      base.set(key, lower / increment); maximum.set(key, upper / increment); baseUnits += lower / increment; capacityUnits += upper / increment
    }
    if (requiredDays * minimum > contractualMinutes(contract)) errors.push(`${employee.firstName} : ${requiredDays} jours obligatoires × ${minimum} minutes dépassent son contrat de ${contractualMinutes(contract)} minutes.`)
    if (contractUnits > capacityUnits) errors.push(`${employee.firstName} : capacité hebdomadaire ${capacityUnits * increment} minutes inférieure au contrat ${contractualMinutes(contract)} minutes.`)
    supplyByEmployee.set(employee.id, contractUnits - baseUnits)
  }
  if (errors.length) return { rows: [], dailyTotals: [], exactDailyBudgets: false, errors }

  const source = 0, employeeOffset = 1, dayOffset = employeeOffset + employees.length, sink = dayOffset + dates.length, graph: Edge[][] = Array.from({ length: sink + 1 }, () => []), unitEdges: UnitEdge[] = []
  const addEdge = (from: number, to: number, capacity: number, cost: number) => { const forward: Edge = { to, reverse: graph[to].length, capacity, cost }, reverse: Edge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost }; graph[from].push(forward); graph[to].push(reverse); return forward }
  let requiredFlow = 0
  for (const [employeeIndex, employee] of employees.entries()) {
    const supply = supplyByEmployee.get(employee.id) ?? 0; requiredFlow += supply; addEdge(source, employeeOffset + employeeIndex, supply, 0)
    const contract = input.contracts.find((item) => item.employeeId === employee.id)!, contractUnits = contractualMinutes(contract) / increment
    for (const [dateIndex, date] of dates.entries()) {
      const key = `${employee.id}|${date}`, lower = base.get(key) ?? 0, upper = maximum.get(key) ?? 0, opening = input.requirements?.filter((requirement) => requirement.window.date === date).sort((a, b) => a.window.start.localeCompare(b.window.start))[0], eligibleOpeners = employees.filter((candidate) => candidate.capabilities.includes("CAN_OPEN") && (maximum.get(`${candidate.id}|${date}`) ?? 0) > 0).length, bridgeAdjustment = opening && opening.minEmployees >= eligibleOpeners && !employee.capabilities.includes("CAN_OPEN") && employee.capabilities.includes("CAN_CLOSE") ? 3 : 0, target = contractUnits * sector.weeklyDistribution[weekDayOf(date)] / 100 + bridgeAdjustment
      for (let unit = lower + 1; unit <= upper; unit++) { const marginal = Math.round((((unit - target) ** 2) - ((unit - 1 - target) ** 2)) * 100); unitEdges.push({ edge: addEdge(employeeOffset + employeeIndex, dayOffset + dateIndex, 1, marginal), employeeId: employee.id, date }) }
    }
  }
  for (const [dateIndex, date] of dates.entries()) {
    const baseUnits = employees.reduce((sum, employee) => sum + (base.get(`${employee.id}|${date}`) ?? 0), 0), targetUnits = (targetByDate.get(date) ?? 0) / increment, exactCapacity = Math.max(0, targetUnits - baseUnits)
    addEdge(dayOffset + dateIndex, sink, exactCapacity, 0); addEdge(dayOffset + dateIndex, sink, requiredFlow, 1_000_000)
  }
  const flow = minimumCostFlow(graph, source, sink, requiredFlow)
  if (flow !== requiredFlow) errors.push(`Allocation impossible : ${requiredFlow - flow} unité(s) de ${increment} minutes ne peuvent pas être placées.`)
  const values = new Map(base)
  for (const unit of unitEdges) if (unit.edge.capacity === 0) values.set(`${unit.employeeId}|${unit.date}`, (values.get(`${unit.employeeId}|${unit.date}`) ?? 0) + 1)
  const rows = employees.map((employee) => ({ employeeId: employee.id, minutesByDate: Object.fromEntries(dates.map((date) => [date, (values.get(`${employee.id}|${date}`) ?? 0) * increment])) }))
  const dailyTotals = dates.map((date) => { const allocatedMinutes = rows.reduce((sum, row) => sum + row.minutesByDate[date], 0), targetMinutes = targetByDate.get(date) ?? 0; return { date, targetMinutes, allocatedMinutes, differenceMinutes: allocatedMinutes - targetMinutes } })
  return { rows, dailyTotals, exactDailyBudgets: dailyTotals.every((day) => day.differenceMinutes === 0), errors }
}

function minimumCostFlow(graph: Edge[][], source: number, sink: number, requested: number) {
  let flow = 0
  while (flow < requested) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY), previousNode = Array(graph.length).fill(-1), previousEdge = Array(graph.length).fill(-1), queued = Array(graph.length).fill(false), queue = [source]
    distance[source] = 0; queued[source] = true
    while (queue.length) { const node = queue.shift()!; queued[node] = false; for (const [index, edge] of graph[node].entries()) if (edge.capacity > 0 && distance[edge.to] > distance[node] + edge.cost) { distance[edge.to] = distance[node] + edge.cost; previousNode[edge.to] = node; previousEdge[edge.to] = index; if (!queued[edge.to]) { queue.push(edge.to); queued[edge.to] = true } } }
    if (previousNode[sink] < 0) break
    let node = sink
    while (node !== source) { const edge = graph[previousNode[node]][previousEdge[node]]; edge.capacity--; graph[node][edge.reverse].capacity++; node = previousNode[node] }
    flow++
  }
  return flow
}
