"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LayoutGrid, List, Plus, Rows3, UserPlus } from "lucide-react"

import { EmployeeCard } from "@/features/employees/components/EmployeeCard"
import { EmployeeRow } from "@/features/employees/components/EmployeeRow"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import {
  EMPLOYEE_DISPLAY_MODES,
  EMPLOYEE_DISPLAY_MODE_LABELS,
  groupEmployeesBySector,
  isEmployeeDisplayMode,
  type EmployeeDisplayMode,
} from "@/features/employees/grouping"
import { citationFamilyLabel, type EmployeeCitation } from "@/features/employees/deletion"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

const MODE_KEY = "shiftos_employees_display_mode"
const MODE_ICONS: Record<EmployeeDisplayMode, typeof LayoutGrid> = {
  cards: LayoutGrid,
  list: List,
  sectors: Rows3,
}

/**
 * Top-level Employee module screen: header, list of cards and the create/edit
 * drawer. Owns the drawer state and wires form submissions to the data hook.
 */
export function EmployeesView() {
  const { employees, isLoading, setEmployeeScheduleType, removeEmployee } = useEmployees()
  const router = useRouter()
  const openCreate = () => router.push("/configuration/employes/nouveau")

  const [mode, setMode] = useState<EmployeeDisplayMode>("cards")
  const [sectorOrder, setSectorOrder] = useState<readonly string[]>([])
  const [pendingDeletion, setPendingDeletion] = useState<EmployeeRecord | null>(null)
  const [refusal, setRefusal] = useState<readonly EmployeeCitation[]>([])
  const [isDeleting, setIsDeleting] = useState(false)

  // Le choix d'affichage suit le gérant d'une visite à l'autre : c'est une
  // préférence de lecture, pas une donnée du magasin — d'où le navigateur
  // plutôt que la base.
  useEffect(() => {
    // Différé comme le chargement des secteurs juste en dessous : lire le choix
    // dans le corps de l'effet enchaînerait deux rendus, et le lire à
    // l'initialisation toucherait `localStorage` pendant le rendu serveur.
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(MODE_KEY)
      if (isEmployeeDisplayMode(stored)) setMode(stored)
    })
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void createSetupRepository().listSectors().then((sectors) => setSectorOrder(sectors.map((sector) => sector.name)))
    })
  }, [])

  function chooseMode(next: EmployeeDisplayMode) {
    setMode(next)
    window.localStorage.setItem(MODE_KEY, next)
  }

  const groups = useMemo(
    () => groupEmployeesBySector(employees, sectorOrder),
    [employees, sectorOrder]
  )

  function askDeletion(employee: EmployeeRecord) {
    setRefusal([])
    setPendingDeletion(employee)
  }

  async function confirmDeletion() {
    if (!pendingDeletion) return
    setIsDeleting(true)
    try {
      // Le verdict est relu ici, dans le hook : entre l'ouverture du dialogue et
      // ce clic, une semaine a pu être publiée depuis un autre onglet.
      const verdict = await removeEmployee(pendingDeletion.id)
      if (verdict.deletable) setPendingDeletion(null)
      else setRefusal(verdict.citations)
    } finally {
      setIsDeleting(false)
    }
  }

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
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {employees.length} fiche{employees.length > 1 ? "s" : ""}
            </p>
            <div role="group" aria-label="Affichage de l’équipe" className="inline-flex rounded-lg border p-0.5">
              {EMPLOYEE_DISPLAY_MODES.map((value) => {
                const Icon = MODE_ICONS[value]
                return (
                  <Button
                    key={value}
                    size="sm"
                    variant="ghost"
                    aria-pressed={mode === value}
                    onClick={() => chooseMode(value)}
                    className={cn("gap-1.5", mode === value && "bg-muted text-foreground")}
                  >
                    <Icon />
                    {EMPLOYEE_DISPLAY_MODE_LABELS[value]}
                  </Button>
                )
              })}
            </div>
          </div>

          {mode === "cards" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {employees.map((employee) => (
                <EmployeeCard
                  key={employee.id}
                  employee={employee}
                  onScheduleTypeChange={(scheduleType) => setEmployeeScheduleType(employee.id, scheduleType)}
                  onDelete={() => askDeletion(employee)}
                />
              ))}
            </div>
          ) : null}

          {mode === "list" ? (
            <div className="rounded-xl border">
              {employees.map((employee) => (
                <EmployeeRow key={employee.id} employee={employee} onDelete={() => askDeletion(employee)} />
              ))}
            </div>
          ) : null}

          {mode === "sectors" ? (
            <div className="space-y-6">
              {groups.map((group) => (
                <section key={group.key} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold">{group.label}</h2>
                    <span className="text-xs text-muted-foreground">
                      {group.employees.length} salarié{group.employees.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {group.employees.length === 0 ? (
                    <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                      Personne n’est affecté à ce secteur. La génération le refusera.
                    </p>
                  ) : (
                    <div className="rounded-xl border">
                      {group.employees.map((employee) => (
                        <EmployeeRow
                          key={`${group.key}-${employee.id}`}
                          employee={employee}
                          onDelete={() => askDeletion(employee)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={pendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeletion(null)
            setRefusal([])
          }
        }}
        title={pendingDeletion ? `Supprimer la fiche de ${getFullName(pendingDeletion)} ?` : "Supprimer la fiche ?"}
        description={
          refusal.length > 0
            ? "Cette fiche est citée ailleurs. La supprimer rendrait ces enregistrements illisibles : désactivez-la plutôt depuis son profil, elle sortira des plannings sans effacer son histoire."
            : "Cette action est définitive et ne peut pas être annulée. Elle n’est proposée que parce que rien ne cite encore cette fiche."
        }
        blockedBy={refusal.map((citation) => `${citationFamilyLabel(citation.family)} — ${citation.label}`)}
        blockedTitle="Cette fiche est citée par :"
        confirmLabel="Supprimer définitivement"
        onConfirm={() => void confirmDeletion()}
        isPending={isDeleting}
      />
    </div>
  )
}
