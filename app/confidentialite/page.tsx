import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"

export const metadata: Metadata = {
  title: "Confidentialité",
  description: "Les données que Planiteo enregistre, qui y accède et combien de temps elles restent.",
}

/**
 * La page que l'on peut atteindre sans compte.
 *
 * Hors du groupe `(app)` et déclarée publique dans `proxy.ts` : un salarié qui
 * arrive sur l'écran de connexion n'a pas de compte et n'en aura pas. S'il ne
 * peut pas lire ceci sans se connecter, l'information n'est pas donnée.
 *
 * Volontairement plus courte que `docs/rgpd/INFORMATION_DES_SALARIES.md`, qui
 * est le document remis en main propre et signé. Celle-ci est le rappel
 * consultable, pas la formalité.
 */
export default async function ConfidentialitePage() {
  // Rendue à la requête, alors que son contenu ne bouge jamais.
  //
  // La CSP du proxy porte un nonce recalculé à chaque requête, et Next ne peut
  // le poser sur ses scripts qu'en rendant la page au moment où l'en-tête
  // existe. Générée à la compilation, cette page arriverait avec des scripts
  // sans nonce : le navigateur les refuserait, et la page cesserait de
  // s'hydrater sans rien afficher qui l'explique.
  await connection()

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Confidentialité</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ce que Planiteo enregistre, qui y accède, et combien de temps.
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed">
        <section className="space-y-2">
          <h2 className="font-medium">À quoi sert ce logiciel</h2>
          <p>
            Il construit les plannings du magasin, tient le compte des absences, organise le tour de
            permanence et répartit les congés payés. Il ne sert à rien d’autre. Il ne contient aucune
            note, aucun classement, aucun indicateur de rendement individuel, et aucune décision
            concernant une personne n’y est prise automatiquement : un planning proposé est relu et
            arrêté par un responsable.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Ce qui est enregistré sur un salarié</h2>
          <p>
            Son nom et son prénom, et s’ils ont été donnés, son e-mail et son téléphone. Son contrat :
            type, durée hebdomadaire, jours travaillés. Ses contraintes de service : repos, horaires de
            prise et de fin de poste, rayons maîtrisés, aptitude à ouvrir et à fermer, participation au
            tour de permanence. Ses absences, avec leurs dates et leur motif. Son accord pour le
            dimanche, s’il travaille le dimanche, avec la cadence acceptée et la contrepartie choisie.
            Et les plannings établis, semaine par semaine.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Les informations particulièrement protégées</h2>
          <p>
            Un arrêt maladie, un accident du travail, une maternité ou un mi-temps thérapeutique disent
            quelque chose de la santé d’une personne. Des heures de délégation disent qu’elle exerce un
            mandat. Ces informations ne sont enregistrées que parce qu’elles changent le calcul du
            planning ou de la paie, et elles ne sortent pas du magasin.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Qui y accède</h2>
          <p>
            La direction du magasin, et personne d’autre. Les données d’un magasin sont techniquement
            séparées de celles des autres magasins, par la base elle-même autant que par l’application.
            Rien n’est transmis à un tiers ni utilisé à des fins publicitaires.
          </p>
          <p>
            Le site ne dépose aucun traceur et ne mesure pas l’audience. Le seul cookie posé est celui
            qui maintient une session ouverte après une connexion.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Combien de temps</h2>
          <p>
            Trente-six mois pour les absences, les plannings et les tours de permanence, comptés depuis
            la période concernée. La fiche d’un salarié est conservée tant qu’il fait partie de
            l’effectif, puis le temps nécessaire à la conservation des plannings passés.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium">Vos droits</h2>
          <p>
            Vous pouvez demander à voir ce qui est enregistré sur vous, à le faire corriger, effacer ou
            limiter, vous y opposer pour un motif tenant à votre situation, ou en récupérer une copie.
            La demande se fait auprès de la direction du magasin, qui doit répondre dans le mois.
          </p>
          <p>
            En cas de désaccord ou d’absence de réponse, vous pouvez saisir la CNIL, 3 place de
            Fontenoy, 75007 Paris, ou sur{" "}
            <a
              href="https://www.cnil.fr"
              className="underline underline-offset-4"
              rel="noreferrer noopener"
            >
              cnil.fr
            </a>
            .
          </p>
        </section>
      </div>

      <p className="mt-12 text-sm">
        <Link href="/login" className="underline underline-offset-4">
          Retour à la connexion
        </Link>
      </p>
    </main>
  )
}
