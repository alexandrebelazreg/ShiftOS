"use client"

/**
 * Le dernier filet : quand c'est la mise en page racine qui tombe.
 *
 * `error.tsx` n'attrape que ce qui se trouve SOUS lui. Si la racine elle-même
 * échoue — la police, la feuille de style, le garde de session — il n'y a plus
 * personne au-dessus, et l'utilisateur voit une page blanche.
 *
 * Ce fichier remplace alors la racine entière. D'où ses propres `<html>` et
 * `<body>` : ceux du layout n'existent plus à ce stade. Et d'où ses styles
 * écrits en ligne — la feuille globale fait partie de ce qui a pu ne pas se
 * charger, s'y fier ici reviendrait à compter sur ce qui vient de céder.
 *
 * Pas de `metadata` : un composant client ne peut pas en exporter. Le titre
 * passe par la balise elle-même.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  readonly error: Error & { digest?: string }
  readonly unstable_retry: () => void
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#f4f5f7",
          color: "#141821",
        }}
      >
        <title>ShiftOS — incident</title>
        <main style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem", letterSpacing: "-0.02em" }}>
            ShiftOS n’a pas pu démarrer
          </h1>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.95rem", lineHeight: 1.6, color: "#565e70" }}>
            L’incident touche l’application entière, pas seulement cet écran. Vos données sont
            en base et ne sont pas concernées.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              cursor: "pointer",
              border: "1px solid #141821",
              background: "#141821",
              color: "#fff",
              borderRadius: "0.375rem",
              padding: "0.5rem 0.9rem",
              fontSize: "0.9rem",
            }}
          >
            Réessayer
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1.25rem", fontFamily: "ui-monospace, monospace", fontSize: "0.75rem", color: "#838b9c" }}>
              Référence : {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
