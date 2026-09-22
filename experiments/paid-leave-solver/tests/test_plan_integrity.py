"""Un plan de vœux se prend entier, ou pas.

Les trois rangs décrivent la MÊME absence vue autrement — « ces deux semaines de
préférence, sinon ces deux-là ». Le solveur piochait pourtant librement dans leur
union, et deux mécanismes s'y ajoutaient pour rien :

- le contrat était APLATI en `{semaine, meilleur rang}`, ce qui détruit
  l'appartenance d'une semaine figurant dans plusieurs plans ;
- le départage des attributions mélangées vivait tout en bas de la chaîne, sous
  le classement des rangs, qui avait donc déjà tranché en faveur du mélange.

Le résultat se voyait sur un cas trivial : « W28+W29, sinon W32+W33 » rendait
**W28+W33** dès que W29 sautait. Ni l'un ni l'autre des plans, deux semaines
isolées dans deux mois différents, et rien à l'écran pour le dire.

Ce fichier remplace `test_mixed_plans.py`, qui éprouvait la variable `mixed` —
supprimée avec le modèle qu'elle servait. La régression qu'il gardait (un plan
réparti sur les trois rangs rendait le modèle INFAISABLE) est reprise ici sous sa
forme nouvelle : trois plans utilisés doivent rester possibles.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(26, 46)]

PREFERE = {"rank": 1, "weekIds": ["2026-W28", "2026-W29"]}
REPLI = {"rank": 2, "weekIds": ["2026-W32", "2026-W33"]}


def _payload(plans: list[dict], target: int, *, indisponibles: set[str] | None = None) -> dict:
    """Une personne seule, dont seules certaines semaines sont hors d'atteinte.

    Le minimum de couverture vaut la totalité de son contrat sur les semaines
    qu'on veut lui interdire, et zéro partout ailleurs : aucune autre contrainte
    ne pèse, donc ce que le solveur rend ne vient que de la structure des plans.
    """
    bloquees = indisponibles or set()
    return {
        "campaignId": "test-plans",
        "timeoutSeconds": 20,
        "weeks": WEEKS,
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
            },
        ],
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0,
                "minimumHours": 35.0 if week in bloquees else 0.0,
                "toleratedDeficitHours": 0.0,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


class PlanIntegrity(unittest.TestCase):
    def test_le_plan_de_repli_se_prend_entier(self) -> None:
        """W29 saute : c'est W32+W33 qu'on rend, pas W28 recollé à W33.

        LE test de ce fichier. L'ancien modèle gardait W28 parce que le
        classement des rangs comptait les SEMAINES de premier rang et passait
        avant tout départage du mélange. Une semaine de son plan préféré
        l'emportait donc sur son plan de repli pris en entier — c'est-à-dire sur
        ce qu'elle avait écrit.
        """
        response = main(_payload([PREFERE, REPLI], target=2, indisponibles={"2026-W29"}))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["alice"], ["2026-W32", "2026-W33"])
        self.assertEqual(response["objectiveValues"]["plans_used"], 1.0)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)

    def test_le_plan_prefere_l_emporte_quand_il_tient(self) -> None:
        """Rien ne bloque : on prend le premier rang, évidemment."""
        response = main(_payload([PREFERE, REPLI], target=2))
        self.assertEqual(response["grants"]["alice"], ["2026-W28", "2026-W29"])
        # Le premier plan ne coûte rien : la somme des rangs obtenus vaut zéro.
        self.assertEqual(response["objectiveValues"]["plan_rank"], 0.0)
        self.assertEqual(response["objectiveValues"]["plans_used"], 1.0)

    def test_une_semaine_partagee_appartient_AUX_DEUX_plans(self) -> None:
        """W28 figure dans les deux plans : la retenir ne mélange rien.

        C'est ce que le contrat aplati ne pouvait pas dire. W28 n'y portait que
        son meilleur rang — 1 — et accorder le plan 2 en entier se comptabilisait
        donc comme un emprunt à deux plans. Une seule attribution par semaine,
        mais deux appartenances.
        """
        response = main(
            _payload(
                [PREFERE, {"rank": 2, "weekIds": ["2026-W28", "2026-W33"]}],
                target=2,
                indisponibles={"2026-W29"},
            )
        )
        self.assertEqual(response["grants"]["alice"], ["2026-W28", "2026-W33"])
        self.assertEqual(response["objectiveValues"]["plans_used"], 1.0)

    def test_le_melange_reste_permis_quand_aucun_plan_ne_tient(self) -> None:
        """Un départage, jamais une interdiction.

        Si aucun plan ne passe entier, mieux vaut un mélange annoncé que
        quelqu'un renvoyé les mains vides. C'est la même règle que pour l'écart :
        on ne réintroduit pas de refus tout-ou-rien.
        """
        response = main(
            _payload([PREFERE, REPLI], target=2, indisponibles={"2026-W29", "2026-W33"})
        )
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["alice"], ["2026-W28", "2026-W32"])
        self.assertEqual(response["objectiveValues"]["plans_used"], 2.0)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)

    def test_trois_plans_a_la_fois_restent_possibles(self) -> None:
        """La régression que gardait `test_mixed_plans`, sous sa forme nouvelle.

        L'ancienne variable `mixed` était plafonnée à 1 alors que sa contrainte
        pouvait exiger 2 : toute attribution touchant les trois rangs rendait le
        modèle INFAISABLE, et le refus accusait des minimums de couverture qui
        valaient zéro. Rien ne doit reproduire cela — ici les trois plans sont
        nécessaires, et ils coûtent trois, pas l'échec.
        """
        response = main(
            _payload(
                [
                    {"rank": 1, "weekIds": ["2026-W28"]},
                    {"rank": 2, "weekIds": ["2026-W32"]},
                    {"rank": 3, "weekIds": ["2026-W36"]},
                ],
                target=3,
            )
        )
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(
            response["grants"]["alice"], ["2026-W28", "2026-W32", "2026-W36"]
        )
        self.assertEqual(response["objectiveValues"]["plans_used"], 3.0)

    def test_un_plan_inutilise_ne_compte_pas(self) -> None:
        """Trois plans proposés, un seul retenu : le compte dit un.

        `plan_used` n'est poussé vers le haut que par les semaines accordées.
        Un plan que personne ne touche reste à zéro, sans quoi le départage
        pénaliserait le simple fait d'avoir rempli ses trois rangs.
        """
        response = main(
            _payload(
                [
                    PREFERE,
                    REPLI,
                    {"rank": 3, "weekIds": ["2026-W40", "2026-W41"]},
                ],
                target=2,
            )
        )
        self.assertEqual(response["objectiveValues"]["plans_used"], 1.0)


if __name__ == "__main__":
    unittest.main()
