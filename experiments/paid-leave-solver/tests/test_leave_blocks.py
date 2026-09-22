"""La forme des congés, et pas seulement leur nombre.

Le modèle jugeait « W29 puis W31 » strictement équivalent à « W28 puis W29 » :
mêmes rangs de vœux, même couverture, même coût. Deux semaines isolées séparées
d'une semaine de travail, ce ne sont pourtant pas des vacances — et c'est ce que
la loi regarde aussi, l'article L3141-18 exigeant douze jours ouvrables
consécutifs dès que le congé principal dépasse douze jours.

Le cas qui compte n'est pas celui d'une personne seule : un plan de vœux est
déjà une suite de semaines, et l'accorder en entier ne pose aucune question.
C'est la CONCURRENCE qui ouvre le choix — deux personnes sur les mêmes semaines,
une seule place à la fois — et c'est exactement ce qu'est une campagne d'été.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(26, 36)]
CONTESTED = ["2026-W28", "2026-W29", "2026-W30", "2026-W31"]


def _blocks(weeks: list[str], order: list[str] | None = None) -> int:
    """Le nombre de morceaux d'une attribution, recompté indépendamment."""
    reference = order or WEEKS
    positions = sorted(reference.index(week) for week in weeks)
    return sum(
        1
        for rank, position in enumerate(positions)
        if rank == 0 or positions[rank - 1] != position - 1
    )


def _solo(plan_weeks: list[str], target: int, *, weeks: list[str] | None = None,
          plans: list[dict] | None = None) -> dict:
    """Une personne, aucune concurrence, aucune contrainte de couverture."""
    calendar = weeks or WEEKS
    return {
        "campaignId": "test-blocs",
        "timeoutSeconds": 20,
        "weeks": calendar,
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
                "plans": plans or [{"rank": 1, "weekIds": plan_weeks}],
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
            for week in calendar
        ],
        "reinforcementPools": [],
    }


class LeaveBlocks(unittest.TestCase):
    def test_deux_semaines_daffilee_plutot_que_deux_semaines_isolees(self) -> None:
        """Alice et Bob veulent les mêmes quatre semaines, un seul part à la fois.

        Chacun en obtiendra deux — le total, les rangs et la couverture sont
        identiques dans tous les cas. Reste à savoir LESQUELLES. Sans ce critère,
        le solveur rendait « W29 et W31 » à l'un et « W28 et W30 » à l'autre :
        quatre semaines de congés qui ne font vacances pour personne.
        """
        payload = {
            "campaignId": "test-concurrence",
            "timeoutSeconds": 20,
            "weeks": WEEKS,
            "sectors": [{"id": "drive", "name": "Drive"}],
            "employees": [
                {
                    "id": name,
                    "name": name.capitalize(),
                    "sectorId": "drive",
                    "contractHours": 35.0,
                    "targetWeeks": 4,
                    "linkedEmployeeId": None,
                    "seniorityOrder": seniority,
                    "firstChoiceHistory": 0,
                    "plans": [{"rank": 1, "weekIds": list(CONTESTED)}],
                }
                for seniority, name in ((2, "alice"), (1, "bob"))
            ],
            # Base 70 h pour deux salariés, minimum 35 h sur les semaines
            # convoitées : un seul absent à la fois, donc deux semaines chacun.
            "coverage": [
                {
                    "sectorId": "drive",
                    "weekId": week,
                    "baseContractHours": 70.0,
                    "minimumHours": 35.0 if week in CONTESTED else 0.0,
                    "toleratedDeficitHours": 0.0,
                }
                for week in WEEKS
            ],
            "reinforcementPools": [],
        }

        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        for weeks in response["grants"].values():
            self.assertEqual(len(weeks), 2)
            self.assertEqual(_blocks(weeks), 1)
        self.assertEqual(response["objectiveValues"]["leave_blocks"], 2.0)
        self.assertEqual(response["objectiveValues"]["worst_leave_blocks"], 1.0)

    def test_un_voeu_deliberement_coupe_est_respecte(self) -> None:
        """Une semaine en mai et deux en septembre : personne ne les recolle.

        Le critère est un départage, jamais une contrainte. Quelqu'un qui demande
        deux absences distinctes les obtient, et le nombre de morceaux qu'on
        annonce est alors celui qu'il a voulu.
        """
        response = main(
            _solo(
                ["2026-W26", "2026-W34", "2026-W35"],
                target=3,
            )
        )
        self.assertEqual(
            response["grants"]["alice"], ["2026-W26", "2026-W34", "2026-W35"]
        )
        self.assertEqual(response["objectiveValues"]["leave_blocks"], 2.0)

    def test_le_plan_prime_sur_la_contiguite(self) -> None:
        """Deux morceaux dans un seul plan valent mieux qu'un bloc à cheval.

        Le premier plan demande W28 et W34, donc deux morceaux. Recoller W28 à
        W29 ferait un bloc — mais W29 appartient à un autre plan, et emprunter à
        deux plans se paie au quatrième étage quand la contiguïté n'est jugée
        qu'au dixième. Elle départage ce que les plans ont laissé ouvert, et ne
        reprend rien à ce qu'ils ont décidé.
        """
        response = main(
            _solo(
                [],
                target=2,
                plans=[
                    {"rank": 1, "weekIds": ["2026-W28", "2026-W34"]},
                    {"rank": 3, "weekIds": ["2026-W29"]},
                ],
            )
        )
        self.assertEqual(response["grants"]["alice"], ["2026-W28", "2026-W34"])
        self.assertEqual(response["objectiveValues"]["leave_blocks"], 2.0)

    def test_le_passage_d_annee_compte_comme_une_adjacence(self) -> None:
        """S52 et S01 se suivent dans une campagne d'hiver.

        L'adjacence se lit sur la POSITION dans les semaines de la campagne, et
        jamais sur le numéro ISO : « 1 moins 1 » ne mène nulle part, et une
        campagne d'hiver passe précisément par là.
        """
        hiver = [f"2026-W{n:02d}" for n in range(50, 53)] + [
            f"2027-W{n:02d}" for n in range(1, 4)
        ]
        response = main(
            _solo(
                ["2026-W52", "2027-W01", "2027-W03"],
                target=2,
                weeks=hiver,
            )
        )
        self.assertEqual(response["grants"]["alice"], ["2026-W52", "2027-W01"])
        self.assertEqual(response["objectiveValues"]["leave_blocks"], 1.0)

    def test_les_blocs_annonces_sont_ceux_qui_sont_accordes(self) -> None:
        """Le nombre rendu se recompte sur les semaines, et tombe juste.

        Les variables de début de morceau sont CONTINUES — leur intégralité
        découle de celle des attributions, elle n'est pas déclarée. Ce test est
        le garde qui vérifie que la valeur annoncée reste un entier exact et non
        un résidu de virgule flottante.
        """
        response = main(
            _solo(
                ["2026-W27", "2026-W28", "2026-W31", "2026-W34"],
                target=4,
            )
        )
        granted = response["grants"]["alice"]
        self.assertEqual(
            response["objectiveValues"]["leave_blocks"], float(_blocks(granted))
        )
        self.assertEqual(response["objectiveValues"]["leave_blocks"], 3.0)


if __name__ == "__main__":
    unittest.main()
