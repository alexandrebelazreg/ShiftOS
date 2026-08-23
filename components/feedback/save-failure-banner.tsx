"use client"

/**
 * Le message qu'un enregistrement raté doit laisser.
 *
 * `role="alert"` : il doit être ANNONCÉ, pas seulement affiché. Celui qui vient
 * de cliquer regarde souvent ailleurs — la ligne suivante du planning, son
 * téléphone — et un bandeau silencieux ne l'atteindrait pas.
 *
 * Le texte dit ce qui n'a pas eu lieu et quoi faire, jamais « une erreur est
 * survenue ». Et il nomme la conséquence — la modification est à l'écran mais
 * pas en base — parce que c'est exactement le malentendu qu'on veut éviter.
 */
export function SaveFailureBanner({
  failure,
  what = "Cette modification",
}: {
  readonly failure: string | null
  /** Ce qui n'a pas été enregistré, à la place de « Cette modification ». */
  readonly what?: string
}) {
  if (!failure) return null

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <p>
        <strong>{what} n’a pas été enregistrée.</strong> Elle apparaît à l’écran mais n’est pas
        partie : vérifiez votre connexion, puis recommencez.
      </p>
      <p className="mt-1 font-mono text-xs opacity-80">{failure}</p>
    </div>
  )
}
