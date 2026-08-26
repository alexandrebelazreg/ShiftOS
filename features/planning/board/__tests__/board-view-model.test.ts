import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
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
      selection({
        view: "employee",
        employeeId: "luca" as unknown as EmployeeId,
        sectorIds: ["drive", "caisse"],
      })
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

describe("déficits — la présence est une CONCURRENCE, pas un recouvrement", () => {
  /**
   * Le bug corrigé, repris tel qu'il est apparu à l'écran.
   *
   * Jeudi 12:00–13:00, besoin 2. Sur la grille : Erwan finit à 12:15, Luca
   * prend à 12:15, Dylan couvre toute l'heure. Deux personnes sont présentes à
   * chaque instant. Le tableau annonçait pourtant « Présents : 1 », parce qu'il
   * ne comptait que les shifts couvrant le créneau ENTIER à eux seuls — donc ni
   * Erwan ni Luca. La ligne « Présents » au-dessus, elle, comptait la
   * concurrence : deux calculs contradictoires sur le même écran.
   */
  const handover = (): PlanningBoardInput => ({
    periodStart: "2026-07-30",
    periodEnd: "2026-07-30",
    sectors: [{ id: "drive", name: "Drive" }],
    employees: [
      employee("erwan", "Erwan Lureau", 375),
      employee("luca", "Luca Zanuso", 465),
      employee("dylan", "Dylan Autret", 435),
    ],
    days: [
      { date: "2026-07-30", weekDay: "thursday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
    ],
    shifts: [
      shift("s1", "erwan", "2026-07-30", 360, 735), // 06:00 – 12:15
      shift("s2", "luca", "2026-07-30", 735, 1200), // 12:15 – 20:00
      shift("s3", "dylan", "2026-07-30", 585, 1020), // 09:45 – 17:00
    ],
    demand: [
      { sectorId: "drive", date: "2026-07-30", startMinutes: 720, endMinutes: 780, requiredEmployees: 2 },
    ],
  })

  it("ne signale aucun déficit sur une heure couverte par une passation", () => {
    const board = buildPlanningBoard(handover(), {
      view: "sector",
      sectorIds: ["drive"],
      date: "2026-07-30",
      employeeId: null,
    })
    expect(board.summary.deficits).toEqual([])
  })

  it("compte les deux présents, et non le seul qui couvre toute l'heure", () => {
    // Besoin porté à 3 : le créneau devient réellement court, et le chiffre
    // rapporté doit être 2 — pas 1, qui était l'ancien comptage.
    const problem = handover()
    const board = buildPlanningBoard(
      { ...problem, demand: [{ ...problem.demand[0], requiredEmployees: 3 }] },
      { view: "sector", sectorIds: ["drive"], date: "2026-07-30", employeeId: null }
    )
    expect(board.summary.deficits).toHaveLength(1)
    expect(board.summary.deficits[0].present).toBe(2)
    expect(board.summary.deficits[0].required).toBe(3)
  })

  it("dit la même chose que la ligne « Présents » de la grille", () => {
    // Les deux lectures doivent coïncider : c'est leur désaccord qui était le bug.
    const board = buildPlanningBoard(handover(), {
      view: "sector",
      sectorIds: ["drive"],
      date: "2026-07-30",
      employeeId: null,
    })
    const noon = board.dayView.presentRow.find((cell) => cell.startMinutes === 720)
    expect(noon?.present).toBe(2)
    expect(board.summary.deficits).toEqual([])
  })
})

describe("vue semaine — le total par jour", () => {
  it("additionne les heures de tout le monde sur chaque jour ouvert", () => {
    const board = buildPlanningBoard(input(), selection())
    const monday = board.sectorView.columns.find((column) => column.date === "2026-07-20")
    // Luca 06:00–14:00 (8 h) + Dylan 12:00–20:00 (8 h) = 16 h.
    expect(monday?.totalLabel).toBe("16h")
  })

  it("ne compte que le secteur affiché", () => {
    // Mardi : Luca 8 h sur Drive, Dylan 5 h sur Caisse. Le total Drive est 8 h.
    const drive = buildPlanningBoard(input(), selection())
    expect(drive.sectorView.columns.find((c) => c.date === "2026-07-21")?.totalLabel).toBe("8h")
  })

  it("n'affiche aucun total sur un jour fermé", () => {
    // Zéro heure n'est pas « 0 h travaillée », c'est l'absence de journée.
    const problem = input()
    const board = buildPlanningBoard(
      {
        ...problem,
        days: problem.days.map((day) =>
          day.date === "2026-07-21" ? { ...day, closed: true } : day
        ),
      },
      selection()
    )
    expect(board.sectorView.columns.find((c) => c.date === "2026-07-21")?.totalLabel).toBeNull()
  })
})

describe("vue semaine — le contrat vit sous le nom", () => {
  it("ne garde aucune colonne « Heures » dans le tableau", () => {
    // Elle coûtait un septième de la largeur pour une ligne par salarié, en
    // écrasant les jours qu'elle était censée aider à lire.
    const view = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "PlanningSectorView.tsx"),
      "utf8"
    )
    expect(view).not.toContain(">Heures<")
    // Le chiffre lui-même reste, sous le nom, avec son état de conformité.
    expect(view).toContain("row.hoursLabel")
    expect(view).toContain("row.deviationLabel")
    expect(view).toContain("column.totalLabel")
  })

  /**
   * Le ✓ vert ne revient pas.
   *
   * Il s'affichait sous CHAQUE nom d'une semaine réussie : vingt confirmations
   * identiques, et la ligne qui manquait à l'appel se perdait dedans. La règle
   * tient en une phrase — ce qui s'affiche est ce qui cloche — et elle ne se
   * lit nulle part à l'exécution, d'où ce test.
   */
  it("ne confirme plus une ligne juste, il ne signale que l'écart", () => {
    const view = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "PlanningSectorView.tsx"),
      "utf8"
    )
    expect(view).not.toContain("objectif atteint")
    expect(view).not.toContain("contrat respecté")
    expect(view).not.toContain("row.onTarget")
  })

  it("écrit « fait / dû » et rien de plus quand la cible est le contrat", () => {
    // Tous les rayons affichés : les heures vues SONT le contrat entier, donc
    // la ligne n'a aucune nuance à porter.
    const board = buildPlanningBoard(input(), selection({ sectorIds: ["drive", "caisse"] }))
    const row = board.sectorView.rows.find((entry) => String(entry.employeeId) === "luca")

    expect(row?.hoursLabel).toBe("16h / 16h")
    expect(row?.targetKind).toBe("contract")
    // Rien à côté : à l'équilibre, la ligne se tait.
    expect(row?.deviationLabel).toBeNull()

    // Et l'écart reste la seule chose qu'elle dise quand il y en a un.
    const off = board.sectorView.rows.find((entry) => String(entry.employeeId) === "dylan")
    expect(off?.hoursLabel).toBe("13h / 8h")
    expect(off?.deviationLabel).toBe("+5h")
  })

  it("dit « sélection partielle » quand les heures ne se comparent à rien", () => {
    const multiSectorShift = {
      ...shift("multi", "luca", "2026-07-20", 360, 840),
      sectorAssignments: [
        { sectorId: "drive", startMinutes: 360, endMinutes: 600 },
        { sectorId: "caisse", startMinutes: 600, endMinutes: 840 },
      ],
    }
    const board = buildPlanningBoard(
      { ...input(), shifts: [multiSectorShift] },
      selection({ sectorIds: ["drive"] })
    )
    const row = board.sectorView.rows.find((entry) => String(entry.employeeId) === "luca")

    expect(row?.hoursLabel).toBe("4h / 16h · sélection partielle")
    // Aucun écart : comparer un morceau de ses rayons à son contrat entier
    // produirait un retard qui n'existe pas.
    expect(row?.deviationLabel).toBeNull()
  })
})

