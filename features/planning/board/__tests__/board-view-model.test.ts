import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type {
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import { buildPlanningBoard } from "@/features/planning/board/model/board-view-model"

/**
 * The board is tested through its ViewModel, never through the DOM.
 *
 * That is the point of the split: if the two views can only disagree by the
 * ViewModel disagreeing with itself, then testing the ViewModel is enough, and
 * the components stay free of anything worth testing.
 */

const employee = (id: string, name: string, contractMinutes: number) => ({
  id: id as unknown as EmployeeId,
  name,
  sectorIds: ["drive", "caisse"],
  contractMinutes,
  rules: [`Contrat ${contractMinutes} minutes`],
})

const shift = (
  id: string,
  employeeId: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  sectorId = "drive"
) => ({
  id,
  employeeId: employeeId as unknown as EmployeeId,
  sectorId,
  date,
  startMinutes,
  endMinutes,
  workedMinutes: endMinutes - startMinutes,
  segments: [{ startMinutes, endMinutes }],
  opensDay: startMinutes === 360,
  closesDay: endMinutes === 1200,
})

function input(): PlanningBoardInput {
  return {
    periodStart: "2026-07-20",
    periodEnd: "2026-07-21",
    sectors: [
      { id: "drive", name: "Drive" },
      { id: "caisse", name: "Caisse" },
    ],
    employees: [employee("luca", "Luca Drive", 960), employee("dylan", "Dylan Drive", 480)],
    days: [
      { date: "2026-07-20", weekDay: "monday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
      { date: "2026-07-21", weekDay: "tuesday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
    ],
    shifts: [
      shift("s1", "luca", "2026-07-20", 360, 840),
      shift("s2", "dylan", "2026-07-20", 720, 1200),
      shift("s3", "luca", "2026-07-21", 360, 840),
      shift("s4", "dylan", "2026-07-21", 600, 900, "caisse"),
    ],
    demand: [
      { sectorId: "drive", date: "2026-07-20", startMinutes: 360, endMinutes: 420, requiredEmployees: 1 },
      { sectorId: "drive", date: "2026-07-20", startMinutes: 720, endMinutes: 780, requiredEmployees: 2 },
      { sectorId: "drive", date: "2026-07-20", startMinutes: 1140, endMinutes: 1200, requiredEmployees: 1 },
      { sectorId: "caisse", date: "2026-07-20", startMinutes: 360, endMinutes: 420, requiredEmployees: 3 },
    ],
  }
}

const selection = (patch: Partial<PlanningBoardSelection> = {}): PlanningBoardSelection => ({
  view: "sector",
  sectorIds: ["drive"],
  date: "2026-07-20",
  employeeId: null,
  ...patch,
})

describe("board — les deux vues lisent les mêmes données", () => {
  it("montre les mêmes shifts du jour dans la vue secteur et la vue jour", () => {
    const board = buildPlanningBoard(input(), selection())

    const inSectorView = board.sectorView.rows
      .flatMap((row) => row.shiftsByDate["2026-07-20"] ?? [])
      .map((s) => s.id)
      .sort()
    const inDayView = board.dayView.rows
      .flatMap((row) => row.shifts)
      .map((s) => s.id)
      .sort()

    expect(inDayView).toEqual(inSectorView)
    expect(inDayView).toEqual(["s1", "s2"])
  })

  it("expose les mêmes salariés dans les deux vues", () => {
    const board = buildPlanningBoard(input(), selection())
    expect(board.dayView.rows.map((row) => row.employeeId)).toEqual(
      board.sectorView.rows.map((row) => row.employeeId)
    )
  })
})

describe("board — synchronisation des filtres", () => {
  it("changer de secteur met à jour les deux vues", () => {
    const drive = buildPlanningBoard(input(), selection())
    const caisse = buildPlanningBoard(input(), selection({ sectorIds: ["caisse"] }))

    // s4 belongs to Caisse only; it must appear there and nowhere else.
    expect(drive.sectorView.rows.flatMap((r) => Object.values(r.shiftsByDate).flat()).map((s) => s.id))
      .not.toContain("s4")
    expect(caisse.sectorView.rows.flatMap((r) => Object.values(r.shiftsByDate).flat()).map((s) => s.id))
      .toEqual(["s4"])
    expect(caisse.dayView.rows.flatMap((r) => r.shifts)).toHaveLength(0)
    // The demand follows the sector too: Caisse asks for 3 at opening.
    expect(caisse.dayView.requiredRow[0].required).toBe(3)
    expect(drive.dayView.requiredRow[0].required).toBe(1)
  })

  it("changer de jour met à jour la vue jour sans toucher à la semaine", () => {
    const monday = buildPlanningBoard(input(), selection())
    const tuesday = buildPlanningBoard(input(), selection({ date: "2026-07-21" }))

    expect(monday.dayView.rows.flatMap((r) => r.shifts).map((s) => s.id)).toEqual(["s1", "s2"])
    expect(tuesday.dayView.rows.flatMap((r) => r.shifts).map((s) => s.id)).toEqual(["s3"])
    // The week grid is unchanged: it always shows the whole period.
    expect(tuesday.sectorView.columns).toEqual(monday.sectorView.columns)
  })

  it("changer de semaine change les deux vues", () => {
    const week1 = buildPlanningBoard(input(), selection())
    const nextWeek: PlanningBoardInput = {
      ...input(),
      periodStart: "2026-07-27",
      periodEnd: "2026-07-28",
      days: [
        { date: "2026-07-27", weekDay: "monday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
        { date: "2026-07-28", weekDay: "tuesday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
      ],
      shifts: [shift("n1", "luca", "2026-07-27", 480, 960)],
      demand: [],
    }
    const week2 = buildPlanningBoard(nextWeek, selection({ date: "2026-07-27" }))

    expect(week2.toolbar.periodLabel).not.toBe(week1.toolbar.periodLabel)
    expect(week2.sectorView.columns.map((c) => c.date)).toEqual(["2026-07-27", "2026-07-28"])
    expect(week2.dayView.rows.flatMap((r) => r.shifts).map((s) => s.id)).toEqual(["n1"])
  })
})

describe("board — géométrie exacte de la timeline", () => {
  it("aligne chaque barre sur son heure", () => {
    const board = buildPlanningBoard(input(), selection({ view: "day" }))
    // 06:00 → 20:00 is 14 hourly columns.
    expect(board.dayView.hours).toHaveLength(14)
    expect(board.dayView.hours[0].label).toBe("06:00")
    expect(board.dayView.hours.at(-1)?.label).toBe("19:00")
    expect(board.dayView.hours[0].widthPercent).toBeCloseTo(100 / 14, 10)

    const luca = board.dayView.rows.find((row) => String(row.employeeId) === "luca")!
    // 06:00–14:00 over a 06:00–20:00 window: starts at 0 %, spans 8/14.
    expect(luca.shifts[0].leftPercent).toBe(0)
    expect(luca.shifts[0].widthPercent).toBeCloseTo((480 / 840) * 100, 10)

    const dylan = board.dayView.rows.find((row) => String(row.employeeId) === "dylan")!
    // 12:00–20:00 starts 6 hours in and runs to the edge.
    expect(dylan.shifts[0].leftPercent).toBeCloseTo((360 / 840) * 100, 10)
    expect(dylan.shifts[0].leftPercent + dylan.shifts[0].widthPercent).toBeCloseTo(100, 10)
  })

  it("colore la couverture selon besoin et présents", () => {
    const board = buildPlanningBoard(input(), selection({ view: "day" }))
    const at = (minutes: number) => ({
      required: board.dayView.requiredRow.find((c) => c.startMinutes === minutes)!,
      present: board.dayView.presentRow.find((c) => c.startMinutes === minutes)!,
    })

    // 06:00 — 1 required, Luca present: met.
    expect(at(360).required).toMatchObject({ required: 1, present: 1, level: "ok" })
    expect(at(360).present.level).toBe("ok")
    // 12:00 — 2 required, both present: met.
    expect(at(720).present).toMatchObject({ required: 2, present: 2, level: "ok" })
    // 19:00 — 1 required, only Dylan: met, and no demand elsewhere means over.
    expect(at(1140).present).toMatchObject({ required: 1, present: 1, level: "ok" })
    // 09:00 — no demand but Luca is there: surplus.
    expect(at(540).present).toMatchObject({ required: 0, present: 1, level: "over" })
  })

  it("signale un déficit en rouge", () => {
    const short: PlanningBoardInput = { ...input(), shifts: [shift("s1", "luca", "2026-07-20", 360, 840)] }
    const board = buildPlanningBoard(short, selection({ view: "day" }))
    const noon = board.dayView.presentRow.find((c) => c.startMinutes === 720)!
    // Luca covers 12:00–13:00, so one of the two required people is there.
    expect(noon).toMatchObject({ required: 2, present: 1, level: "under" })
  })

  it("garde les repos visibles", () => {
    const short: PlanningBoardInput = { ...input(), shifts: [shift("s1", "luca", "2026-07-20", 360, 840)] }
    const board = buildPlanningBoard(short, selection({ view: "day" }))
    const dylan = board.dayView.rows.find((row) => String(row.employeeId) === "dylan")!
    expect(dylan.restLabel).toBe("Repos")
    expect(dylan.shifts).toHaveLength(0)
  })

  describe("RÉGRESSION — présence concurrente sur l'heure, pas de couverture intégrale par un seul shift", () => {
    // Le cas rapporté : trois salariés se relaient sur 12:00–13:00 (06:00–12:30,
    // 10:00–14:00, 12:15–17:45). Aucun ne couvre l'heure à lui seul, mais la
    // présence simultanée réelle ne descend jamais sous 2. L'ancien calcul
    // ("un shift doit couvrir l'heure entière") ne comptait que le salarié du
    // milieu — present=1.
    const staggered: PlanningBoardInput = {
      ...input(),
      employees: [
        ...input().employees,
        { id: "empA" as unknown as EmployeeId, name: "A", sectorIds: ["drive"], contractMinutes: 390, rules: [] },
        { id: "empB" as unknown as EmployeeId, name: "B", sectorIds: ["drive"], contractMinutes: 240, rules: [] },
        { id: "empC" as unknown as EmployeeId, name: "C", sectorIds: ["drive"], contractMinutes: 330, rules: [] },
      ],
      shifts: [
        shift("sA", "empA", "2026-07-20", 360, 750), // 06:00–12:30
        shift("sB", "empB", "2026-07-20", 600, 840), // 10:00–14:00
        shift("sC", "empC", "2026-07-20", 735, 1065), // 12:15–17:45
      ],
      demand: [{ sectorId: "drive", date: "2026-07-20", startMinutes: 720, endMinutes: 780, requiredEmployees: 2 }],
    }

    it("l'heure 12:00–13:00 affiche 2 présents, jamais 1", () => {
      const board = buildPlanningBoard(staggered, selection({ view: "day" }))
      const noon = board.dayView.presentRow.find((c) => c.startMinutes === 720)!
      expect(noon).toMatchObject({ required: 2, present: 2, level: "ok" })
    })

    it("aucun déficit affiché quand le besoin (2) est couvert par la présence minimale réelle", () => {
      const board = buildPlanningBoard(staggered, selection({ view: "day" }))
      const noon = board.dayView.requiredRow.find((c) => c.startMinutes === 720)!
      expect(noon.level).toBe("ok")
    })
  })
})

describe("board — vue employé", () => {
  it("reste cohérente avec la vue secteur", () => {
    const board = buildPlanningBoard(
      input(),
      selection({ view: "employee", employeeId: "luca" as unknown as EmployeeId })
    )
    const row = board.sectorView.rows.find((r) => String(r.employeeId) === "luca")!
    const view = board.employeeView!

    expect(view.name).toBe(row.name)
    // Planned hours agree between the grid and the employee view.
    const planned = view.general.find((m) => m.label === "Heures planifiées")!
    expect(planned.value).toBe(row.plannedLabel)
    // Luca works 2 × 8 h against a 16 h contract: on target.
    expect(planned.value).toBe("16h")
    expect(view.general.find((m) => m.label === "Écart")!.value).toBe("0h")
    expect(view.stats.find((m) => m.label === "Ouvertures")!.value).toBe("2")
    expect(view.stats.find((m) => m.label === "Samedis travaillés")!.value).toBe("0")
  })

  it("affiche toute la semaine sur une seule règle horaire", () => {
    const board = buildPlanningBoard(
      input(),
      selection({ view: "employee", employeeId: "luca" as unknown as EmployeeId })
    )
    const view = board.employeeView!

    expect(view.days.map((d) => d.date)).toEqual(["2026-07-20", "2026-07-21"])
    expect(view.hours).toHaveLength(14)
    // Both days share the ruler, so equal hours render as equal widths.
    const [monday, tuesday] = view.days
    expect(monday.shifts[0].widthPercent).toBe(tuesday.shifts[0].widthPercent)
    expect(monday.totalLabel).toBe("8h")
  })

  it("retombe sur le premier salarié quand aucun n'est sélectionné", () => {
    const view = buildPlanningBoard(input(), selection({ view: "employee" })).employeeView!
    expect(String(view.employeeId)).toBe("luca")
    expect(view.roster.filter((person) => person.selected)).toHaveLength(1)
  })
})

describe("board — résumé métier", () => {
  it("annonce un planning conforme quand rien ne cloche", () => {
    // Demand reduced to what the two shifts already cover.
    const clean: PlanningBoardInput = {
      ...input(),
      employees: [employee("luca", "Luca Drive", 960)],
      shifts: [shift("s1", "luca", "2026-07-20", 360, 840), shift("s3", "luca", "2026-07-21", 360, 840)],
      demand: [
        { sectorId: "drive", date: "2026-07-20", startMinutes: 360, endMinutes: 420, requiredEmployees: 1 },
      ],
    }
    const summary = buildPlanningBoard(clean, selection()).summary
    expect(summary.status).toBe("ok")
    expect(summary.title).toBe("Planning conforme")
    expect(summary.deficits).toEqual([])
    expect(summary.facts.every((fact) => fact.level === "ok")).toBe(true)
  })

  it("liste les créneaux sous-couverts sous forme de tableau", () => {
    const short: PlanningBoardInput = { ...input(), shifts: [shift("s1", "luca", "2026-07-20", 360, 840)] }
    const summary = buildPlanningBoard(short, selection()).summary

    expect(summary.status).toBe("reserves")
    expect(summary.title).toBe("Planning publiable avec réserves")
    // 12:00 needs two people, only Luca is there; 19:00 needs one, nobody is.
    expect(summary.deficits.map((row) => [row.hourLabel, row.required, row.present])).toEqual([
      ["12:00 – 13:00", 2, 1],
      ["19:00 – 20:00", 1, 0],
    ])
    expect(summary.deficits[0].dayLabel).toBe("Lundi 20/07")
    expect(summary.facts.map((fact) => fact.label)).toContain("2 créneaux sous-couverts")
  })

  it("ne laisse aucune notion technique dans le résumé", () => {
    const short: PlanningBoardInput = { ...input(), shifts: [shift("s1", "luca", "2026-07-20", 360, 840)] }
    const summary = buildPlanningBoard(short, selection()).summary
    const visible = [summary.title, summary.headline, ...summary.facts.map((f) => f.label)].join(" ")

    for (const banned of ["surplus", "structurel", "évitable", "phase", "pipeline", "solveur"]) {
      expect(visible.toLowerCase()).not.toContain(banned)
    }
  })

  it("garde les détails techniques hors du résumé mais accessibles", () => {
    const withTechnical: PlanningBoardInput = {
      ...input(),
      diagnostics: {
        blocking: false,
        requiresAcceptance: true,
        technical: [{ label: "Surplus structurel", value: "3 405 min" }],
      },
    }
    const summary = buildPlanningBoard(withTechnical, selection()).summary
    expect(summary.facts.map((f) => f.label)).toContain("Acceptation requise avant publication")
    expect(summary.technical).toEqual([{ label: "Surplus structurel", value: "3 405 min" }])
  })

  it("bloque quand le moteur signale une violation", () => {
    const blocked: PlanningBoardInput = {
      ...input(),
      diagnostics: { blocking: true, requiresAcceptance: false, technical: [] },
    }
    const summary = buildPlanningBoard(blocked, selection()).summary
    expect(summary.status).toBe("blocked")
    expect(summary.title).toBe("Planning non publiable")
  })
})

describe("board — semaine ISO", () => {
  it("annonce le numéro de semaine et la plage en toutes lettres", () => {
    const toolbar = buildPlanningBoard(input(), selection()).toolbar
    expect(toolbar.weekNumber).toBe(30)
    expect(toolbar.weekTitle).toBe("Semaine 30")
    expect(toolbar.rangeLabel).toBe("20 juillet → 21 juillet")
  })
})

describe("board — types de journée", () => {
  it("distingue ouverture, fermeture et journée simple", () => {
    const board = buildPlanningBoard(input(), selection({ view: "day" }))
    const byId = new Map(board.dayView.rows.flatMap((r) => r.shifts).map((s) => [s.id, s]))

    // s1 starts at opening, s2 ends at closing.
    expect(byId.get("s1")!.kind).toBe("opening")
    expect(byId.get("s1")!.kindLabel).toBe("Ouverture")
    expect(byId.get("s2")!.kind).toBe("closing")
    expect(byId.get("s2")!.kindLabel).toBe("Fermeture")
  })
})

describe("board — les composants React ne portent aucune logique métier", () => {
  const UI = join(process.cwd(), "features", "planning", "board", "ui")

  /**
   * The rule this guards: components render a prepared ViewModel. If one starts
   * comparing hours, summing minutes or deciding a colour, the V3 swap stops
   * being free — so the arithmetic is banned at the file level.
   */
  const FORBIDDEN: readonly { pattern: RegExp; reason: string }[] = [
    { pattern: /\/\s*60\b/, reason: "conversion de minutes" },
    { pattern: /\breduce\s*\(/, reason: "agrégation" },
    { pattern: /\bfilter\s*\(/, reason: "filtrage de données" },
    { pattern: /\bsort\s*\(/, reason: "tri de données" },
    { pattern: /\bMath\.(round|floor|ceil|abs|max|min)\b/, reason: "calcul arithmétique" },
    { pattern: /contractMinutes|workedMinutes|requiredEmployees\s*[<>=]/, reason: "comparaison métier" },
    { pattern: /@\/features\/core\/(planning-generator|planning-v3|constraint-engine|demand-engine)/, reason: "import moteur" },
  ]

  const files = readdirSync(UI).filter((name) => name.endsWith(".tsx"))

  /**
   * Blank out string and template literals so class names are not mistaken for
   * code: `border-border/60` is a Tailwind opacity, not a minute conversion.
   */
  const stripLiterals = (source: string): string => {
    let result = ""
    let quote: string | null = null
    for (let index = 0; index < source.length; index++) {
      const char = source[index]
      if (quote) {
        if (char === "\\") index++
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char
        continue
      }
      result += char
    }
    return result
  }

  it("couvre bien les composants du board", () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  it.each(files)("%s ne calcule rien", (name) => {
    // Strip string and template literals first: a Tailwind class like
    // `border-border/60` is not a minute conversion, and `bg-muted/40` is not
    // arithmetic. Only real code is inspected.
    const source = stripLiterals(readFileSync(join(UI, name), "utf8"))
    const offences = FORBIDDEN.filter((rule) => rule.pattern.test(source)).map((rule) => rule.reason)
    expect(offences).toEqual([])
  })
})
