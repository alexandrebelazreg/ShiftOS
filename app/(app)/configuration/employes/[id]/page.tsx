import type { Metadata } from "next"

import { EmployeeProfile } from "@/features/employees/components/EmployeeProfile"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import { getStore } from "@/features/store/services/store.repository"

/**
 * Titre fixe, et non le nom du salarié.
 *
 * Le nom serait meilleur pour distinguer deux fiches ouvertes côte à côte, mais
 * il n'est pas lisible ici : `EmployeeProfile` est un composant client qui va
 * chercher la fiche depuis le navigateur. Le rendre disponible au serveur
 * demanderait une lecture de plus à chaque affichage, pour un onglet.
 *
 * Le jour où une lecture serveur existera pour d'autres raisons, ceci devient
 * un `generateMetadata` qui la réutilise.
 */
export const metadata: Metadata = { title: "Fiche employé" }

/**
 * Fiche employé — lit le magasin côté serveur, parce que ce sont ses horaires
 * qui décident si l'onglet Dimanche a quelque chose à régler.
 */
export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EmployeeProfile employeeId={id} sundayOpen={storeOpensOn(await getStore(), "sunday")} />
}
