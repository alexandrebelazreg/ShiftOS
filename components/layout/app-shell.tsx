import { MobileSidebar } from "@/components/layout/mobile-sidebar"
import { Sidebar } from "@/components/layout/sidebar"
import { PrintedByProvider } from "@/features/auth/components/printed-by"
import { currentSession } from "@/features/auth/dal"

/**
 * Application shell: fixed sidebar + scrollable content area.
 *
 * LE BANDEAU DU HAUT A ÉTÉ RETIRÉ. Il portait trois choses, aucune utile : une
 * recherche qui ne cherchait rien, une cloche de notifications sans
 * notifications, et le mot « Gestionnaire » — un libellé en dur, le même pour
 * tout le monde, qui ne disait donc pas qui était connecté. Cinquante-six
 * pixels de haut sur chaque écran pour cela.
 *
 * Ce qu'il portait de nécessaire est le bouton de navigation mobile : sous
 * `lg` le rail latéral est masqué, et sans ce bouton il n'y aurait plus aucun
 * moyen de naviguer. Il reste donc, seul, sur une ligne qui n'existe QUE sous
 * `lg` — le poste du gérant n'en voit rien.
 *
 * L'identité et la déconnexion vivent désormais en bas du rail, là où l'on va
 * déjà chercher la configuration.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await currentSession()
  const identity = {
    name: session?.fullName ?? null,
    email: session?.email ?? "",
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar identity={identity} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-4 lg:hidden">
          <MobileSidebar identity={identity} />
        </div>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-6 py-6">
            <PrintedByProvider name={identity.name}>{children}</PrintedByProvider>
          </div>
        </main>
      </div>
    </div>
  )
}
