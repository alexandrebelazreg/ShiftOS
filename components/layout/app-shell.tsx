import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"

/**
 * Application shell: fixed sidebar + fixed header + scrollable content area.
 * Wrap any page tree with this to get the full app chrome.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
