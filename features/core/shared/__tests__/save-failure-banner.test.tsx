import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SaveFailureBanner } from "@/components/feedback/save-failure-banner"

/**
 * Le bandeau que quatre écrans partagent depuis que les données ont quitté le
 * navigateur.
 *
 * Rendu plutôt que raisonné : ce qu'on veut prouver n'est pas qu'une fonction
 * rend une chaîne, c'est qu'un message d'échec est ANNONCÉ et qu'il dit la
 * bonne chose. Deux propriétés qui ne se voient que dans le balisage.
 */

describe("bandeau d'échec d'enregistrement", () => {
  it("ne dit rien quand tout s'est bien passé", () => {
    // Un bandeau qui survit à une réussite ferait douter d'un enregistrement
    // qui vient pourtant de passer.
    expect(renderToStaticMarkup(<SaveFailureBanner failure={null} />)).toBe("")
  })

  it("s'annonce, au lieu de se contenter de s'afficher", () => {
    // `role="alert"` : celui qui vient de cliquer regarde souvent ailleurs.
    const markup = renderToStaticMarkup(<SaveFailureBanner failure="réseau injoignable" />)
    expect(markup).toContain('role="alert"')
  })

  it("dit la conséquence, pas seulement l'échec", () => {
    // Le malentendu à éviter est précis : la modification EST à l'écran et
    // n'est PAS en base. Un « une erreur est survenue » ne le dirait pas.
    const markup = renderToStaticMarkup(<SaveFailureBanner failure="réseau injoignable" />)
    expect(markup).toContain("n’a pas été enregistrée")
    expect(markup).toContain("apparaît à l’écran")
    expect(markup).toContain("recommencez")
  })

  it("nomme ce qui n'est pas parti", () => {
    const markup = renderToStaticMarkup(
      <SaveFailureBanner failure="hors ligne" what="Cette permanence" />
    )
    expect(markup).toContain("Cette permanence")
  })

  it("laisse la cause technique lisible, pour qu'on puisse la rapporter", () => {
    const markup = renderToStaticMarkup(<SaveFailureBanner failure="JWT expired" />)
    expect(markup).toContain("JWT expired")
  })
})
