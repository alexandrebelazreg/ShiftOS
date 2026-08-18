import {
  DEFAULT_ABSENCE_RULES,
  resolveMotive,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import type {
  AbsenceExtension,
  AbsenceRecord,
  DayHalf,
} from "@/features/absences/types/absence-record"
import type { AbsenceType } from "@/features/core/models"

const ABSENCES_KEY = "shiftos_absences"
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Ce qu'il faut fournir pour enregistrer une absence. */
export interface AbsenceDraft {
  readonly employeeId: string
  readonly type: AbsenceType
  readonly start: string
  readonly end: string
  readonly halfDay?: DayHalf
  readonly hours?: number
  readonly note?: string
}

/**
 * Le magasin des absences.
 *
 * Écrit dans le même localStorage que la lecture d'origine, sous la même clé :
 * les absences déjà enregistrées par une autre voie doivent continuer de se
 * relire, et un écran qui ne verrait que ses propres saisies mentirait sur qui
 * est présent.
 *
 * Rien ne s'efface, jamais. `cancel` marque, il ne retire pas : une absence
 * saisie puis retirée est exactement ce qu'on cherche à reconstituer six mois
 * plus tard, devant un désaccord.
 */
export const absenceService = {
  async list(): Promise<AbsenceRecord[]> {
    return readAll()
  },

  /**
   * Enregistre une absence, et calcule la date à laquelle son justificatif est
   * attendu — ici, et non à l'affichage : ce délai court à partir du DÉBUT de
   * l'absence, pas du jour où l'on regarde l'écran, et une règle changée dans
   * les paramètres ne doit pas rendre soudain « en retard » un papier arrivé à
   * temps l'an dernier.
   */
  async create(
    draft: AbsenceDraft,
    today: string,
    rules: AbsenceRules = DEFAULT_ABSENCE_RULES
  ): Promise<AbsenceRecord> {
    const definition = resolveMotive(rules, draft.type)
    const record: AbsenceRecord = {
      id: newId(),
      employeeId: draft.employeeId,
      type: draft.type,
      start: draft.start,
      end: draft.end,
      ...(draft.halfDay ? { halfDay: draft.halfDay } : {}),
      ...(draft.hours !== undefined ? { hours: draft.hours } : {}),
      ...(draft.note ? { note: draft.note } : {}),
      status: "active",
      recordedOn: today,
      ...(definition.proof?.dueDays != null
        ? { proofDueOn: addDays(draft.start, definition.proof.dueDays) }
        : {}),
    }
    writeAll([...(await readAll()), record])
    return record
  },

  /**
   * Prolonge une absence : la fin recule, et l'étape est gardée.
   *
   * C'est le SEUL geste qui répond à « on ne sait pas encore s'il y aura une
   * prolongation » — l'arrêt est enregistré avec la fin que porte son papier,
   * et le jour où un second papier arrive, on repousse la date ici. Enregistrer
   * une fin ouverte à la place aurait fait disparaître du planning quelqu'un
   * dont on savait très bien qu'il revenait le 12.
   *
   * L'historique compte autant que la nouvelle date — un arrêt de quinze jours
   * et trois arrêts de cinq jours bout à bout ne se valent ni pour la paie ni
   * pour la prévoyance, et la seule date d'aujourd'hui ne permet plus de dire
   * laquelle des deux on a vécue.
   */
  async extend(id: string, newEnd: string, today: string): Promise<AbsenceRecord | null> {
    return update(id, (absence) => {
      const step: AbsenceExtension = {
        previousEnd: absence.end,
        newEnd,
        recordedOn: today,
      }
      return {
        ...absence,
        end: newEnd,
        extensions: [...(absence.extensions ?? []), step],
      }
    })
  },

  async cancel(id: string, today: string): Promise<AbsenceRecord | null> {
    return update(id, (absence) => ({
      ...absence,
      status: "cancelled",
      cancelledOn: today,
    }))
  },

  async markProofReceived(id: string, receivedOn: string): Promise<AbsenceRecord | null> {
    return update(id, (absence) => ({ ...absence, proofReceivedOn: receivedOn }))
  },
}

async function update(
  id: string,
  change: (absence: AbsenceRecord) => AbsenceRecord
): Promise<AbsenceRecord | null> {
  const all = await readAll()
  const index = all.findIndex((absence) => absence.id === id)
  if (index === -1) return null
  const updated = change(all[index])
  writeAll([...all.slice(0, index), updated, ...all.slice(index + 1)])
  return updated
}

function readAll(): Promise<AbsenceRecord[]> {
  if (typeof window === "undefined") return Promise.resolve([])

  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(ABSENCES_KEY) ?? "[]"
    )
    if (!Array.isArray(value)) return Promise.resolve([])
    return Promise.resolve(value.filter(isAbsenceRecord).map((absence) => ({ ...absence })))
  } catch {
    return Promise.resolve([])
  }
}

function writeAll(absences: readonly AbsenceRecord[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ABSENCES_KEY, JSON.stringify(absences))
}

function newId(): string {
  return `absence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function isAbsenceRecord(value: unknown): value is AbsenceRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>

  return (
    typeof record.id === "string" &&
    typeof record.employeeId === "string" &&
    typeof record.type === "string" &&
    record.type.trim().length > 0 &&
    typeof record.start === "string" &&
    ISO_DATE_PATTERN.test(record.start) &&
    typeof record.end === "string" &&
    ISO_DATE_PATTERN.test(record.end) &&
    record.start <= record.end &&
    (record.note === undefined || typeof record.note === "string")
  )
}