describe("vue semaine — objectif de rayon et contrat salarié", () => {
  it("distingue un objectif de rayon du vrai contrat salarié", () => {
    const scoped: PlanningBoardInput = {
      ...input(),
      employees: [
        {
          ...employee("aurelie", "Aurélie Lemeltiez", 36 * 60 + 45),
          weeklyTargetMinutes: 8 * 60,
        },
      ],
      shifts: [shift("aurelie-lundi", "aurelie", "2026-07-20", 360, 840)],
      demand: [
        {
          sectorId: "drive",
          date: "2026-07-20",
          startMinutes: 360,
          endMinutes: 420,
          requiredEmployees: 1,
        },
      ],
    }

    const board = buildPlanningBoard(
      scoped,
      selection({ view: "employee", employeeId: "aurelie" as unknown as EmployeeId })
    )
    const row = board.sectorView.rows[0]

    // « fait / dû », et le dû est LA CIBLE — la part de rayon, pas le contrat,
    // sans quoi l'écart affiché à côté mesurerait autre chose que les deux
    // nombres qu'on lit. Le suffixe empêche de prendre ce 8h/8h pour un
    // contrat de 36h45 rempli.
    expect(row.hoursLabel).toBe("8h / 8h · rayon")
    expect(row.onTarget).toBe(true)
    expect(row.targetKind).toBe("sector-allocation")
    expect(board.employeeView?.general).toContainEqual({
      label: "Contrat hebdomadaire",
      value: "36h45",
      level: "neutral",
    })
    expect(board.employeeView?.general).toContainEqual({
      label: "Objectif de cette génération",
      value: "8h",
      level: "neutral",
    })
    expect(board.summary.facts.map((fact) => fact.label)).toContain(
      "Toutes les affectations prévues dans ce rayon sont réalisées"
    )
    expect(board.summary.facts.map((fact) => fact.label)).not.toContain(
      "Tous les contrats sont respectés"
    )
  })

  it("compte uniquement les minutes du rayon affiché dans un shift multi-rayon", () => {
    const problem = input()
    const multiSectorShift = {
      ...shift("multi", "luca", "2026-07-20", 360, 840),
      sectorAssignments: [
        { sectorId: "drive", startMinutes: 360, endMinutes: 600 },
        { sectorId: "caisse", startMinutes: 600, endMinutes: 840 },
      ],
    }
    const board = buildPlanningBoard(
      { ...problem, shifts: [multiSectorShift] },
      selection({ sectorIds: ["drive"] })
    )

    expect(board.sectorView.columns[0].totalLabel).toBe("4h")
    const row = board.sectorView.rows.find((row) => String(row.employeeId) === "luca")
    expect(row?.plannedLabel).toBe("4h")
    expect(row?.comparisonAvailable).toBe(false)
    expect(row?.targetKind).toBe("filtered-selection")
    expect(row?.deviationLabel).toBeNull()
  })

  it("additionne les besoins simultanés de plusieurs rayons", () => {
    const problem = input()
    const board = buildPlanningBoard(
      {
        ...problem,
        demand: [
          { sectorId: "drive", date: "2026-07-20", startMinutes: 360, endMinutes: 420, requiredEmployees: 1 },
          { sectorId: "caisse", date: "2026-07-20", startMinutes: 360, endMinutes: 420, requiredEmployees: 1 },
        ],
      },
      selection({ view: "day", sectorIds: ["drive", "caisse"], date: "2026-07-20" })
    )

    expect(board.dayView.requiredRow.find((cell) => cell.startMinutes === 360)?.required).toBe(2)
  })
})

