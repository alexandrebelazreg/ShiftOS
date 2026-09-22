"""Une semaine où l'on est déjà absent ne peut pas devenir un congé payé.

Rien ne croisait l'écran des absences et celui des congés. Le solveur pouvait
donc accorder une semaine de congés payés à quelqu'un en arrêt maladie, en congé
parental ou en formation : deux absences superposées sur la même semaine, l'une
décomptée du solde de congés et l'autre pas, découvertes à la paie.

La semaine est CLOUÉE à zéro plutôt que retirée du problème. Elle garde ainsi sa
place dans les plans, dans le découpage en morceaux et dans le calcul du premier
vœu — aucun de ces mécanismes n'a de cas particulier à connaître.

Et la cible n'est PAS réduite : la personne a bien demandé ces semaines. Ne pas
pouvoir les lui donner est un manque qu'il faut annoncer, pas une demande qu'il
faut réécrire dans son dos.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(26, 36)]


def _payload(plan_un: list[str], indisponibles: list[str], *, cible: int | None = None) -> dict:
    return {
        "campaignId": "test-deja-absent",
        "timeoutSeconds": 20,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": [
            {
                "id": "alice",
                "name": "Alice",
                "sectorId": "drive",
                "contractHours": 35.0,
                "targetWeeks": cible if cible is not None else len(plan_un),
                "linkedEmployeeId": None,
                "seniorityOrder": 1,
                "firstChoiceHistory": 0,
                "plans": [{"rank": 1, "weekIds": plan_un}],
                "unavailableWeekIds": indisponibles,
            },
        ],
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0,
                "minimumHours": 0.0,
                "toleratedDeficitHours": 0.0,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


class AlreadyAbsent(unittest.TestCase):
    def test_une_semaine_bloquee_nest_jamais_accordee(self) -> None:
        """Alice est en arrêt la W31 : elle n'obtient que la W30.

        Aucune contrainte de couverture ici — les minimums valent zéro. Ce qui
        l'empêche de partir la W31 ne vient donc que du croisement avec les
        absences, et de rien d'autre.
        """
        response = main(_payload(["2026-W30", "2026-W31"], ["2026-W31"]))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["alice"], ["2026-W30"])

    def test_le_manque_est_annonce_et_non_absorbe(self) -> None:
        """Deux semaines demandées, une seule possible : l'écart vaut un.

        La cible reste à deux. Si elle était ramenée à un, la personne
        apparaîtrait servie en entier — et le gérant ne saurait jamais qu'une
        semaine demandée n'a pas été donnée.
        """
        response = main(_payload(["2026-W30", "2026-W31"], ["2026-W31"]))
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 1.0)

    def test_un_plan_entierement_bloque_ne_donne_rien(self) -> None:
        """Un congé parental couvrant tout le plan : aucune semaine, et l'écart le dit."""
        response = main(
            _payload(["2026-W30", "2026-W31"], ["2026-W30", "2026-W31"])
        )
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["alice"], [])
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 2.0)

    def test_une_semaine_bloquee_ne_compte_pas_comme_premier_voeu(self) -> None:
        """On ne peut pas être « entièrement servi au premier vœu » à moitié.

        C'est la même règle que côté application : toutes les semaines du plan,
        ou rien. Une semaine clouée empêche donc mécaniquement le compte, et
        l'équité entre campagnes n'enregistre pas un rattrapage qui n'a pas eu
        lieu.
        """
        response = main(_payload(["2026-W30", "2026-W31"], ["2026-W31"]))
        self.assertEqual(response["objectiveValues"]["first_choice_served"], 0.0)

    def test_rien_de_bloque_laisse_le_modele_intact(self) -> None:
        """La liste vide est le cas normal, et elle ne change rien."""
        response = main(_payload(["2026-W30", "2026-W31"], []))
        self.assertEqual(response["grants"]["alice"], ["2026-W30", "2026-W31"])
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertEqual(response["objectiveValues"]["first_choice_served"], 1.0)

    def test_le_champ_absent_vaut_liste_vide(self) -> None:
        """Une charge utile sans le champ reste valide.

        Le contrat lui donne une valeur par défaut, mais le solveur ne doit pas
        en dépendre : il est appelé par des tests, par des rejeux de campagnes
        enregistrées, et un jour par autre chose.
        """
        payload = _payload(["2026-W30", "2026-W31"], [])
        del payload["employees"][0]["unavailableWeekIds"]
        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["alice"], ["2026-W30", "2026-W31"])

    def test_le_repli_prend_le_relais_quand_le_premier_plan_est_bloque(self) -> None:
        """Arrêt sur tout le plan préféré : c'est le plan de repli, en entier.

        Le croisement avec les absences ne court-circuite aucune des règles
        posées avant lui — servir le plus possible, puis un plan entier.
        """
        payload = _payload(["2026-W30", "2026-W31"], ["2026-W30", "2026-W31"], cible=2)
        payload["employees"][0]["plans"].append(
            {"rank": 2, "weekIds": ["2026-W34", "2026-W35"]}
        )
        response = main(payload)
        self.assertEqual(response["grants"]["alice"], ["2026-W34", "2026-W35"])
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertEqual(response["objectiveValues"]["extra_plans"], 0.0)


if __name__ == "__main__":
    unittest.main()
