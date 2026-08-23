import { describe, expect, it } from "vitest"
import {
  currentSetupStep,
  evaluateSetupReadiness,
  SETUP_STEPS,
  STEP_EMPLOYEES,
  STEP_FIRST_PLANNING,
  STEP_SECTORS,
  STEP_STORE,
} from "@/features/onboarding/setup-readiness"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { WEEK_DAYS } from "@/features/core/models"

const store: StoreConfig = { name: "Magasin test", address: "1 rue du Test", city: "Paris", postalCode: "75001", country: "France", timezone: "Europe/Paris", openingHours: WEEK_DAYS.map((day) => ({ day, closed: day !== "monday", opensAt: "09:00", closesAt: "18:00" })), planningMode: "dynamic", minShiftDuration: 120, maxShiftDuration: 600, timeGranularity: 60, splitShiftPolicy: "forbidden", minSplitDuration: undefined, maxSplitDuration: undefined, maxSplitShiftsPerWeek: undefined, minDailyHours: 2, maxDailyHours: 10, minRestBetweenShifts: 11, maxWeeklyHoursOverride: undefined }
const employee: EmployeeRecord = { id: "employee_1", firstName: "Marie", lastName: "Martin", phone: "", email: "", status: "active", weeklyHours: 35, workingDays: ["monday"], contractType: "full_time", sectors: ["Accueil"], canOpen: true, canClose: true, splitShiftAllowed: false, fixedDaysOff: [], forbiddenDays: [], maxOpenings: null, maxClosings: 0, preferOpening: false, preferClosing: true, notes: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }
const completeSector = () => ({ ...createEmptySector("sector_1"), name: "Accueil", weeklyDistributionEnabled: true, hours: createEmptySector().hours.map((day) => day.day === "monday" ? { ...day, closed: false } : day), coverage: { standardDay: "monday" as const, profiles: { monday: buildHourlyProfile("09:00", "18:00") } }, weeklyDistribution: { monday: 100, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 } })

const messages = (result: ReturnType<typeof evaluateSetupReadiness>) =>
  result.blockers.map((blocker) => blocker.message)

describe("configuration initiale", () => {
  it("bloque quand la configuration obligatoire manque", () => {
    const result = evaluateSetupReadiness({ store, employees: [], sectors: [] })
    expect(result.ready).toBe(false)
    expect(messages(result)).toContain("Créez au moins un secteur.")
  })

  it("autorise un secteur complet avec un salarié affecté sans compétence obligatoire", () => {
    expect(evaluateSetupReadiness({ store, employees: [employee], sectors: [completeSector()] })).toEqual({ ready: true, blockers: [] })
  })

  it("détecte une demande secteur incomplète", () => {
    const sector = { ...completeSector(), weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 90 } }
    const result = evaluateSetupReadiness({ store, employees: [employee], sectors: [sector] })
    expect(result.ready).toBe(false)
    expect(messages(result)[0]).toContain("Accueil")
  })
})

/**
 * Ce qu'un manque doit dire de lui-même.
 *
 * Le verdict ne rendait que des phrases. Elles ne portaient ni la cause exacte
 * ni la destination, si bien que le tableau de bord retrouvait le lien en
 * cherchant des mots dans la prose : reformuler un message déplaçait
 * silencieusement un bouton. Et une demande invalide se disait dans les mêmes
 * termes qu'un secteur sans personne, alors que les deux se corrigent sur deux
 * écrans différents.
 */
