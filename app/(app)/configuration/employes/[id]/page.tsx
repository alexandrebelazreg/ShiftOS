import { EmployeeProfile } from "@/features/employees/components/EmployeeProfile"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import { getStore } from "@/features/store/services/store.repository"

/**
 * Fiche employé — lit le magasin côté serveur, parce que ce sont ses horaires
 * qui décident si l'onglet Dimanche a quelque chose à régler.
 */
export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EmployeeProfile employeeId={id} sundayOpen={storeOpensOn(await getStore(), "sunday")} />
}
