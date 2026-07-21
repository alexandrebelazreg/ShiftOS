"use client"

import { useRouter } from "next/navigation"
import { Plus, UserPlus } from "lucide-react"

import { EmployeeCard } from "@/features/employees/components/EmployeeCard"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { Button } from "@/components/ui/button"

/**
 * Top-level Employee module screen: header, list of cards and the create/edit
 * drawer. Owns the drawer state and wires form submissions to the data hook.
 */
export function EmployeesView() {
  const { employees, isLoading } = useEmployees()
  const router = useRouter()
  const openCreate = () => router.push("/configuration/employes/nouveau")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Équipe</h1>
          <p className="text-sm text-muted-foreground">
            Gérez les profils, contrats et contraintes de votre équipe.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Nouvel employé
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <UserPlus className="size-6 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Aucun employé créé</p>
            <p className="text-sm text-muted-foreground">
              Créez votre premier employé pour poursuivre la configuration.
            </p>
          </div>
          <Button variant="outline" onClick={openCreate}>
            <Plus />
            Créer mon premier employé
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {employees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
            />
          ))}
        </div>
      )}
    </div>
  )
}
