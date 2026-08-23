import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import { WEEK_DAYS } from "@/features/core/models"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import { normalizeContract } from "@/features/employees/persistence/employee.repository"
import type { EmployeeRepository } from "@/features/employees/persistence/employee.repository"
import type {
  EmployeeRecord,
  EmployeeScheduleType,
} from "@/features/employees/types/employee.types"

/**
 * Les fiches salariés, en base.
 *
 * Même interface que le dépôt `localStorage` : `useEmployees` et les cinq
 * écrans qui l'appellent ne savent pas laquelle des deux ils tiennent, et n'ont
 * pas à le savoir. C'est ce qui a permis à cette phase de ne toucher aucun
 * composant.
 *
 * Le navigateur interroge la base directement. Ce qui l'empêche de lire chez le
 * voisin n'est pas une clause `where` — c'est la politique posée en phase 1,
 * éprouvée sous un rôle ordinaire avant d'être livrée : la base REFUSE, elle ne
 * se contente pas de ne rien rendre.
 *
 * Aucun `where store_id = ...` n'est donc écrit sur les lectures. En ajouter un
 * donnerait l'illusion que c'est lui qui protège, et le jour où on l'oublierait
 * on croirait avoir ouvert une brèche alors qu'il n'y en a jamais eu.
 */

/** Les colonnes promues hors du `jsonb`, parce qu'on filtre ou trie dessus. */
export interface EmployeeRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  status: string
  contract_type: string | null
  weekly_minutes: number | null
  profile: Record<string, unknown>
  created_at: string
  updated_at: string
}

export function toRecord(row: EmployeeRow): EmployeeRecord {
  // Le `jsonb` d'abord, les colonnes ensuite : ce qui a été promu fait foi, et
  // une valeur restée dans le blob après une migration ne doit pas la contredire.
  return normalizeContract({
    ...(row.profile as unknown as EmployeeRecord),
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? "",
    phone: row.phone ?? "",
    status: row.status as EmployeeRecord["status"],
    contractType: row.contract_type as EmployeeRecord["contractType"],
    weeklyMinutes: row.weekly_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

/**
 * Ce qui a été promu en colonne, et ne doit donc pas être redit dans le blob.
 *
 * Nommé une fois, ici. Deux listes qui divergent — l'une pour écrire les
 * colonnes, l'autre pour les retirer du `jsonb` — laisseraient une valeur
 * périmée dans le blob, et c'est celle-là qu'on lirait le jour où la colonne
 * change sans que le blob suive.
 */
const PROMOTED_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "phone",
  "status",
  "contractType",
  "weeklyMinutes",
  "createdAt",
  "updatedAt",
] as const

/** Ce qui part en base : les colonnes, et tout le reste dans `profile`. */
export function toRow(record: EmployeeRecord, storeId: string) {
  const profile: Record<string, unknown> = { ...(record as unknown as Record<string, unknown>) }
  for (const field of PROMOTED_FIELDS) delete profile[field]

  return {
    // L'identifiant vient de l'application, jamais de la base. Les plannings
    // enregistrés citent le salarié par ce nom-là, dans tout leur état : le
    // laisser changer romprait le lien avec chaque semaine passée.
    id: record.id,
    store_id: storeId,
    first_name: record.firstName,
    last_name: record.lastName,
    email: record.email || null,
    phone: record.phone || null,
    status: record.status,
    contract_type: record.contractType ?? null,
    weekly_minutes: record.weeklyMinutes ?? null,
    profile,
  }
}

/** Ce qu'un brouillon de formulaire devient, avant d'exister en base. */
function fromDraft(draft: EmployeeDraft, previous?: EmployeeRecord): EmployeeRecord {
  return {
    ...(previous ?? {}),
    ...draft,
    schemaVersion: 2,
    weeklyMinutes: draft.weeklyMinutes ?? Math.round(draft.weeklyHours * 60),
    contractMinuteConfirmationRequired: false,
    scheduleType: draft.scheduleType ?? previous?.scheduleType ?? "variable",
    student: draft.student ?? previous?.student ?? false,
    forfaitJour: draft.forfaitJour ?? previous?.forfaitJour ?? false,
    workingDays: WEEK_DAYS.filter((day) => !draft.fixedDaysOff.includes(day)),
  } as EmployeeRecord
}

export function createSupabaseEmployeeRepository(client: SupabaseClient): EmployeeRepository {
  async function fetchOne(id: string): Promise<EmployeeRecord> {
    const { data, error } = await client.from("employees").select("*").eq("id", id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error(`Employee not found: ${id}`)
    return toRecord(data as EmployeeRow)
  }

  return {
    async list() {
      const { data, error } = await client
        .from("employees")
        .select("*")
        .order("created_at", { ascending: false })
      if (error) throw new Error(error.message)
      return (data as EmployeeRow[]).map(toRecord)
    },

    async getById(id) {
      const { data, error } = await client.from("employees").select("*").eq("id", id).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? toRecord(data as EmployeeRow) : null
    },

    async create(draft) {
      const storeId = await requireStoreId(client)
      const record = { ...fromDraft(draft), id: `emp_${crypto.randomUUID()}` } as EmployeeRecord
      const { data, error } = await client
        .from("employees")
        .insert(toRow(record, storeId))
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return toRecord(data as EmployeeRow)
    },

    async update(id, draft) {
      // La fiche existante est relue d'abord : un brouillon ne porte pas tous
      // les champs, et écraser le `jsonb` avec ce qu'il contient seul ferait
      // disparaître en silence tout ce que le formulaire n'affichait pas.
      const previous = await fetchOne(id)
      const storeId = await requireStoreId(client)
      const { data, error } = await client
        .from("employees")
        .update(toRow(fromDraft(draft, previous), storeId))
        .eq("id", id)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return toRecord(data as EmployeeRow)
    },

    async disable(id) {
      const { data, error } = await client
        .from("employees")
        .update({ status: "inactive" })
        .eq("id", id)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return toRecord(data as EmployeeRow)
    },

    async remove(id: string) {
      // La cascade SQL sur `absences` rend cette ligne dangereuse par elle-même :
      // elle emporterait les absences du salarié sans rien signaler. Le
      // verdict de suppression doit avoir été rendu AVANT — il l'est côté
      // application, seule place d'où l'on voit aussi les plannings et les
      // tours de permanence, rangés en JSON et invisibles à la base.
      const { error } = await client.from("employees").delete().eq("id", id)
      if (error) throw new Error(error.message)
    },

    async setScheduleType(id: string, scheduleType: EmployeeScheduleType) {
      const previous = await fetchOne(id)
      const storeId = await requireStoreId(client)
      const { data, error } = await client
        .from("employees")
        .update(toRow({ ...previous, scheduleType }, storeId))
        .eq("id", id)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return toRecord(data as EmployeeRow)
    },
  }
}