describe("grille — les bornes du jour viennent du SECTEUR", () => {
  it("colore ouverture et fermeture contre les horaires du secteur", () => {
    // Un Drive ouvrant à 06:00 dans un magasin ouvrant à 08:00 : le vrai
    // ouvreur commence à 06:00, et c'est lui qui doit porter la couleur.
    const problem = input()
    const board = buildPlanningBoard(
      {
        ...problem,
        // Journée déclarée par le secteur : 06:00 → 20:00.
        days: problem.days.map((day) => ({ ...day, opensAtMinutes: 360, closesAtMinutes: 1200 })),
      },
      selection()
    )
    const monday = board.dayView.rows.flatMap((row) => row.shifts).filter((shift) => shift.date === "2026-07-20")
    expect(monday.some((shift) => shift.opensDay)).toBe(true)
    expect(monday.some((shift) => shift.closesDay)).toBe(true)
  })

  it("ne lit jamais les horaires du magasin dans l'adaptateur", () => {
    // La grille est dessinée contre la fenêtre du secteur ; retomber sur le
    // magasin y remettrait les bornes du jour au mauvais endroit.
    const adapter = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "adapters", "from-editor-state.ts"),
      "utf8"
    )
    expect(adapter).not.toContain("sectorList[0]?.hours")
    // Le magasin reste le repli, et seulement cela.
    expect(adapter).toContain("Math.min(...openCandidates")
    expect(adapter).toContain("Math.max(...openCandidates")
  })
})

