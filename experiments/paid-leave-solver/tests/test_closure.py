"""La fermeture du magasin : ce qui ne s'arbitre pas.

L'article L3141-16 laisse à l'employeur le soin de fixer l'ordre et les dates
des départs, et la fermeture annuelle en est le cas le plus simple : tout le
monde est en congé, personne n'a rien demandé, personne ne peut refuser.

Le solveur n'a donc rien à décider sur ces semaines — mais il doit en tenir
compte trois fois, et c'est la troisième qui se laisse oublier : une semaine
fermée SOUDE les congés de part et d'autre. Sans cela, l'étage `leave_blocks`
voit une coupure là où le salarié vit une seule absence continue, et dépense de
la qualité à éviter un défaut qui n'existe pas.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(28, 40)]


def _payload(
    plans: list[dict],
    target: int,
    *,
    closure: list[str],
    minimum: float = 0.0,
    minimum_on: list[str] | None = None,
) -> dict:
    """Une personne, aucune concurrence : la fermeture est le seul sujet."""
    return {
        "campaignId": "test-fermeture",
        "timeoutSeconds": 20,
        "weeks": WEEKS,
        "closureWeekIds": closure,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": [
            {
                "id": "alice",
                "name": "Alice",
                "sectorId": "drive",
                "contractHours": 35.0,
                "targetWeeks": target,
                "linkedEmployeeId": None,
                "seniorityOrder": 1,
                "firstChoiceHistory": 0,
                "plans": plans,
                "unavailableWeekIds": [],
            },
        ],
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0,
                "minimumHours": minimum if (minimum_on is None or week in minimum_on) else 0.0,
                "toleratedDeficitHours": 0.0,
                "maximumAbsent": None,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


class FermetureTests(unittest.TestCase):
    def test_une_semaine_fermee_ne_s_attribue_jamais(self) -> None:
        """Même souhaitée, même servable : il n'y a rien à accorder."""
        # Le plan en contient trois, dont une fermée, et la cible en vaut deux :
        # le solveur doit prendre les deux ouvertes, jamais la fermée. Sans le
        # filtrage, W31 est une attribution comme une autre et peut être choisie
        # à la place de W32.
        response = main(
            _payload(
                [{"rank": 1, "weekIds": ["2026-W30", "2026-W31", "2026-W32"]}],
                2,
                closure=["2026-W31"],
            )
        )

        self.assertEqual(response["status"], "optimal")
        self.assertNotIn("2026-W31", response["grants"]["alice"])
        self.assertEqual(response["grants"]["alice"], ["2026-W30", "2026-W32"])

    def test_une_semaine_fermee_soude_les_conges_de_part_et_d_autre(self) -> None:
        """Trois semaines d'absence continue, et non deux morceaux."""
        # W30, fermeture en W31, W32 : le salarié part trois semaines d'affilée.
        # Compter deux morceaux ferait chercher au solveur un regroupement qui
        # existe déjà, au prix de la qualité qu'il aurait pu dépenser ailleurs.
        soude = main(
            _payload(
                [{"rank": 1, "weekIds": ["2026-W30", "2026-W32"]}],
                2,
                closure=["2026-W31"],
            )
        )
        coupe = main(
            _payload([{"rank": 1, "weekIds": ["2026-W30", "2026-W32"]}], 2, closure=[])
        )

        self.assertEqual(soude["grants"]["alice"], ["2026-W30", "2026-W32"])
        self.assertEqual(coupe["grants"]["alice"], ["2026-W30", "2026-W32"])
        # Mêmes semaines, deux lectures : c'est la fermeture qui fait la
        # différence, et elle seule.
        self.assertEqual(soude["objectiveValues"]["leave_blocks"], 1.0)
        self.assertEqual(coupe["objectiveValues"]["leave_blocks"], 2.0)

    def test_la_soudure_ne_traverse_pas_deux_semaines_ouvertes(self) -> None:
        """Une fermeture ne recolle que ce qu'elle touche."""
        # W30, fermeture en W31, puis W35 : la seconde attribution est bien à
        # part. Sans cette vérification, « ne compte pas ce début de morceau »
        # pourrait se généraliser à toute la campagne dès qu'une semaine ferme.
        response = main(
            _payload(
                [{"rank": 1, "weekIds": ["2026-W30", "2026-W35"]}],
                2,
                closure=["2026-W31"],
            )
        )

        self.assertEqual(response["objectiveValues"]["leave_blocks"], 2.0)

    def test_un_minimum_sur_une_semaine_fermee_ne_rend_pas_la_campagne_impossible(self) -> None:
        """Magasin fermé : il n'y a pas de comptoir à tenir."""
        # Le minimum dépasse ce que le contrat fournit — sur une semaine où
        # personne ne travaille. La ligne gardée, le solveur refusait la campagne
        # entière en accusant les contrats du rayon, qui n'y sont pour rien.
        response = main(
            _payload(
                [{"rank": 1, "weekIds": ["2026-W34", "2026-W35"]}],
                2,
                closure=["2026-W31"],
                minimum=200.0,
                minimum_on=["2026-W31"],
            )
        )

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["alice"], ["2026-W34", "2026-W35"])

    def test_le_premier_voeu_survit_a_une_fermeture_en_son_milieu(self) -> None:
        """Le plan reste « entièrement servi » quand la fermeture l'ampute."""
        # Le plan porte trois semaines dont une fermée ; la cible en vaut deux.
        # Comparer la taille BRUTE du plan à la cible faisait disparaître la
        # variable d'équité, et avec elle tout le rattrapage — sur la seule foi
        # d'une fermeture que la personne n'a pas choisie.
        response = main(
            _payload(
                [{"rank": 1, "weekIds": ["2026-W30", "2026-W31", "2026-W32"]}],
                2,
                closure=["2026-W31"],
            )
        )

        self.assertEqual(response["objectiveValues"]["first_choice_served"], 1.0)

    def test_sans_fermeture_le_modele_est_celui_d_avant(self) -> None:
        """Le champ absent ne change rien, et c'est ce qui rend l'ajout sûr."""
        avec_champ = main(
            _payload([{"rank": 1, "weekIds": ["2026-W30", "2026-W31"]}], 2, closure=[])
        )
        sans_champ = _payload([{"rank": 1, "weekIds": ["2026-W30", "2026-W31"]}], 2, closure=[])
        del sans_champ["closureWeekIds"]

        self.assertEqual(avec_champ["grants"], main(sans_champ)["grants"])
        self.assertEqual(
            avec_champ["objectiveValues"]["leave_blocks"],
            main(sans_champ)["objectiveValues"]["leave_blocks"],
        )


if __name__ == "__main__":
    unittest.main()
