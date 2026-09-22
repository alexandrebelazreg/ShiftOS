"""La chaîne d'étages : ce qu'elle mesure, et ce qu'elle ne fait pas tourner pour rien.

Deux corrections de la même famille, trouvées au second audit du solveur.

Le rang du plan obtenu se comptait en SEMAINES, à travers trois étages
`wish_1/2/3`. C'est le défaut déjà corrigé sur l'équité, laissé intact ici : qui
demande beaucoup passe devant qui demande peu, sans que personne l'ait décidé.

Et l'étage `coverage_deficit` tournait même quand toutes ses variables étaient
bornées à zéro — ce qui est le réglage PAR DÉFAUT de l'application, puisque
`createPaidLeaveCampaign` écrit `toleratedDeficitHours: 0`.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(18, 40)]
CONVOITEES = ("2026-W30", "2026-W31")


def _payload(employes: list[dict], *, tolerance: float = 0.0) -> dict:
    base = sum(employe["contractHours"] for employe in employes)
    return {
        "campaignId": "test-chaine",
        "timeoutSeconds": 30,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employes,
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": base,
                # Un seul absent à la fois sur les deux semaines convoitées.
                "minimumHours": base - 35.0 if week in CONVOITEES else 0.0,
                "toleratedDeficitHours": tolerance,
                "maximumAbsent": None,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _employe(identifiant: str, plans: list[dict], cible: int) -> dict:
    return {
        "id": identifiant,
        "name": identifiant.capitalize(),
        "sectorId": "drive",
        "contractHours": 35.0,
        "targetWeeks": cible,
        "linkedEmployeeId": None,
        "seniorityOrder": 1,
        "firstChoiceHistory": 0,
        "plans": plans,
        "unavailableWeekIds": [],
    }


class PlanRank(unittest.TestCase):
    def test_la_taille_de_la_demande_ne_donne_plus_la_priorite(self) -> None:
        """Alice demande trois semaines, Bob deux. Un seul peut partir.

        LE test de cette correction. Alice dispose d'un bon repli (rang 2) ;
        Bob n'en a qu'un mauvais (rang 3). Servir Bob au premier plan et Alice au
        second laisse personne au troisième ; l'inverse y envoie Bob.

        Les trois étages qui comptaient des semaines choisissaient pourtant
        Alice — trois semaines de premier rang valant mieux que deux — et Bob
        repartait sur son troisième vœu. Par personne, la somme des rangs obtenus
        passe de deux à un.
        """
        response = main(
            _payload(
                [
                    _employe(
                        "alice",
                        [
                            {"rank": 1, "weekIds": ["2026-W30", "2026-W31", "2026-W32"]},
                            {"rank": 2, "weekIds": ["2026-W36", "2026-W37", "2026-W38"]},
                        ],
                        cible=3,
                    ),
                    _employe(
                        "bob",
                        [
                            {"rank": 1, "weekIds": ["2026-W30", "2026-W31"]},
                            {"rank": 3, "weekIds": ["2026-W20", "2026-W21"]},
                        ],
                        cible=2,
                    ),
                ]
            )
        )

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertEqual(response["grants"]["bob"], ["2026-W30", "2026-W31"])
        self.assertEqual(
            response["grants"]["alice"], ["2026-W36", "2026-W37", "2026-W38"]
        )
        # Rang 1 pour Bob (coût 0) + rang 2 pour Alice (coût 1).
        self.assertEqual(response["objectiveValues"]["plan_rank"], 1.0)

    def test_le_rang_prime_sur_la_date(self) -> None:
        """Le plan 3 tombe plus tôt que le plan 2 : c'est le plan 2 qu'on prend.

        Le garde-fou de la correction. Le départage final préfère les semaines
        les plus tôt ; sans un étage qui ordonne les rangs AVANT lui, il
        choisirait le troisième vœu simplement parce qu'il arrive en juillet.
        """
        response = main(
            _payload(
                [
                    _employe(
                        "alice",
                        [
                            {"rank": 1, "weekIds": ["2026-W30", "2026-W31"]},
                            {"rank": 2, "weekIds": ["2026-W36", "2026-W37"]},
                            {"rank": 3, "weekIds": ["2026-W22", "2026-W23"]},
                        ],
                        cible=2,
                    ),
                ]
            )
        )
        # Le premier plan tient : rien ne le déloge.
        self.assertEqual(response["grants"]["alice"], ["2026-W30", "2026-W31"])
        self.assertEqual(response["objectiveValues"]["plan_rank"], 0.0)

    def test_le_premier_plan_ne_coute_rien_comme_une_personne_non_servie(self) -> None:
        """`rang - 1`, et pas `rang` : sinon servir coûterait plus que renoncer.

        C'est le piège dans lequel l'étage des plans était tombé avant de compter
        les débordements. Une personne non servie n'utilise aucun plan et coûte
        donc zéro ; si le premier plan coûtait un, le modèle préférerait la
        laisser dehors à qualité de couverture égale.
        """
        response = main(
            _payload(
                [
                    _employe(
                        "alice",
                        [{"rank": 1, "weekIds": ["2026-W36", "2026-W37"]}],
                        cible=2,
                    ),
                ]
            )
        )
        self.assertEqual(response["grants"]["alice"], ["2026-W36", "2026-W37"])
        self.assertEqual(response["objectiveValues"]["plan_rank"], 0.0)


class EmptyStages(unittest.TestCase):
    def test_sans_marge_reglee_letage_du_deficit_ne_tourne_pas(self) -> None:
        """`toleratedDeficitHours: 0` est le défaut de l'application.

        La variable de déficit était créée quand même, bornée `[0, 0]` : cent
        trente variables mortes sur sept cent huit, et un étage lexicographique
        entier qui les optimisait. Vingt-sept secondes au lieu de vingt-deux à
        soixante salariés, pour une réponse rigoureusement identique.

        Plus aucune variable n'est créée, donc `deficit_variables` est vide,
        donc la boucle saute l'objectif — et le rend à zéro, ce qu'il vaut.
        """
        response = main(
            _payload(
                [
                    _employe(
                        "alice", [{"rank": 1, "weekIds": ["2026-W36", "2026-W37"]}], cible=2
                    ),
                ],
                tolerance=0.0,
            )
        )
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["objectiveValues"]["coverage_deficit"], 0.0)

    def test_une_marge_reglee_fait_bien_tourner_letage(self) -> None:
        """Le contre-test : dès qu'une marge existe, le déficit redevient mesuré.

        Deux salariés veulent les mêmes semaines, la couverture n'en autorise
        qu'un, et la marge permet d'en laisser partir un second en consommant du
        déficit toléré. Sans l'étage, ce déficit ne serait pas minimisé.
        """
        response = main(
            _payload(
                [
                    _employe(
                        "alice", [{"rank": 1, "weekIds": list(CONVOITEES)}], cible=2
                    ),
                    _employe("bob", [{"rank": 1, "weekIds": list(CONVOITEES)}], cible=2),
                ],
                tolerance=35.0,
            )
        )
        self.assertEqual(response["status"], "optimal")
        self.assertIn("coverage_deficit", response["objectiveValues"])
        # Les deux partent : le second consomme la marge, qui est donc comptée.
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertGreater(response["objectiveValues"]["coverage_deficit"], 0.0)


if __name__ == "__main__":
    unittest.main()
