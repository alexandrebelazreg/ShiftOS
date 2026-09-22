import "server-only"

import { createSupabaseAbsenceRepository } from "@/features/absences/persistence/absence.supabase-repository"
import { createSupabaseServerClient } from "@/features/auth/supabase/server"
import { createSupabaseEmployeeRepository } from "@/features/employees/persistence/employee.supabase-repository"
import { createSupabasePaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave.supabase-repository"
import {
  buildPaidLeaveSolveRequest,
  type PaidLeaveSolveRequest,
} from "@/features/paid-leave/solver/paid-leave-solver-contract"
import { createSupabaseSectorRepository } from "@/features/sectors/sector.supabase-repository"

/**
 * La demande de calcul, reconstruite DEPUIS LA BASE.
 *
 * Jusqu'ici la route recevait une demande entièrement bâtie par le navigateur et
 * la passait au solveur sans la relire : minimums de couverture, plafonds
 * d'effectif, soldes, cibles, tout venait du client. Le schéma Zod vérifiait la
 * FORME et rien d'autre. Une requête forgée à la main — `minimumHours` à zéro,
 * `maximumAbsent` à `null`, `targetWeeks` à dix — était parfaitement valide, et
 * le résultat revenait ensuite s'enregistrer dans la campagne.
 *
 * Ce n'est pas une brèche d'isolation : les politiques de la base empêchent
 * toujours de lire ou d'écrire chez le voisin, et un gérant est chez lui. C'est
 * une brèche d'INTÉGRITÉ, et elle vise précisément ce qui fait la valeur du
 * produit : les règles. Un outil dont on peut désactiver les contraintes depuis
 * la console du navigateur ne prouve rien à personne — ni à l'inspection du
 * travail, ni au salarié qui conteste son arbitrage.
 *
 * Désormais le client n'envoie qu'un IDENTIFIANT. Tout le reste est relu sous
 * la session de l'appelant, donc sous ses politiques : une campagne qu'il ne
 * peut pas lire n'existe pas pour lui, et il ne peut pas en fabriquer une.
 *
 * Rend `null` quand la campagne est introuvable, ce qui recouvre deux cas que la
 * route ne doit surtout PAS distinguer dans sa réponse : elle n'existe pas, ou
 * elle appartient à un autre magasin. Les séparer dirait à un curieux si un
 * identifiant est utilisé ailleurs.
 */
export async function loadPaidLeaveSolveRequest(
  campaignId: string,
  timeoutSeconds: number
): Promise<PaidLeaveSolveRequest | null> {
  const client = await createSupabaseServerClient()
  const campaign = await createSupabasePaidLeaveRepository(client).get(campaignId)
  if (!campaign) return null

  // En parallèle : trois lectures indépendantes, et le solveur attend déjà
  // plusieurs secondes derrière. Les enchaîner ajouterait deux allers-retours à
  // chaque calcul sans rien simplifier.
  const [employees, sectors, absences] = await Promise.all([
    createSupabaseEmployeeRepository(client).list(),
    createSupabaseSectorRepository(client).list(),
    createSupabaseAbsenceRepository(client).list(),
  ])

  return buildPaidLeaveSolveRequest({
    campaign,
    employees,
    sectors,
    absences,
    timeoutSeconds,
  })
}
