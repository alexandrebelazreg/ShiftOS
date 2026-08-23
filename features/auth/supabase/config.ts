/**
 * Où la base se trouve, et avec quelle clé on la joint.
 *
 * Deux noms sont acceptés pour la même clé parce que Supabase l'a renommée :
 * les projets récents affichent « publishable key », les anciens « anon key ».
 * Lire les deux évite le message d'erreur le plus stérile qui soit — une clé
 * correctement copiée, sous un nom que le code n'attendait pas.
 *
 * Cette clé est publique par construction : elle part dans le navigateur, et
 * c'est le cloisonnement en base qui protège les données, jamais son secret.
 * La clé `service_role`, elle, ne doit jamais entrer dans ce fichier ni dans
 * aucune variable préfixée `NEXT_PUBLIC_` — elle contourne toutes les
 * politiques.
 */

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL manque.")
  return url
}

export function supabaseKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY) manque."
    )
  }
  return key
}

/** Vrai quand la configuration permet de joindre la base. */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )
}
