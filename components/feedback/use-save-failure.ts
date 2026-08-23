"use client"

import { useCallback, useState } from "react"

/**
 * Ce qui manquait à tout écran depuis que les données ont quitté le navigateur.
 *
 * Écrire dans `localStorage` ne ratait jamais : l'appel rendait, la valeur était
 * là, et un écran pouvait afficher la modification sans se poser de question.
 * Écrire à travers un réseau rate — connexion coupée, session expirée, base
 * injoignable — et l'ancienne habitude devient un mensonge : l'écran montre le
 * réglage, la base ne l'a pas.
 *
 * Le silence est le vrai danger. Une erreur affichée fait recommencer ; une
 * erreur avalée fait croire que c'est fait, et ne se découvre que le jour où
 * l'on cherche pourquoi une permanence a disparu.
 *
 * `guard` enveloppe l'écriture. Il rend `null` en cas d'échec plutôt que de
 * relancer : l'appelant a déjà mis son écran à jour, et le faire tomber
 * n'apprendrait rien de plus au gérant.
 */
export function useSaveFailure() {
  const [failure, setFailure] = useState<string | null>(null)

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    // Effacé à chaque tentative : un message qui survit à une réussite ferait
    // douter d'un enregistrement qui vient pourtant de passer.
    setFailure(null)
    try {
      return await work()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [])

  const clear = useCallback(() => setFailure(null), [])

  return { failure, guard, clear }
}
