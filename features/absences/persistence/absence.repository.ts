import type { KeyValueStore } from "@/features/core/shared/key-value-store"
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
 * Le magasin des absences, derrière une interface qui ne dit pas où elles vivent.
 *
 * Rien ne s'efface, jamais. `cancel` marque, il ne retire pas : une absence
 * saisie puis retirée est exactement ce qu'on cherche à reconstituer six mois
 * plus tard, devant un désaccord.
 */
export interface AbsenceRepository {
  list(): Promise<AbsenceRecord[]>
  create(draft: AbsenceDraft, today: string, rules?: AbsenceRules): Promise<AbsenceRecord>
  extend(id: string, newEnd: string, today: string): Promise<AbsenceRecord | null>
  cancel(id: string, today: string): Promise<AbsenceRecord | null>
  markProofReceived(id: string, receivedOn: string): Promise<AbsenceRecord | null>
}

export interface AbsenceRepositoryOptions {
  readonly generateId?: () => string
}

export function createAbsenceRepository(
  store: KeyValueStore,
  options: AbsenceRepositoryOptions = {}
): AbsenceRepository {
  const generateId =
    options.generateId ??
    (() => `absence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

  function readAll(): AbsenceRecord[] {
    try {
      const value: unknown = JSON.parse(store.getItem(ABSENCES_KEY) ?? "[]")
      if (!Array.isArray(value)) return []
      // Filtré à la lecture : une entrée malformée — écrite par une version
      // ancienne, ou par une main — disparaît de la liste au lieu de faire
      // tomber l'écran qui la parcourt.
      return value.filter(isAbsenceRecord).map((absence) => ({ ...absence }))
    } catch {
      return []
    }
  }

  function writeAll(absences: readonly AbsenceRecord[]): void {
    store.setItem(ABSENCES_KEY, JSON.stringify(absences))
  }

  function update(
    id: string,
    change: (absence: AbsenceRecord) => AbsenceRecord
  ): AbsenceRecord | null {
    const all = readAll()
    const index = all.findIndex((absence) => absence.id === id)
    if (index === -1) return null
    const updated = change(all[index])
    writeAll([...all.slice(0, index), updated, ...all.slice(index + 1)])
    return updated
  }

  return {
    async list() {
      return readAll()
    },

    /**
     * Enregistre une absence, et calcule la date à laquelle son justificatif est
     * attendu — ici, et non à l'affichage : ce délai court à partir du DÉBUT de
     * l'absence, pas du jour où l'on regarde l'écran, et une règle changée dans
     * les paramètres ne doit pas rendre soudain « en retard » un papier arrivé à
     * temps l'an dernier.
     */
    async create(draft, today, rules = DEFAULT_ABSENCE_RULES) {
      const definition = resolveMotive(rules, draft.type)
      const record: AbsenceRecord = {
        id: generateId(),
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
      writeAll([...readAll(), record])
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
    async extend(id, newEnd, today) {
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

    async cancel(id, today) {
      return update(id, (absence) => ({
        ...absence,
        status: "cancelled",
        cancelledOn: today,
      }))
    },

    async markProofReceived(id, receivedOn) {
      return update(id, (absence) => ({ ...absence, proofReceivedOn: receivedOn }))
    },
  }
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
