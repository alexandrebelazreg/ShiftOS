import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Le magasin de la session, vu du navigateur.
 *
 * Les LECTURES n'en ont pas besoin : la politique de cloisonnement filtre déjà
 * sur `current_store_id()`, et une requête sans clause `where` ne rend que les
 * lignes du magasin connecté. Les ÉCRITURES si — `store_id` est obligatoire, et
 * la base rejette toute valeur qui ne serait pas celle de la session.
 *
 * Résolu une fois par client, puis mémorisé : la valeur ne change pas tant
 * qu'on ne se déconnecte pas, et l'aller-retour ne doit pas se payer à chaque
 * enregistrement.
 */
const cache = new WeakMap<object, Promise<string | null>>()

export function currentStoreId(client: SupabaseClient): Promise<string | null> {
  const known = cache.get(client)
  if (known) return known

  // Enveloppé dans une fonction async plutôt que chaîné : le constructeur de
  // requête de Supabase rend un `PromiseLike`, qui n'a pas de `catch`. Le
  // chaînage compilait faux et n'aurait échoué qu'à l'exécution.
  const pending = (async (): Promise<string | null> => {
    try {
      const { data } = await client.from("profiles").select("store_id").maybeSingle()
      return (data?.store_id as string | undefined) ?? null
    } catch {
      // Hors ligne, session expirée, table injoignable : l'appelant décide quoi
      // en faire. Ici, ne pas savoir se dit en rendant `null`, jamais en levant.
      return null
    }
  })()

  cache.set(client, pending)
  return pending
}

/**
 * Le magasin, ou un refus net.
 *
 * Un compte sans profil n'est pas une erreur technique : c'est un compte qui
 * n'a pas encore été rattaché. Écrire quand même produirait une ligne que la
 * base rejetterait avec un message sur une politique — vrai, mais illisible.
 */
export async function requireStoreId(client: SupabaseClient): Promise<string> {
  const storeId = await currentStoreId(client)
  if (!storeId) {
    throw new Error(
      "Aucun magasin rattaché à ce compte. L'enregistrement est impossible tant que le rattachement n'est pas fait."
    )
  }
  return storeId
}
