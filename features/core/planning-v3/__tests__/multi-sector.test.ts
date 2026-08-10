import { describe, expect, it } from "vitest"

import type { EmployeeId, PlanningId } from "@/features/core/models"
import { PLANNING_OBJECTIVES_V3, PLANNING_PROBLEM_V3_VERSION, type PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { PLANNING_SOLUTION_V3_VERSION, type PlanningAssignmentV3, type PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { referenceInput } from "@/features/core/planning-v3/__tests__/reference-scenario"
import { weekDayOf } from "@/features/core/shared"

const employeeId = "e1" as EmployeeId
const date = "2026-07-27" as const

function problem(contractMinutes = 360): PlanningProblemV3 {
  const sectorDay = { date, closed: false, opensAtMinutes: 480, closesAtMinutes: 1200, minimumOpenings: 0, exactClosings: 0, latestCloseMinutes: 1200 }
  return {
    version: PLANNING_PROBLEM_V3_VERSION,
    planningId: "p" as PlanningId,
    sectorId: "a",
    sectors: [
      { id: "a", name: "Fruits", days: [sectorDay] },
      { id: "b", name: "Charcuterie", days: [sectorDay] },
      { id: "c", name: "Caisse", days: [sectorDay] },
    ],
    period: { start: date, end: date },
    timeStepMinutes: 15,
    employees: [{
      id: employeeId, firstName: "Arthur", lastName: "Test", contractMinutes,
      workingDays: ["monday"], fixedRestDays: [], minimumDailyMinutes: 240,
      maximumDailyMinutes: 600, canOpen: true, canClose: true, canSplitShift: true,
      maximumOpenings: null, maximumClosings: null, prefersOpening: false,
      prefersClosing: false, allowedSectorIds: ["a", "b"],
    }],
    days: [{ date, weekDay: "monday", weekKey: "2026-W31", closed: false, opensAtMinutes: 480, closesAtMinutes: 1200, budgetMinutes: contractMinutes }],
    employeeDays: [{ employeeId, date, available: true, mandatory: true, fixedRest: false, earliestStartMinutes: 480, latestEndMinutes: 1200, maximumMinutes: 600 }],
    demandSlots: [],
    rules: {
      minimumShiftMinutes: 240, maximumShiftMinutes: 600, minimumRestMinutes: 720,
      maximumConsecutiveWorkedDays: 7, maximumConsecutiveWorkedDaysSource: "derived-fallback",
      splitShiftAllowed: true, maximumSplitMinutes: 180, minimumSplitMinutes: 30,
      maximumContinuousMinutes: 480, maximumSplitsPerDay: 1,
      minimumOpeningsPerDay: 0, exactClosingsPerDay: 0,
    },
    objectives: PLANNING_OBJECTIVES_V3,
  }
}

function validate(p: PlanningProblemV3, assignment: PlanningAssignmentV3) {
  const solution: PlanningSolutionV3 = {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(p),
    assignments: [assignment],
  }
  return validatePlanningSolutionV3(p, solution)
}

const oneShift = (sectorAssignments: PlanningAssignmentV3["sectorAssignments"]): PlanningAssignmentV3 => ({
  employeeId, date, segments: [{ startMinutes: 480, endMinutes: 840 }], sectorAssignments,
})

describe("V3 rapide — invariants multi-secteur", () => {
  it("construit deux rayons sans compter deux fois les contrats partagés", () => {
    const input = referenceInput()
    const first = input.business!.sectors![0]
    const requirementIds = first.requirementIds
    const left = requirementIds.filter((_id, index) => index % 2 === 0)
    const right = requirementIds.filter((_id, index) => index % 2 === 1)
    const multiInput = { ...input, business: {
      ...input.business,
      sectors: [
        { ...first, id: "a", name: "Fruits", requirementIds: left },
        { ...first, id: "b", name: "Charcuterie", requirementIds: right },
      ],
      employeePreferences: input.employees.map((employee) => ({
        employeeId: employee.id,
        prefersClosing: false,
        sectorIds: ["b", "a"],
      })),
    } }
    const built = buildPlanningProblemV3(multiInput)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.problem.sectors?.map((sector) => sector.id)).toEqual(["a", "b"])
    expect(built.problem.employees).toHaveLength(input.employees.length)
    expect(built.problem.employees[0].allowedSectorIds).toEqual(["b", "a"])
    expect(built.problem.days.reduce((sum, day) => sum + day.budgetMinutes, 0)).toBe(
      built.problem.employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
    )
    expect(new Set(built.problem.demandSlots.map((slot) => slot.sectorId))).toEqual(new Set(["a", "b"]))
  })

  it("plafonne la journée d'un salarié par ses propres rayons, pas par le plus strict de la zone", () => {
    const input = referenceInput()
    const drive = input.business!.sectors![0]
    const [firstEmployee] = drive.assignedEmployeeIds
    const monoDrive = buildPlanningProblemV3(input)
    const built = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...drive, id: "drive", name: "Drive" },
          // Un comptoir plus strict, où UNE SEULE personne travaille.
          { ...drive, id: "fruits", name: "Fruits", maximumDailyDuration: 480, assignedEmployeeIds: [firstEmployee] },
        ],
      },
    })

    expect(monoDrive.ok).toBe(true)
    expect(built.ok).toBe(true)
    if (!monoDrive.ok || !built.ok) return
    expect(monoDrive.problem.rules.maximumShiftMinutes).toBe(600)
    // La règle commune est l'ENVELOPPE et ne borne plus personne à elle seule :
    // c'est `employeeDays[].maximumMinutes` qui porte la limite réelle.
    expect(built.problem.rules.maximumShiftMinutes).toBe(600)

    const capOf = (employeeId: string) => Math.max(
      ...built.problem.employeeDays
        .filter((entry) => String(entry.employeeId) === String(employeeId) && entry.available)
        .map((entry) => entry.maximumMinutes)
    )
    const other = drive.assignedEmployeeIds.find((id) => id !== firstEmployee)!
    // Celle qui travaille les deux comptoirs subit le plus strict des deux…
    expect(capOf(String(firstEmployee))).toBe(480)
    // …et le problème dit LEQUEL des cinq plafonds a gagné, sans quoi le
    // diagnostic devine — et il a déjà deviné « magasin » quand c'était un rayon.
    expect(
      built.problem.employeeDays.find(
        (entry) => String(entry.employeeId) === String(firstEmployee) && entry.available
      )?.maximumMinutesSource
    ).toBe("sector")
    // …et celle qui ne met jamais les pieds à Fruits garde ses 10 h. C'est
    // exactement le cas qui rendait une poissonnière infaisable : un comptoir
    // voisin lui imposait un plafond de 8 h sur une amplitude de 11 h.
    expect(capOf(String(other))).toBe(600)
  })

  it("conserve les autorisations de coupure par rayon", () => {
    const input = referenceInput()
    const first = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...first, id: "fruits", name: "Fruits", splitShiftAllowed: false, maximumSplitDuration: 90 },
          {
            ...first,
            id: "poisson",
            name: "Poisson",
            splitShiftAllowed: true,
            minimumSplitDuration: 45,
            maximumSplitDuration: 90,
            maximumSplitsPerDay: 1,
          },
        ],
      },
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.problem.rules.splitShiftAllowed).toBe(true)
    expect(built.problem.sectors?.find((sector) => sector.id === "fruits")?.splitRules?.splitShiftAllowed).toBe(false)
    expect(built.problem.sectors?.find((sector) => sector.id === "poisson")?.splitRules).toMatchObject({
      splitShiftAllowed: true,
      minimumSplitMinutes: 45,
      maximumSplitMinutes: 90,
      maximumSplitsPerDay: 1,
    })
  })

  it("explique précisément quand l'intersection des règles est réellement impossible", () => {
    const input = referenceInput()
    const first = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...first, id: "charcuterie", name: "Charcuterie", minimumShiftDuration: 540, maximumDailyDuration: 600, maximumContinuousDuration: 600 },
          { ...first, id: "fruits", name: "Fruits & Légumes", maximumDailyDuration: 480, maximumContinuousDuration: 480 },
        ],
      },
    })

    expect(built.ok).toBe(false)
    if (built.ok) return
    const issue = built.errors.find((error) => error.code === "incompatible_multi_sector_rules")
    expect(issue?.message).toContain("Charcuterie")
    expect(issue?.message).toContain("Fruits & Légumes")
    expect(issue?.message).toContain("9 h")
    expect(issue?.message).toContain("8 h")
  })

  it("ne laisse pas un comptoir fermé en milieu de semaine plafonner les jours consécutifs de la zone", () => {
    // La semaine réelle qui a bloqué : Poisson ferme le mercredi, Fromage le
    // jeudi. Chacun n'a que 3 jours ouverts d'affilée ; les autres comptoirs en
    // ont 6, et la disponibilité des salariés les y oblige. Retenir le minimum
    // rendait toute la semaine illégale.
    const input = referenceInput()
    const base = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "charcuterie", name: "Charcuterie" },
          {
            ...base,
            id: "poisson",
            name: "Poisson",
            // Fermé un jour au milieu de la semaine.
            hours: base.hours?.map((entry) =>
              entry.day === "wednesday" ? { ...entry, closed: true } : entry
            ),
            // Le mercredi fermé ne peut porter aucun budget ; son volume passe
            // au vendredi pour que la répartition totalise toujours 100 %.
            weeklyDistribution: {
              ...base.weeklyDistribution!,
              wednesday: 0,
              friday: base.weeklyDistribution!.friday + base.weeklyDistribution!.wednesday,
            },
          },
        ],
      },
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    const openDays = built.problem.days.filter((day) => !day.closed).length
    // La valeur reste le maximum STRUCTUREL de la zone, donc non contraignante :
    // aucun planning réalisable ne peut la dépasser.
    expect(built.problem.rules.maximumConsecutiveWorkedDays).toBe(openDays)
    expect(built.problem.rules.maximumConsecutiveWorkedDaysSource).toBe("derived-fallback")
    // Et surtout : aucun salarié disponible ne peut la dépasser, ce qui est la
    // propriété que ce repli promet et que l'intersection avait cassée.
    for (const employee of built.problem.employees) {
      let run = 0
      let longest = 0
      for (const day of built.problem.days) {
        const entry = built.problem.employeeDays.find(
          (item) => item.employeeId === employee.id && item.date === day.date
        )
        run = entry?.available && entry.mandatory ? run + 1 : 0
        longest = Math.max(longest, run)
      }
      expect(longest).toBeLessThanOrEqual(built.problem.rules.maximumConsecutiveWorkedDays!)
    }
  })

  it("distingue les 8 h d'affilée des 10 h avec coupure", () => {
    // La nuance que la configuration magasin exprime depuis toujours et que le
    // pont n'exposait pas : « pas plus de 8 h d'une traite, 10 h en tout ».
    // Elle était écrasée en un seul plafond de journée à 8 h, qui interdisait
    // les journées coupées que le magasin autorise explicitement.
    const input = referenceInput()
    const base = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      store: {
        ...input.store,
        planningSettings: {
          ...input.store.planningSettings,
          maxShiftDuration: 480,   // une traite
          maxDailyDuration: 600,   // la journée, pauses comprises
        },
      },
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "a", name: "A", maximumDailyDuration: 600, maximumContinuousDuration: null },
          { ...base, id: "b", name: "B", maximumDailyDuration: 600, maximumContinuousDuration: null },
        ],
      },
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.problem.rules.maximumShiftMinutes).toBe(600)
    expect(built.problem.rules.maximumContinuousMinutes).toBe(480)
  })

  it("garde l'ancien sens quand la configuration ne distingue pas les deux", () => {
    // Une configuration qui ne déclare qu'un plafond n'a jamais exprimé qu'un
    // seul chiffre : le déplacer vers le continu relâcherait sa journée en
    // douce. `maxShiftDuration` reprend donc son ancien rôle.
    const input = referenceInput()
    const base = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      store: {
        ...input.store,
        planningSettings: { ...input.store.planningSettings, maxShiftDuration: 480 },
      },
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "a", name: "A", maximumDailyDuration: 600, maximumContinuousDuration: null },
          { ...base, id: "b", name: "B", maximumDailyDuration: 600, maximumContinuousDuration: null },
        ],
      },
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.problem.rules.maximumShiftMinutes).toBe(480)
  })

  it("désigne le magasin, et non le rayon, quand c'est le magasin qui plafonne", () => {
    // Le cas réel qui a coûté cinq allers-retours : les rayons sont à 10 h, le
    // magasin à 8 h. Le plafond retenu vaut 8 h dans les deux cas, mais un seul
    // des deux écrans le corrige.
    const input = referenceInput()
    const base = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      store: {
        ...input.store,
        planningSettings: { ...input.store.planningSettings, maxShiftDuration: 480 },
      },
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "a", name: "A", maximumDailyDuration: 600 },
          { ...base, id: "b", name: "B", maximumDailyDuration: 600 },
        ],
      },
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    const worked = built.problem.employeeDays.find((entry) => entry.available)
    expect(worked?.maximumMinutes).toBe(480)
    // Le piège : `problem.rules.maximumShiftMinutes` d'un sous-problème vaut
    // déjà min(rayon, magasin). L'étiqueter « rayon » désignait le magasin une
    // fois sur deux ; la provenance se lit sur les valeurs brutes.
    expect(worked?.maximumMinutesSource).toBe("store")
  })

  it("désigne bien le rayon quand c'est lui le plus strict", () => {
    const input = referenceInput()
    const base = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      store: {
        ...input.store,
        planningSettings: { ...input.store.planningSettings, maxShiftDuration: 600 },
      },
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "a", name: "A", maximumDailyDuration: 450 },
          { ...base, id: "b", name: "B", maximumDailyDuration: 600 },
        ],
      },
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    const worked = built.problem.employeeDays.find((entry) => entry.available)
    expect(worked?.maximumMinutes).toBe(450)
    expect(worked?.maximumMinutesSource).toBe("sector")
  })

  it("envoie les heures en plus sur le jour qui en a besoin, pas sur toute la semaine", () => {
    // Un comptoir demande trois heures de plus le mercredi. Ces trois heures
    // doivent remonter le budget du mercredi — les répartir sur la semaine
    // obligerait à les voler aux autres jours, qui n'en ont pas besoin.
    const input = referenceInput()
    const base = input.business!.sectors![0]
    const wednesday = input.demand.requirements.filter(
      (requirement) => weekDayOf(requirement.window.date) === "wednesday"
    )
    const built = buildPlanningProblemV3({
      ...input,
      demand: {
        ...input.demand,
        requirements: input.demand.requirements.map((requirement) =>
          wednesday.slice(0, 3).includes(requirement)
            ? { ...requirement, minEmployees: requirement.minEmployees + 1 }
            : requirement
        ),
      },
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "a", name: "A" },
          { ...base, id: "b", name: "B" },
        ],
      },
    })
    const flat = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...base, id: "a", name: "A" },
          { ...base, id: "b", name: "B" },
        ],
      },
    })

    expect(built.ok).toBe(true)
    expect(flat.ok).toBe(true)
    if (!built.ok || !flat.ok) return
    const budgetOn = (problem: typeof built.problem, weekDay: string) =>
      problem.days.find((day) => day.weekDay === weekDay)?.budgetMinutes ?? 0
    // Le mercredi monte…
    expect(budgetOn(built.problem, "wednesday")).toBeGreaterThan(budgetOn(flat.problem, "wednesday"))
    // …et le total de la semaine ne bouge pas : ce sont les mêmes contrats.
    const total = (problem: typeof built.problem) =>
      problem.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
    expect(total(built.problem)).toBe(total(flat.problem))
  })

  it("nomme les rayons quand ils ne s'accordent pas sur la présence obligatoire", () => {
    const input = referenceInput()
    const first = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...first, id: "fromage", name: "Fromage", workEveryNonFixedRestDay: true },
          { ...first, id: "poisson", name: "Poisson", workEveryNonFixedRestDay: false },
        ],
      },
    })

    expect(built.ok).toBe(false)
    if (built.ok) return
    // Sans ce contrôle, la contradiction n'apparaissait qu'au fond du moteur
    // Python, sous la forme « optional-work-days-not-supported » : une limite
    // du solveur, pas le rayon à corriger.
    const issue = built.errors.find((error) => error.code === "incompatible_multi_sector_mandatory_presence")
    expect(issue?.message).toContain("Fromage")
    expect(issue?.message).toContain("Poisson")
    expect(built.errors.some((error) => error.code === "optional_work_days")).toBe(false)
  })

  it("laisse passer des rayons qui s'accordent sur la présence obligatoire", () => {
    const input = referenceInput()
    const first = input.business!.sectors![0]
    const built = buildPlanningProblemV3({
      ...input,
      business: {
        ...input.business,
        sectors: [
          { ...first, id: "fromage", name: "Fromage", workEveryNonFixedRestDay: true },
          { ...first, id: "poisson", name: "Poisson", workEveryNonFixedRestDay: true },
        ],
      },
    })

    expect(built.ok).toBe(true)
  })

  it("accepte un shift mono-secteur", () => {
    expect(validate(problem(), oneShift([{ sectorId: "a", startMinutes: 480, endMinutes: 840 }])).validHardConstraints).toBe(true)
  })

  it("accepte 08:00–14:00 avec A 08:00–11:00 puis B 11:00–14:00 comme un seul segment continu", () => {
    const report = validate(problem(), oneShift([
      { sectorId: "a", startMinutes: 480, endMinutes: 660 },
      { sectorId: "b", startMinutes: 660, endMinutes: 840 },
    ]))
    expect(report.validHardConstraints).toBe(true)
    expect(report.violations.some((issue) => issue.rule === "split-shift")).toBe(false)
  })

  it("refuse un rayon non autorisé", () => {
    expect(validate(problem(), oneShift([{ sectorId: "c", startMinutes: 480, endMinutes: 840 }])).violations.some((issue) => issue.rule === "sector-assignment")).toBe(true)
  })

  it("refuse une affectation rayon inférieure à une heure", () => {
    expect(validate(problem(), oneShift([
      { sectorId: "a", startMinutes: 480, endMinutes: 525 },
      { sectorId: "b", startMinutes: 525, endMinutes: 840 },
    ])).violations.some((issue) => issue.rule === "sector-assignment")).toBe(true)
  })

  it("refuse un trou dans les affectations", () => {
    expect(validate(problem(), oneShift([
      { sectorId: "a", startMinutes: 480, endMinutes: 630 },
      { sectorId: "b", startMinutes: 645, endMinutes: 840 },
    ])).violations.some((issue) => issue.rule === "sector-assignment")).toBe(true)
  })

  it("refuse un chevauchement", () => {
    expect(validate(problem(), oneShift([
      { sectorId: "a", startMinutes: 480, endMinutes: 675 },
      { sectorId: "b", startMinutes: 660, endMinutes: 840 },
    ])).violations.some((issue) => issue.rule === "sector-assignment")).toBe(true)
  })

  it("refuse trois rayons", () => {
    const p = problem()
    const employee = { ...p.employees[0], allowedSectorIds: ["a", "b", "c"] }
    const report = validate({ ...p, employees: [employee] }, oneShift([
      { sectorId: "a", startMinutes: 480, endMinutes: 600 },
      { sectorId: "b", startMinutes: 600, endMinutes: 720 },
      { sectorId: "c", startMinutes: 720, endMinutes: 840 },
    ]))
    expect(report.violations.some((issue) => issue.rule === "sector-assignment")).toBe(true)
  })

  it("refuse A → B → A", () => {
    expect(validate(problem(), oneShift([
      { sectorId: "a", startMinutes: 480, endMinutes: 600 },
      { sectorId: "b", startMinutes: 600, endMinutes: 720 },
      { sectorId: "a", startMinutes: 720, endMinutes: 840 },
    ])).violations.some((issue) => issue.rule === "sector-assignment")).toBe(true)
  })

  it("accepte 8 h continues", () => {
    const p = problem(480)
    expect(validate(p, { employeeId, date, segments: [{ startMinutes: 480, endMinutes: 960 }], sectorAssignments: [{ sectorId: "a", startMinutes: 480, endMinutes: 960 }] }).validHardConstraints).toBe(true)
  })

  it("refuse 10 h continues", () => {
    const p = problem(600)
    expect(validate(p, { employeeId, date, segments: [{ startMinutes: 480, endMinutes: 1080 }], sectorAssignments: [{ sectorId: "a", startMinutes: 480, endMinutes: 1080 }] }).violations.some((issue) => issue.rule === "maximum-shift")).toBe(true)
  })

  it("accepte une journée coupée 4 h + 4 h", () => {
    const p = problem(480)
    const report = validate(p, { employeeId, date, segments: [{ startMinutes: 480, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1020 }], sectorAssignments: [{ sectorId: "a", startMinutes: 480, endMinutes: 720 }, { sectorId: "a", startMinutes: 780, endMinutes: 1020 }] })
    expect(report.validHardConstraints).toBe(true)
  })

  it("autorise une coupure dans le rayon qui l'autorise sans l'ouvrir aux autres", () => {
    const p = problem(600)
    const sectors = p.sectors!.map((sector) => ({
      ...sector,
      splitRules: {
        splitShiftAllowed: sector.id === "b",
        minimumSplitMinutes: sector.id === "b" ? 45 : null,
        maximumSplitMinutes: sector.id === "b" ? 90 : null,
        maximumSplitsPerDay: sector.id === "b" ? 2 : null,
      },
    }))
    const segments = [
      { startMinutes: 480, endMinutes: 840 },
      { startMinutes: 900, endMinutes: 1140 },
    ]
    const allowed = validate({ ...p, sectors }, {
      employeeId,
      date,
      segments,
      sectorAssignments: [
        { sectorId: "b", startMinutes: 480, endMinutes: 840 },
        { sectorId: "b", startMinutes: 900, endMinutes: 1140 },
      ],
    })
    const forbidden = validate({ ...p, sectors }, {
      employeeId,
      date,
      segments,
      sectorAssignments: [
        { sectorId: "a", startMinutes: 480, endMinutes: 840 },
        { sectorId: "a", startMinutes: 900, endMinutes: 1140 },
      ],
    })

    expect(allowed.validHardConstraints).toBe(true)
    expect(forbidden.violations.some((issue) => issue.rule === "split-shift")).toBe(true)
  })

  it("refuse une journée coupée 3 h + 5 h", () => {
    const p = problem(480)
    const report = validate(p, { employeeId, date, segments: [{ startMinutes: 480, endMinutes: 660 }, { startMinutes: 720, endMinutes: 1020 }], sectorAssignments: [{ sectorId: "a", startMinutes: 480, endMinutes: 660 }, { sectorId: "a", startMinutes: 720, endMinutes: 1020 }] })
    expect(report.violations.some((issue) => issue.rule === "minimum-shift")).toBe(true)
  })

  it("ne double-compte pas un salarié dans deux rayons au même instant", () => {
    const p = { ...problem(), demandSlots: [
      { id: "a1", sectorId: "a", date, startMinutes: 480, endMinutes: 540, requiredEmployees: 1, maximumEmployees: null },
      { id: "b1", sectorId: "b", date, startMinutes: 480, endMinutes: 540, requiredEmployees: 1, maximumEmployees: null },
    ] }
    const report = validate(p, oneShift([{ sectorId: "a", startMinutes: 480, endMinutes: 840 }]))
    expect(report.underCoveredSlots).toBe(1)
    expect(report.metrics.totalDeficitMinutes).toBe(60)
  })
})
