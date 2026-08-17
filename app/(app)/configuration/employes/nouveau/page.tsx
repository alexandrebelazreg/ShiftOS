import { EmployeeCreatePage } from "@/features/employees/components/EmployeeCreatePage"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import { getStore } from "@/features/store/services/store.repository"

export default async function NewEmployeePage() {
  return <EmployeeCreatePage sundayOpen={storeOpensOn(await getStore(), "sunday")} />
}
