"use client"

import { createContext, useContext } from "react"

/**
 * Qui imprime, disponible partout sans être passé de main en main.
 *
 * Trois feuilles le réclament — planning, congés payés, permanences — et elles
 * n'ont aucun lien de parenté entre elles. Celle des congés vit six niveaux
 * sous sa page. Faire descendre le nom en propriété aurait demandé de modifier
 * une dizaine de signatures qui n'ont rien à voir avec l'impression, et chacune
 * aurait été une occasion de l'oublier en route — un oubli qui ne casse rien et
 * ne se voit que sur le papier.
 *
 * C'est une donnée d'ambiance : vraie pour tout l'écran, lue par quelques
 * feuilles. Un contexte est exactement cela.
 *
 * `null` par défaut, et c'est le bon défaut : hors de la coquille applicative —
 * un test de rendu, la page de connexion — il n'y a personne de connecté, et
 * la feuille ne doit alors être signée de personne.
 */
const PrintedByContext = createContext<string | null>(null)

export function PrintedByProvider({
  name,
  children,
}: {
  readonly name: string | null
  readonly children: React.ReactNode
}) {
  return <PrintedByContext value={name}>{children}</PrintedByContext>
}

/** Le nom de la personne connectée, ou `null` si elle n'en a pas saisi. */
export function usePrintedBy(): string | null {
  return useContext(PrintedByContext)
}