describe("un manque dit sa cause et son chemin", () => {
  it("sépare une demande invalide d'un secteur sans salarié", () => {
    // Le secteur est bien réglé mais personne n'y est affecté : un seul manque,
    // et il pointe vers les salariés, pas vers le secteur.
    const orphan = evaluateSetupReadiness({ store, employees: [], sectors: [completeSector()] })
    const assignment = orphan.blockers.find((blocker) => blocker.message.includes("Aucun salarié actif"))
    expect(assignment, "le secteur désert n'a pas été signalé pour lui-même").toBeDefined()
    expect(assignment!.step).toBe(STEP_EMPLOYEES)
    expect(assignment!.href).toBe(SETUP_STEPS[STEP_EMPLOYEES - 1].href)

    // La demande invalide, elle, se corrige sur le secteur.
    const broken = { ...completeSector(), weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 90 } }
    const demand = evaluateSetupReadiness({ store, employees: [employee], sectors: [broken] }).blockers[0]
    expect(demand.step).toBe(STEP_SECTORS)
    expect(demand.href).toBe(SETUP_STEPS[STEP_SECTORS - 1].href)
  })

  it("porte le détail du validateur au lieu de le jeter", () => {
    // C'est le validateur qui sait quel champ est refusé et pourquoi. Sans son
    // détail, huit secteurs mal réglés produisaient huit phrases identiques.
    const broken = { ...completeSector(), weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 90 } }
    const demand = evaluateSetupReadiness({ store, employees: [employee], sectors: [broken] }).blockers[0]
    expect(demand.details ?? []).not.toHaveLength(0)
  })

  it("nomme chaque secteur en cause, pour qu'ils ne se confondent pas", () => {
    const first = { ...completeSector(), id: "s1", name: "Accueil", weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 90 } }
    const second = { ...completeSector(), id: "s2", name: "Drive", weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 80 } }
    const result = evaluateSetupReadiness({ store, employees: [employee], sectors: [first, second] })
    const demands = messages(result).filter((message) => message.includes("demande"))
    expect(demands.some((message) => message.includes("Accueil"))).toBe(true)
    expect(demands.some((message) => message.includes("Drive"))).toBe(true)
  })

  it("envoie au magasin quand c'est le magasin qui manque", () => {
    const result = evaluateSetupReadiness({ store: null, employees: [employee], sectors: [completeSector()] })
    expect(result.blockers[0].step).toBe(STEP_STORE)
    expect(result.blockers[0].href).toBe(SETUP_STEPS[0].href)
  })
})

/**
 * L'étape courante — celle qui barrait la route, et non celle qu'on avait
 * dépassée. L'ancien calcul comptait les objets créés : il s'arrêtait à la
 * quatrième dès qu'un secteur et un salarié existaient, puis sautait à la
 * dernière. La cinquième n'était jamais courante et la barre restait figée
 * pendant qu'on corrigeait ce qui bloquait vraiment.
 */
describe("étape courante", () => {
  it("désigne le premier manque, et non le dernier", () => {
    const result = evaluateSetupReadiness({ store: null, employees: [], sectors: [] })
    expect(currentSetupStep(result)).toBe(STEP_STORE)
  })

  it("avance jusqu'au premier planning quand plus rien ne bloque", () => {
    const result = evaluateSetupReadiness({ store, employees: [employee], sectors: [completeSector()] })
    expect(currentSetupStep(result)).toBe(STEP_FIRST_PLANNING)
  })

  it("reste sur les secteurs tant qu'un secteur est mal réglé", () => {
    // Un salarié existe, un secteur existe : l'ancien calcul affichait la
    // quatrième étape et laissait croire que l'essentiel était fait.
    const broken = { ...completeSector(), weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 90 } }
    const result = evaluateSetupReadiness({ store, employees: [employee], sectors: [broken] })
    expect(currentSetupStep(result)).toBe(STEP_SECTORS)
  })

  it("n'annonce obligatoire que ce qui l'est vraiment", () => {
    // Compétences et contraintes affinent un planning, elles ne le rendent pas
    // possible. Les annoncer obligatoires promettait deux étapes que rien ne
    // validait jamais.
    expect(SETUP_STEPS.filter((step) => step.optional).map((step) => step.label)).toEqual([
      "Compétences",
      "Contraintes",
    ])
  })
})