describe("la couleur et le rôle voyagent jusqu'à la barre", () => {
  it("porte la couleur du rayon et le rôle PAR BLOC", () => {
    // Le chemin qui manquait : la grille peut colorer par rayon seulement si le
    // ViewModel lui donne la couleur et, pour chaque bloc, s'il ouvre ou ferme
    // SON comptoir — pas celui du voisin.
    const problem = input()
    const multiSectorShift = {
      ...shift("multi", "luca", "2026-07-20", 360, 840),
      sectorAssignments: [
        { sectorId: "drive", startMinutes: 360, endMinutes: 600 },
        { sectorId: "caisse", startMinutes: 600, endMinutes: 840 },
      ],
    }
    const board = buildPlanningBoard(
      {
        ...problem,
        sectors: [
          { id: "drive", name: "Drive", color: "#2563eb" },
          { id: "caisse", name: "Caisse", color: "#facc15" },
        ],
        shifts: [multiSectorShift],
      },
      selection({ view: "day", sectorIds: ["drive", "caisse"], date: "2026-07-20" })
    )

    const blocks = board.dayView.rows
      .flatMap((row) => row.shifts)
      .flatMap((shift) => shift.sectorBlocks)
    expect(blocks.map((block) => block.sectorName)).toEqual(["Drive", "Caisse"])
    expect(blocks.map((block) => block.color)).toEqual(["#2563eb", "#facc15"])
    expect(blocks.map((block) => block.durationLabel)).toEqual(["4h", "4h"])
    // Le jour ouvre à 06:00 : c'est le bloc Drive qui ouvre, pas celui de Caisse.
    expect(blocks.map((block) => block.opens)).toEqual([true, false])
    expect(blocks.map((block) => block.closes)).toEqual([false, false])
  })

  it("garde UN segment continu et y loge les deux rayons", () => {
    // Ce que la vue par jour montrait : un seul rayon. La barre déplaçable suit
    // les segments RÉELS du shift — un seul ici, puisque changer de comptoir à
    // midi n'interrompt pas la journée — alors que le ViewModel en fabriquait un
    // par rayon. Tout ce qui s'indexait dessus ne voyait donc que le premier.
    const problem = input()
    const multiSectorShift = {
      ...shift("multi", "luca", "2026-07-20", 360, 840),
      sectorAssignments: [
        { sectorId: "drive", startMinutes: 360, endMinutes: 600 },
        { sectorId: "caisse", startMinutes: 600, endMinutes: 840 },
      ],
    }
    const board = buildPlanningBoard(
      {
        ...problem,
        sectors: [
          { id: "drive", name: "Drive", color: "#2563eb" },
          { id: "caisse", name: "Caisse", color: "#facc15" },
        ],
        shifts: [multiSectorShift],
      },
      selection({ view: "day", sectorIds: ["drive", "caisse"], date: "2026-07-20" })
    )

    const bar = board.dayView.rows.flatMap((row) => row.shifts)[0]
    expect(bar.segments).toHaveLength(1)
    // Une journée continue n'est pas une journée coupée, même à deux comptoirs.
    expect(bar.isSplit).toBe(false)
    expect(bar.segments[0].sectors.map((part) => part.sectorName)).toEqual(["Drive", "Caisse"])
    // Chacun occupe la moitié de la barre, exprimée EN POURCENTAGE DE LA BARRE :
    // c'est ce qui leur permet de suivre quand on la déplace.
    expect(bar.segments[0].sectors.map((part) => part.offsetPercent)).toEqual([0, 50])
    expect(bar.segments[0].sectors.map((part) => part.widthPercent)).toEqual([50, 50])
  })

  it("découpe chaque morceau d'une journée coupée par ses propres rayons", () => {
    const problem = input()
    const splitShift = {
      ...shift("coupe", "luca", "2026-07-20", 360, 900),
      segments: [
        { startMinutes: 360, endMinutes: 600 },
        { startMinutes: 780, endMinutes: 900 },
      ],
      sectorAssignments: [
        { sectorId: "drive", startMinutes: 360, endMinutes: 480 },
        { sectorId: "caisse", startMinutes: 480, endMinutes: 600 },
        { sectorId: "caisse", startMinutes: 780, endMinutes: 900 },
      ],
    }
    const board = buildPlanningBoard(
      {
        ...problem,
        sectors: [
          { id: "drive", name: "Drive", color: "#2563eb" },
          { id: "caisse", name: "Caisse", color: "#facc15" },
        ],
        shifts: [splitShift],
      },
      selection({ view: "day", sectorIds: ["drive", "caisse"], date: "2026-07-20" })
    )

    const bar = board.dayView.rows.flatMap((row) => row.shifts)[0]
    expect(bar.segments).toHaveLength(2)
    expect(bar.isSplit).toBe(true)
    expect(bar.segments[0].sectors.map((part) => part.sectorName)).toEqual(["Drive", "Caisse"])
    expect(bar.segments[1].sectors.map((part) => part.sectorName)).toEqual(["Caisse"])
    // Le second morceau n'a qu'un rayon : il occupe tout, sans décalage.
    expect(bar.segments[1].sectors[0].offsetPercent).toBe(0)
    expect(bar.segments[1].sectors[0].widthPercent).toBe(100)
  })
})
