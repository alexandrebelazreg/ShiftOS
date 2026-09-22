"""Le congé simultané des conjoints : un droit, pas un décompte.

L'article L3141-14 donne aux conjoints d'une même entreprise un DROIT au congé
simultané. Un droit se tient ou ne se tient pas ; il ne se mesure pas en
semaines. L'étage comptait pourtant `Σ semaines communes`, si bien qu'un couple
voulant quatre semaines ensemble pesait quatre fois deux couples n'en voulant
qu'une — le troisième cas du même défaut, après l'équité et les vœux.

Le critère est désormais par COUPLE : réuni quand il a obtenu ensemble au moins
autant de semaines que le plus court des deux congés DEMANDÉS. Demandés, et non
obtenus : une cible lue sur le résultat se vérifie elle-même, et deux personnes
repartant les mains vides seraient « réunies ».
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(26, 50)]
PARTAGEES = ("2026-W30", "2026-W31")


def _membre(
    identifiant: str,
    partenaire: str,
    *,
    cible: int,
    ensemble: list[str],
    repli: list[str],
    anciennete: int,
) -> dict:
    return {
        "id": identifiant,
        "name": identifiant,
        "sectorId": "drive",
        "contractHours": 35.0,
        "targetWeeks": cible,
        "linkedEmployeeId": partenaire,
        "seniorityOrder": anciennete,
        "firstChoiceHistory": 0,
        "unavailableWeekIds": [],
        "plans": [
            {"rank": 1, "weekIds": ensemble},
            {"rank": 2, "weekIds": repli},
        ],
    }


def _payload(employes: list[dict], *, places: int | None = 2) -> dict:
    """Un rayon, et un nombre de places limité sur les deux semaines convoitées."""
    return {
        "campaignId": "test-couples",
        "timeoutSeconds": 30,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employes,
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0 * len(employes),
                "minimumHours": 0.0,
                "toleratedDeficitHours": 0.0,
                "maximumAbsent": places if week in PARTAGEES else None,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _reuni(response: dict, gauche: str, droite: str, cible: int) -> bool:
    partage = set(response["grants"][gauche]) & set(response["grants"][droite])
    return len(partage) >= cible


class Couples(unittest.TestCase):
    def test_deux_couples_reunis_valent_mieux_qu_un_seul_plus_long(self) -> None:
        """Le couple A veut deux semaines ensemble ; B et C en veulent une.

        LE test de cette correction. Deux places par semaine : soit A part, soit
        B et C partent. Le nombre de semaines communes est le MÊME dans les deux
        cas — deux — parce que chaque place libérée en produit exactement une.
        Le décompte par semaines était donc muet, et l'ancienneté tranchait en
        faveur de A, le couple le plus ancien.

        Par couple, la réponse change : deux droits tenus valent mieux qu'un.
        """
        response = main(
            _payload(
                [
                    _membre("a1", "a2", cible=2, ensemble=list(PARTAGEES),
                            repli=["2026-W40", "2026-W41"], anciennete=6),
                    _membre("a2", "a1", cible=2, ensemble=list(PARTAGEES),
                            repli=["2026-W42", "2026-W43"], anciennete=5),
                    _membre("b1", "b2", cible=1, ensemble=["2026-W30"],
                            repli=["2026-W44"], anciennete=4),
                    _membre("b2", "b1", cible=1, ensemble=["2026-W30"],
                            repli=["2026-W45"], anciennete=3),
                    _membre("c1", "c2", cible=1, ensemble=["2026-W31"],
                            repli=["2026-W46"], anciennete=2),
                    _membre("c2", "c1", cible=1, ensemble=["2026-W31"],
                            repli=["2026-W47"], anciennete=1),
                ]
            )
        )

        self.assertEqual(response["status"], "optimal")
        # Personne ne repart les mains vides : chacun a un repli.
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        # La RÉPARTITION d'abord : c'est elle qui change, la clé ne fait que la
        # rapporter. Un test qui n'éprouverait que la clé passerait sur un
        # modèle qui la rend sans rien décider.
        self.assertTrue(_reuni(response, "b1", "b2", 1))
        self.assertTrue(_reuni(response, "c1", "c2", 1))
        self.assertFalse(_reuni(response, "a1", "a2", 2))
        # Le décompte par semaines, lui, ne départageait rien : deux des deux côtés.
        self.assertEqual(response["objectiveValues"]["priority_common_weeks"], 2.0)
        self.assertEqual(response["objectiveValues"]["priority_couples_reunited"], 2.0)

    def test_l_anciennete_departage_a_nombre_de_couples_egal(self) -> None:
        """Une seule place : c'est le couple le plus ancien qui l'obtient.

        Le second critère n'a pas disparu, il a changé d'unité. Un seul couple
        peut être réuni ici ; l'ancienneté dit lequel, comme avant.
        """
        response = main(
            _payload(
                [
                    _membre("a1", "a2", cible=1, ensemble=["2026-W30"],
                            repli=["2026-W40"], anciennete=9),
                    _membre("a2", "a1", cible=1, ensemble=["2026-W30"],
                            repli=["2026-W41"], anciennete=8),
                    _membre("b1", "b2", cible=1, ensemble=["2026-W30"],
                            repli=["2026-W44"], anciennete=2),
                    _membre("b2", "b1", cible=1, ensemble=["2026-W30"],
                            repli=["2026-W45"], anciennete=1),
                ]
            )
        )

        self.assertTrue(_reuni(response, "a1", "a2", 1))
        self.assertFalse(_reuni(response, "b1", "b2", 1))
        self.assertEqual(response["objectiveValues"]["priority_couples_reunited"], 1.0)

    def test_le_chevauchement_partiel_departage_en_dernier(self) -> None:
        """Quand aucun droit ne tient, une semaine ensemble vaut mieux que zéro.

        Le décompte par semaines n'est pas supprimé, il est DESCENDU d'un cran.
        Sans lui, un couple qu'on ne peut pas réunir entièrement se verrait
        éparpillé sans raison, puisque rien ne distinguerait plus une semaine
        commune de zéro.
        """
        response = main(
            _payload(
                [
                    _membre("a1", "a2", cible=2, ensemble=list(PARTAGEES),
                            repli=["2026-W40", "2026-W41"], anciennete=2),
                    _membre("a2", "a1", cible=2, ensemble=list(PARTAGEES),
                            repli=["2026-W40", "2026-W41"], anciennete=1),
                ],
                # Une seule place : le couple ne peut jamais tenir ses deux
                # semaines ensemble sur les semaines convoitées.
                places=1,
            )
        )

        self.assertEqual(response["status"], "optimal")
        # Le repli est partagé, donc le droit tient finalement par là.
        self.assertTrue(_reuni(response, "a1", "a2", 2))

    def test_sans_partenaire_aucun_droit_a_tenir(self) -> None:
        """Une personne seule ne pèse sur aucun des trois critères."""
        response = main(
            _payload(
                [
                    {
                        "id": "seule",
                        "name": "Seule",
                        "sectorId": "drive",
                        "contractHours": 35.0,
                        "targetWeeks": 1,
                        "linkedEmployeeId": None,
                        "seniorityOrder": 1,
                        "firstChoiceHistory": 0,
                        "unavailableWeekIds": [],
                        "plans": [{"rank": 1, "weekIds": ["2026-W30"]}],
                    }
                ]
            )
        )

        self.assertEqual(response["grants"]["seule"], ["2026-W30"])
        self.assertEqual(response["objectiveValues"]["priority_couples_reunited"], 0.0)
        self.assertEqual(response["objectiveValues"]["priority_common_weeks"], 0.0)


if __name__ == "__main__":
    unittest.main()
