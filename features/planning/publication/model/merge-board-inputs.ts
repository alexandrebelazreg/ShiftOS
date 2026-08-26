import type {
  BoardDay,
  BoardEmployee,
  BoardHoliday,
  BoardSector,
  BoardShift,
  PlanningBoardInput,
} from "@/features/planning/board"

/**
 * Les plannings d'UNE MÊME SEMAINE, réunis en une seule lecture.
 *
 * Une semaine ne se génère pas d'un coup : le Drive part seul, la zone marché
 * ensemble, et chacun s'enregistre de son côté. La feuille affichée, elle, doit
 * dire à quelqu'un TOUTES ses heures — celle qui fait du Drive lundi et du
 * Poisson mardi ne lit pas deux feuilles pour savoir quand elle vient.
 *
 * L'union est faite sur l'entrée du board plutôt que sur les états d'éditeur :
 * c'est la forme la plus pauvre des deux — des identifiants, des minutes — donc
 * la seule où « réunir » ne veut rien dire d'autre que « mettre bout à bout ».
 *
 * TROIS PRÉCAUTIONS, chacune payée par un défaut qu'elle évite.
 *
 * Les identifiants de vacation sont PRÉFIXÉS. Deux générations distinctes
 * produisent leurs identifiants chacune de son côté et rien ne garantit qu'ils
 * diffèrent ; deux vacations de même identifiant se seraient écrasées dans les
 * clés React, et une journée aurait disparu de la feuille sans erreur.
 *
 * Une journée n'est FERMÉE que si elle l'est PARTOUT. Le dimanche du Drive peut
 * être ouvert quand celui de la charcuterie ne l'est pas ; garder la première
 * réponse rencontrée aurait barré une colonne où quelqu'un travaille.
 *
 * `weeklyTargetMinutes` est ABANDONNÉ. C'était la part d'un salarié DANS UN
 * PÉRIMÈTRE ; réunis, les périmètres n'ont plus de part commune, et garder
 * celle du premier ferait comparer un total de semaine à un objectif de rayon.
 * Sans lui, la lecture retombe sur le contrat, qui est la bonne référence quand
 * on regarde toutes ses heures.
 */
export function mergeBoardInputs(
  inputs: readonly PlanningBoardInput[]
): PlanningBoardInput | null {
  if (inputs.length === 0) return null
  if (inputs.length === 1) return inputs[0]

  const first = inputs[0]
  const sectors = new Map<string, BoardSector>()
  const employees = new Map<string, BoardEmployee>()
  const days = new Map<string, BoardDay>()
  const holidays = new Map<string, BoardHoliday>()
  const shifts: BoardShift[] = []
  const demand: PlanningBoardInput["demand"][number][] = []

  inputs.forEach((input, index) => {
    for (const sector of input.sectors) {
      if (!sectors.has(sector.id)) sectors.set(sector.id, sector)
    }

    for (const employee of input.employees) {
      const known = employees.get(String(employee.id))
      if (!known) {
        employees.set(String(employee.id), { ...employee, weeklyTargetMinutes: undefined })
        continue
      }
      employees.set(String(employee.id), {
        ...known,
        sectorIds: [...new Set([...known.sectorIds, ...employee.sectorIds])],
      })
    }

    for (const day of input.days) {
      const known = days.get(day.date)
      if (!known) {
        days.set(day.date, day)
        continue
      }
      if (known.closed && !day.closed) days.set(day.date, day)
    }

    for (const holiday of input.holidays ?? []) {
      if (!holidays.has(holiday.date)) holidays.set(holiday.date, holiday)
    }

    for (const shift of input.shifts) {
      shifts.push({ ...shift, id: `w${index}_${shift.id}` })
    }
    demand.push(...input.demand)
  })

  return {
    periodStart: first.periodStart,
    periodEnd: first.periodEnd,
    sectors: [...sectors.values()],
    employees: [...employees.values()],
    days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    shifts,
    demand,
    ...(holidays.size > 0 ? { holidays: [...holidays.values()] } : {}),
    ...(inputs.some((input) => input.storeOpensSundays) ? { storeOpensSundays: true } : {}),
  }
}
