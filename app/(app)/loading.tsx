/**
 * Ce que l'écran montre pendant qu'il se remplit.
 *
 * Lire depuis le navigateur était instantané ; lire depuis une base ne l'est
 * plus. Sans ce fichier, la navigation semblait figée entre deux écrans — rien
 * ne bougeait, et le réflexe est de recliquer.
 *
 * Un squelette plutôt qu'un mot : il occupe la place que le contenu prendra,
 * donc l'écran ne saute pas au moment où il arrive.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement en cours</span>
      <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  )
}
