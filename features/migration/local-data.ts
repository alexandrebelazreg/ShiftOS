/**
 * Ce que ce navigateur détient encore, relevé sans rien interpréter.
 *
 * La reprise ne peut pas être faite par le serveur : les données vivent dans le
 * `localStorage` d'UN poste, celui du gérant, et personne d'autre ne peut les
 * atteindre. C'est donc la page elle-même qui les lit, puis les écrit en base.
 *
 * Rien n'est validé ici. Un enregistrement abîmé doit être VU dans le relevé
 * plutôt qu'écarté en silence : ce qui manque à l'arrivée doit pouvoir se
 * chercher, et une reprise qui filtre discrètement ne laisse rien à chercher.
 */

export interface LocalSnapshot {
  readonly sectors: unknown[]
  readonly employees: unknown[]
  readonly absences: unknown[]
  readonly absenceRules: unknown | null
  readonly holidays: unknown | null
  readonly plannings: unknown[]
  readonly permanences: unknown[]
  readonly campaigns: unknown[]
  readonly activeCampaignId: string | null
}

export interface SnapshotCount {
  readonly label: string
  readonly count: number
}

function parse(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function array(raw: string | null): unknown[] {
  const value = parse(raw)
  return Array.isArray(value) ? value : []
}

/** Toutes les clés d'un préfixe, dans l'ordre où le navigateur les rend. */
function byPrefix(storage: Storage, prefix: string): unknown[] {
  const found: unknown[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || !key.startsWith(prefix)) continue
    const value = parse(storage.getItem(key))
    if (value !== null) found.push(value)
  }
  return found
}

export function readLocalSnapshot(storage: Storage): LocalSnapshot {
  return {
    // La clé s'appelle encore `first_run_setup`, héritée du premier parcours
    // d'installation. Le nom ne dit plus ce qu'il contient ; le changer aurait
    // perdu la configuration des postes qui l'utilisent.
    sectors: array(storage.getItem("shiftos_first_run_setup")),
    employees: array(storage.getItem("shiftos_employees")),
    absences: array(storage.getItem("shiftos_absences")),
    absenceRules: parse(storage.getItem("shiftos_absence_rules")),
    holidays: parse(storage.getItem("shiftos_holidays")),
    // Balayés par préfixe plutôt que lus dans leur index : un index qui a perdu
    // une entrée ferait disparaître un planning qui existe pourtant, et une
    // reprise est le pire moment pour faire confiance à un index.
    plannings: byPrefix(storage, "shiftos_planning_").filter(
      (value) => typeof value === "object" && value !== null && "state" in (value as object)
    ),
    permanences: byPrefix(storage, "shiftos_permanence_"),
    campaigns: byPrefix(storage, "shiftos_paid_leave_campaign_").filter(
      (value) => typeof value === "object" && value !== null && "id" in (value as object)
    ),
    activeCampaignId: storage.getItem("shiftos_paid_leave_active_campaign"),
  }
}

/** Le relevé, tel qu'on le montre avant de décider. */
export function summarize(snapshot: LocalSnapshot): SnapshotCount[] {
  return [
    { label: "Secteurs", count: snapshot.sectors.length },
    { label: "Salariés", count: snapshot.employees.length },
    { label: "Absences", count: snapshot.absences.length },
    { label: "Plannings", count: snapshot.plannings.length },
    { label: "Mois de permanence", count: snapshot.permanences.length },
    { label: "Campagnes de congés", count: snapshot.campaigns.length },
    { label: "Règles d'absence", count: snapshot.absenceRules ? 1 : 0 },
    { label: "Décisions sur les fériés", count: snapshot.holidays ? 1 : 0 },
  ]
}

export function isEmpty(snapshot: LocalSnapshot): boolean {
  return summarize(snapshot).every((entry) => entry.count === 0)
}
