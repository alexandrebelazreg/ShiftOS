"""Market-zone (multi-counter) properties of the fast pipeline.

Every test here also asserts, directly or through a mono-sector twin, that the
behaviour it pins is INACTIVE when the problem has a single counter. That is the
standing constraint on this engine: the Drive's production must not move.
"""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from shiftos_highs.demand import build_day_demand, build_demand_model
from shiftos_highs.evaluate import evaluate
from shiftos_highs_fast.allocation import Allocation, build_allocation_model
from shiftos_highs_fast.pipeline import placement_cap_for
from shiftos_highs_fast.skeleton import generate_skeletons

ROOT = Path(__file__).resolve().parents[1]


def _drive() -> dict:
    return json.loads(
        (ROOT / "fixtures/drive-canonical-problem.json").read_text(encoding="utf-8")
    )


def _zone(counters: int = 3, required: int = 1) -> dict:
    """A minimal market zone: N counters, 2N employees, one day, 09:00–17:00."""
    date = "2026-07-20"
    sector_ids = [f"c{index}" for index in range(counters)]
    employees = []
    employee_days = []
    for index, sector_id in enumerate(sector_ids):
        neighbour = sector_ids[(index + 1) % counters]
        for number in (1, 2):
            employee_id = f"{sector_id}-{number}"
            employees.append({
                "id": employee_id, "firstName": employee_id, "lastName": "",
                "contractMinutes": 240, "workingDays": ["monday"], "fixedRestDays": [],
                "minimumDailyMinutes": 240, "maximumDailyMinutes": 480,
                "canOpen": True, "canClose": True, "canSplitShift": False,
                "maximumOpenings": None, "maximumClosings": None,
                "prefersOpening": False, "prefersClosing": False,
                "allowedSectorIds": [sector_id, neighbour],
            })
            employee_days.append({
                "employeeId": employee_id, "date": date, "available": True,
                "mandatory": True, "fixedRest": False,
                "earliestStartMinutes": 540, "latestEndMinutes": 1020,
                "maximumMinutes": 480,
            })
    return {
        "version": "v3.0.0", "planningId": "zone", "sectorId": sector_ids[0],
        "sectors": [
            {
                "id": sector_id, "name": sector_id,
                "days": [{
                    "date": date, "closed": False, "opensAtMinutes": 540,
                    "closesAtMinutes": 1020, "minimumOpenings": 1, "exactClosings": 1,
                }],
            }
            for sector_id in sector_ids
        ],
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": employees,
        "days": [{
            "date": date, "weekDay": "monday", "weekKey": "2026-W30", "closed": False,
            "opensAtMinutes": 540, "closesAtMinutes": 1020,
            "budgetMinutes": 240 * 2 * counters,
        }],
        "employeeDays": employee_days,
        "demandSlots": [
            {
                "id": f"{sector_id}-slot", "sectorId": sector_id, "date": date,
                "startMinutes": 540, "endMinutes": 1020,
                "requiredEmployees": required, "maximumEmployees": None,
            }
            for sector_id in sector_ids
        ],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 480,
            "minimumRestMinutes": 720, "maximumConsecutiveWorkedDays": 7,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumSplitMinutes": None, "maximumContinuousMinutes": 480,
            "maximumSplitsPerDay": None, "minimumOpeningsPerDay": 0,
            "exactClosingsPerDay": 0, "closingFairness": None,
        },
        "objectives": [],
    }


def _reinforcement_or_a_dark_counter() -> dict:
    """Deux comptoirs, deux personnes : A en réclame trois, B une seule.

    L'arbitrage est le seul qui compte dans une zone marché. Mettre les deux sur
    A, c'est laisser B sans personne pour servir un comptoir qui en réclamait
    trois de toute façon ; en mettre une sur chaque, c'est tenir les deux. Un
    coût linéaire ne les sépare pas — il compte deux personnes manquantes dans
    les deux cas — et laisse le solveur trancher au hasard de ses départages.
    """
    date = "2026-07-20"
    employees = [
        {
            "id": identifier, "firstName": identifier, "lastName": "",
            "contractMinutes": 240, "workingDays": ["monday"], "fixedRestDays": [],
            "minimumDailyMinutes": 240, "maximumDailyMinutes": 480,
            "canOpen": True, "canClose": True, "canSplitShift": False,
            "maximumOpenings": None, "maximumClosings": None,
            "prefersOpening": False, "prefersClosing": False,
            "allowedSectorIds": ["a", "b"],
        }
        for identifier in ("un", "deux")
    ]
    return {
        "version": "v3.0.0", "planningId": "renfort", "sectorId": "a",
        "sectors": [
            {
                "id": sector_id, "name": sector_id,
                "days": [{
                    "date": date, "closed": False, "opensAtMinutes": 540,
                    "closesAtMinutes": 780, "minimumOpenings": 1, "exactClosings": 1,
                }],
            }
            for sector_id in ("a", "b")
        ],
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": employees,
        "days": [{
            "date": date, "weekDay": "monday", "weekKey": "2026-W30", "closed": False,
            "opensAtMinutes": 540, "closesAtMinutes": 780, "budgetMinutes": 480,
        }],
        "employeeDays": [
            {
                "employeeId": employee["id"], "date": date, "available": True,
                "mandatory": True, "fixedRest": False,
                "earliestStartMinutes": 540, "latestEndMinutes": 780,
                "maximumMinutes": 480,
            }
            for employee in employees
        ],
        "demandSlots": [
            {
                "id": "a-slot", "sectorId": "a", "date": date,
                "startMinutes": 540, "endMinutes": 780,
                "requiredEmployees": 3, "maximumEmployees": None,
            },
            {
                "id": "b-slot", "sectorId": "b", "date": date,
                "startMinutes": 540, "endMinutes": 780,
                "requiredEmployees": 1, "maximumEmployees": None,
            },
        ],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 480,
            "minimumRestMinutes": 720, "maximumConsecutiveWorkedDays": 7,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumSplitMinutes": None, "maximumContinuousMinutes": 480,
            "maximumSplitsPerDay": None, "minimumOpeningsPerDay": 0,
            "exactClosingsPerDay": 0, "closingFairness": None,
        },
        "objectives": [],
    }


class ShortOfHandsAZoneNeverGoesDarkFirstTests(unittest.TestCase):
    """Un comptoir désert ne se paie pas au prix d'un renfort manquant."""

    def test_the_reinforcement_is_dropped_before_a_counter_is_left_empty(self) -> None:
        from shiftos_highs_fast.pipeline import solve_fast

        problem = _reinforcement_or_a_dark_counter()
        answer = solve_fast(problem, time_limit_seconds=30.0)
        self.assertIsNotNone(answer["solution"], answer["diagnostics"])

        present: dict[str, int] = {"a": 0, "b": 0}
        for assignment in answer["solution"]["assignments"]:
            for block in assignment["sectorAssignments"]:
                present[str(block["sectorId"])] += (
                    int(block["endMinutes"]) - int(block["startMinutes"])
                )
        # Les deux comptoirs sont tenus. Servir A en double et laisser B vide
        # coûte le même déficit à un modèle linéaire, et c'est cette égalité-là
        # qui est fausse.
        self.assertGreater(present["b"], 0, present)
        self.assertGreater(present["a"], 0, present)

    def test_a_zone_counts_its_deficit_exactly_as_the_evaluator_does(self) -> None:
        """Le placement et l'évaluateur comptent enfin la même chose.

        Le placement minimisait le déficit contre la cible ADAPTÉE pendant que
        la recherche classait ses candidats contre la demande de RÉFÉRENCE. Deux
        mesures, donc un optimum qui n'était pas celui qu'on retenait.

        L'égalité vaut tant que les tranches de demande d'un même comptoir ne se
        chevauchent pas — la forme que produit le constructeur. Le placement lit
        une cellule atomique une fois, `evaluate` la relit pour chaque tranche
        qui la contient, et deux tranches superposées la compteraient deux fois.
        """
        from shiftos_highs_fast.pipeline import solve_fast

        problem = _zone(counters=3, required=2)
        answer = solve_fast(problem, time_limit_seconds=30.0)
        self.assertIsNotNone(answer["solution"], answer["diagnostics"])
        diagnostics = answer["diagnostics"]
        self.assertEqual(
            diagnostics["adaptedTargetDeficitMinutes"],
            diagnostics["referenceDeficitMinutes"],
        )

    def test_mono_sector_still_rescales_its_target_and_carries_no_counters(self) -> None:
        """Et le mono, lui, n'a pas bougé.

        Sa cible adaptée existe précisément pour ne pas lui reprocher un déficit
        que personne ne pouvait éviter, et rien de ce qui précède ne la touche :
        le nouveau régime se lit sur `sectors`, que le Drive n'a pas.

        Ce test épingle l'entrée du chemin, pas sa production — celle-ci se
        mesure avec `baseline_probe.py`, dont le diff est la seule preuve que
        les fixtures de référence n'ont pas bougé.
        """
        from shiftos_highs.demand import build_demand_model

        problem = _drive()
        self.assertIsNone(problem.get("sectors"))
        demand = build_demand_model(problem)
        day = demand.days[problem["days"][0]["date"]]
        self.assertEqual(day.sector_intervals, ())
        self.assertLessEqual(
            day.total_adapted_minutes,
            sum(interval.reference_required for interval in day.intervals) * day.step,
        )


class DemandIsCountedPerCounterTests(unittest.TestCase):
    """The correction at the root of the market zone: counters are not merged."""

    def test_three_counters_asking_for_one_each_ask_for_three(self) -> None:
        day = build_day_demand(_zone(counters=3), "2026-07-20")
        self.assertEqual([interval.reference_required for interval in day.intervals][0], 3)
        self.assertEqual([interval.adapted_target for interval in day.intervals][0], 3)
        # 3 counters × 8 h × 1 person. Read with the maximum this was 480.
        self.assertEqual(day.total_adapted_minutes, 3 * 480)

    def test_the_per_counter_view_keeps_each_counter_separate(self) -> None:
        day = build_day_demand(_zone(counters=3), "2026-07-20")
        opening = [cell for cell in day.sector_intervals if cell.start == 540]
        self.assertEqual(
            sorted((cell.sector_id, cell.adapted_target) for cell in opening),
            [("c0", 1), ("c1", 1), ("c2", 1)],
        )

    def test_hard_floors_of_every_counter_are_summed_for_the_feasibility_proof(
        self,
    ) -> None:
        # Two counters each demanding two people all day, against a team that
        # can only work half of it. Summed, the floors exceed capacity and the
        # day is genuinely impossible; read with the maximum, half the demand
        # disappeared and the engine spent its whole budget discovering nothing.
        problem = _zone(counters=2)
        for slot in problem["demandSlots"]:
            slot["hardMinimumEmployees"] = 2
            slot["requiredEmployees"] = 2
        day = build_day_demand(problem, "2026-07-20")
        self.assertEqual(day.total_hard_minutes, 2 * 2 * 480)
        self.assertTrue(day.structurally_infeasible)
        self.assertEqual(day.infeasible_reason, "hard-floor-exceeds-available-minutes")

    def test_a_mono_sector_day_is_untouched_and_carries_no_per_counter_view(self) -> None:
        model = build_demand_model(_drive())
        for date, day in model.days.items():
            self.assertEqual(day.sector_intervals, (), date)
        # The Drive's adapted profile, pinned. A change here is a change to the
        # mono-sector engine's production.
        self.assertEqual(
            {date: day.total_adapted_minutes for date, day in sorted(model.days.items())},
            {
                "2026-07-20": 1260, "2026-07-21": 1260, "2026-07-22": 1260,
                "2026-07-23": 1260, "2026-07-24": 1380, "2026-07-25": 1200,
            },
        )


class NoGlobalRolesInAMarketZoneTests(unittest.TestCase):
    """A day-wide opener is meaningless when counters keep their own hours."""

    def test_the_complement_path_refuses_to_invent_day_wide_roles(self) -> None:
        problem = _zone(counters=3)
        model = build_allocation_model(problem)
        demand = build_demand_model(problem)
        allocation = Allocation(
            minutes=tuple(
                tuple(0 if cell is None else cell.minimum for cell in row)
                for row in model.cells
            ),
            origin="probe",
        )
        skeletons = generate_skeletons(problem, model, allocation, demand, keep=8)
        self.assertEqual(len(skeletons), 1)
        self.assertEqual(skeletons[0].roles, ())
        self.assertEqual(skeletons[0].family, "sector-placement")

    def test_mono_sector_still_gets_several_ranked_skeletons(self) -> None:
        problem = _drive()
        model = build_allocation_model(problem)
        demand = build_demand_model(problem)
        allocation = Allocation(
            minutes=tuple(
                tuple(0 if cell is None else cell.minimum for cell in row)
                for row in model.cells
            ),
            origin="probe",
        )
        skeletons = generate_skeletons(problem, model, allocation, demand, keep=8)
        self.assertGreater(len(skeletons), 1)
        self.assertTrue(any(skeleton.roles for skeleton in skeletons))


class ClosingCountIsAMinimumEverywhereTests(unittest.TestCase):
    """One rule, one reading — the MILP's, the validator's and this one's."""

    def test_a_surplus_closer_is_not_a_violation(self) -> None:
        problem = _zone(counters=2)
        date = "2026-07-20"
        # Both c0 employees end at closing on c0: one more closer than the
        # counter requires. The placement MILP can build this (it imposes `≥`)
        # and the TypeScript validator accepts it.
        assignments = [
            {
                "employeeId": f"c0-{number}", "date": date,
                "segments": [{"startMinutes": 540, "endMinutes": 1020}],
                "sectorAssignments": [
                    {"sectorId": "c0", "startMinutes": 540, "endMinutes": 1020}
                ],
            }
            for number in (1, 2)
        ] + [
            {
                "employeeId": f"c1-{number}", "date": date,
                "segments": [{"startMinutes": 540, "endMinutes": 1020}],
                "sectorAssignments": [
                    {"sectorId": "c1", "startMinutes": 540, "endMinutes": 1020}
                ],
            }
            for number in (1, 2)
        ]
        report = evaluate(problem, assignments)
        self.assertNotIn(
            "closing-count",
            " ".join(report["violations"]),
            report["violations"],
        )

    def test_a_counter_left_without_a_closer_still_is(self) -> None:
        problem = _zone(counters=2)
        # Sans demande, le rôle est la seule chose qui exige la fermeture.
        problem["demandSlots"] = []
        date = "2026-07-20"
        assignments = [
            {
                "employeeId": f"c{index}-{number}", "date": date,
                "segments": [{"startMinutes": 540, "endMinutes": 900}],
                "sectorAssignments": [
                    {"sectorId": f"c{index}", "startMinutes": 540, "endMinutes": 900}
                ],
            }
            for index in (0, 1)
            for number in (1, 2)
        ]
        report = evaluate(problem, assignments)
        self.assertIn("closing-count", " ".join(report["violations"]))


class PlacementBudgetTests(unittest.TestCase):
    """The cap that decided a whole market zone in eight seconds."""

    def test_mono_sector_keeps_its_fixed_cap_whatever_is_left(self) -> None:
        for remaining in (5.0, 55.0):
            for alternative in (True, False):
                self.assertEqual(
                    placement_cap_for(
                        8.0,
                        remaining,
                        multi_sector=False,
                        has_answer=False,
                        has_alternative_allocation=alternative,
                    ),
                    8.0,
                )

    def test_a_zone_with_no_answer_gets_most_of_the_budget_but_never_all_of_it(
        self,
    ) -> None:
        """Une part, jamais le reste.

        Ce plafond rendait tout sauf trois secondes, et ces trois secondes-là
        devaient financer la seconde tentative ET son filet de faisabilité. Sur
        un modèle de cinquante mille colonnes la seule construction en prend
        dix : le filet ne s'est donc jamais déployé, et une zone sans horaire
        rendait « rien » alors qu'un planning légal était à portée.
        """
        self.assertEqual(
            placement_cap_for(
                8.0, 55.0,
                multi_sector=True, has_answer=False, has_alternative_allocation=False,
            ),
            44.0,
        )

    def test_a_zone_with_alternatives_keeps_half_the_budget_for_them(self) -> None:
        self.assertEqual(
            placement_cap_for(
                8.0, 55.0,
                multi_sector=True, has_answer=False, has_alternative_allocation=True,
            ),
            27.5,
        )

    def test_once_a_schedule_exists_the_short_repair_caps_come_back(self) -> None:
        self.assertEqual(
            placement_cap_for(
                2.0, 55.0,
                multi_sector=True, has_answer=True, has_alternative_allocation=False,
            ),
            2.0,
        )

    def test_the_cap_never_falls_below_the_default(self) -> None:
        self.assertEqual(
            placement_cap_for(
                8.0, 4.0,
                multi_sector=True, has_answer=False, has_alternative_allocation=False,
            ),
            8.0,
        )


class ElasticClosingTests(unittest.TestCase):
    """Un rayon peut s'attarder, jamais fermer plus tôt."""

    def _day(self, latest: int | None) -> dict:
        problem = _zone(counters=1)
        for sector in problem["sectors"]:
            for day in sector["days"]:
                if latest is not None:
                    day["latestCloseMinutes"] = latest
        # Les salariés doivent pouvoir rester : la tolérance du rayon ne sert à
        # rien si leur propre fenêtre s'arrête à l'heure nominale.
        for entry in problem["employeeDays"]:
            entry["latestEndMinutes"] = max(entry["latestEndMinutes"], latest or 0)
        return problem

    def test_finishing_within_the_tolerance_counts_as_closing(self) -> None:
        problem = self._day(latest=1065)  # 17:45, soit 45 min après 17:00
        date = "2026-07-20"
        assignments = [{
            "employeeId": "c0-1", "date": date,
            "segments": [{"startMinutes": 540, "endMinutes": 1065}],
            "sectorAssignments": [{"sectorId": "c0", "startMinutes": 540, "endMinutes": 1065}],
        }, {
            "employeeId": "c0-2", "date": date,
            "segments": [{"startMinutes": 540, "endMinutes": 900}],
            "sectorAssignments": [{"sectorId": "c0", "startMinutes": 540, "endMinutes": 900}],
        }]
        report = evaluate(problem, assignments)
        self.assertNotIn("closing-count", " ".join(report["violations"]), report["violations"])

    def test_finishing_before_the_nominal_closing_is_still_a_breach(self) -> None:
        problem = self._day(latest=1065)
        problem["demandSlots"] = []
        date = "2026-07-20"
        assignments = [{
            "employeeId": employee_id, "date": date,
            "segments": [{"startMinutes": 540, "endMinutes": 960}],
            "sectorAssignments": [{"sectorId": "c0", "startMinutes": 540, "endMinutes": 960}],
        } for employee_id in ("c0-1", "c0-2")]
        report = evaluate(problem, assignments)
        self.assertIn("closing-count", " ".join(report["violations"]))

    def test_without_the_field_the_counter_closes_on_the_dot(self) -> None:
        """Aucune tolérance n'est INVENTÉE pour un problème qui n'en déclare pas."""
        from shiftos_highs_fast.shifts import latest_close

        problem = self._day(latest=None)
        sector_day = problem["sectors"][0]["days"][0]
        sector_day.pop("latestCloseMinutes", None)
        self.assertEqual(latest_close(sector_day), sector_day["closesAtMinutes"])

    def test_the_tolerance_widens_the_shift_space(self) -> None:
        from shiftos_highs.demand import build_demand_model
        from shiftos_highs_fast.allocation import Allocation, build_allocation_model
        from shiftos_highs_fast.shifts import generate_shifts
        from shiftos_highs_fast.skeleton import generate_skeletons_from_capacity

        def count(latest: int | None) -> int:
            problem = self._day(latest=latest)
            if latest is None:
                for sector in problem["sectors"]:
                    for day in sector["days"]:
                        day.pop("latestCloseMinutes", None)
            model = build_allocation_model(problem)
            demand = build_demand_model(problem)
            skeleton = generate_skeletons_from_capacity(problem, model, demand, keep=1)[0]
            allocation = Allocation(
                minutes=tuple(
                    tuple(0 if cell is None else 480 for cell in row) for row in model.cells
                ),
                origin="probe",
            )
            return len(generate_shifts(problem, model, allocation, skeleton, demand).shifts)

        # La tolérance ne peut qu'ajouter des horaires légaux, jamais en retirer.
        self.assertGreater(count(1065), count(None))


class RolesAlreadyCarriedByDemandTests(unittest.TestCase):
    """Deux réglages disent la même chose ; un seul doit être dur."""

    def test_a_counter_covered_end_to_end_carries_its_own_roles(self) -> None:
        from shiftos_highs_fast.shifts import role_implied_by_demand

        problem = _zone(counters=1)
        sector_day = problem["sectors"][0]["days"][0]
        self.assertTrue(role_implied_by_demand(problem, "c0", sector_day))

    def test_a_gap_in_the_demand_keeps_the_roles_binding(self) -> None:
        from shiftos_highs_fast.shifts import role_implied_by_demand

        problem = _zone(counters=1)
        # La demande ne couvre plus l'ouverture : le rôle redevient la seule
        # chose qui l'exige, et garde donc toute sa force.
        problem["demandSlots"][0]["startMinutes"] = 600
        sector_day = problem["sectors"][0]["days"][0]
        self.assertFalse(role_implied_by_demand(problem, "c0", sector_day))

    def test_a_demand_of_zero_never_implies_a_role(self) -> None:
        from shiftos_highs_fast.shifts import role_implied_by_demand

        problem = _zone(counters=1, required=0)
        self.assertFalse(
            role_implied_by_demand(problem, "c0", problem["sectors"][0]["days"][0])
        )

    def test_the_engine_degrades_into_a_deficit_instead_of_refusing(self) -> None:
        from shiftos_highs_fast.pipeline import solve_fast

        # Un comptoir couvert de bout en bout mais impossible à ouvrir : ce doit
        # être un manque de couverture, jamais un refus total.
        problem = _zone(counters=1)
        for sector in problem["sectors"]:
            for day in sector["days"]:
                day["minimumOpenings"] = 5   # plus que l'effectif entier
                day["exactClosings"] = 5
        answer = solve_fast(problem, time_limit_seconds=30.0)
        self.assertNotEqual(answer["status"], "infeasible-proven")
        self.assertIsNotNone(answer["solution"])

    def test_a_counter_whose_demand_leaves_the_boundary_open_is_still_proven(self) -> None:
        from shiftos_highs_fast.pipeline import _sector_role_conflicts

        problem = _zone(counters=1)
        # Aucune demande : rien d'autre que le rôle n'exige l'ouverture.
        problem["demandSlots"] = []
        for sector in problem["sectors"]:
            for day in sector["days"]:
                day["minimumOpenings"] = 5
        self.assertTrue(_sector_role_conflicts(problem))


class NamingTheDayThatFailedTests(unittest.TestCase):
    """« 25 placements refusés » n'est pas un diagnostic : il faut la journée."""

    def _space(self, problem: dict):
        from shiftos_highs.demand import build_demand_model
        from shiftos_highs_fast.allocation import Allocation, build_allocation_model
        from shiftos_highs_fast.shifts import generate_shifts
        from shiftos_highs_fast.skeleton import generate_skeletons_from_capacity

        model = build_allocation_model(problem)
        demand = build_demand_model(problem)
        skeleton = generate_skeletons_from_capacity(problem, model, demand, keep=1)[0]
        allocation = Allocation(
            minutes=tuple(
                tuple(0 if cell is None else 480 for cell in row) for row in model.cells
            ),
            origin="probe",
        )
        return model, generate_shifts(problem, model, allocation, skeleton, demand)

    def test_a_servable_day_is_not_named(self) -> None:
        from shiftos_highs_fast.pipeline import days_without_placement

        problem = _zone(counters=2)
        model, space = self._space(problem)
        self.assertEqual(days_without_placement(problem, model, space), [])

    def test_a_counter_needing_more_openers_than_exist_names_its_day(self) -> None:
        from shiftos_highs_fast.pipeline import days_without_placement

        problem = _zone(counters=2)
        problem["demandSlots"] = []
        # Cinq ouvertures exigées, quatre personnes en tout : aucun horaire ne
        # peut servir cette journée, et c'est cette DATE qu'il faut dire.
        for sector in problem["sectors"]:
            if sector["id"] == "c0":
                for day in sector["days"]:
                    day["minimumOpenings"] = 5
        model, space = self._space(problem)
        self.assertEqual(days_without_placement(problem, model, space), ["2026-07-20"])

    def test_a_coverage_shortfall_is_never_blamed(self) -> None:
        from shiftos_highs_fast.pipeline import days_without_placement

        # Le placement ACCEPTE un déficit — c'est ce qu'il minimise. Exiger la
        # couverture ici accuserait une journée que le moteur sait servir.
        problem = _zone(counters=2, required=9)
        model, space = self._space(problem)
        self.assertEqual(days_without_placement(problem, model, space), [])

    def test_an_unreachable_hard_floor_is_blamed(self) -> None:
        from shiftos_highs_fast.pipeline import days_without_placement

        # Un plancher DUR, lui, ne se négocie pas.
        problem = _zone(counters=2)
        for slot in problem["demandSlots"]:
            slot["hardMinimumEmployees"] = 9
        model, space = self._space(problem)
        self.assertEqual(days_without_placement(problem, model, space), ["2026-07-20"])


class StoppingWhenNothingImprovesTests(unittest.TestCase):
    """Rendre une réponse une minute après l'avoir trouvée n'aide personne."""

    def test_a_zone_returns_well_before_its_budget(self) -> None:
        from shiftos_highs_fast.pipeline import solve_fast

        problem = _zone(counters=3)
        answer = solve_fast(problem, time_limit_seconds=120.0)
        self.assertIsNotNone(answer["solution"])
        # Le seuil est 30 % du budget après la dernière amélioration : une zone
        # qui trouve tôt ne doit pas attendre deux minutes pour le dire.
        self.assertLess(answer["diagnostics"]["totalSeconds"], 60.0)

    def test_mono_sector_keeps_its_exhaustive_search(self) -> None:
        from shiftos_highs_fast.pipeline import placement_cap_for

        # Le garde-fou est le même partout : rien de ce qui accélère la zone ne
        # doit toucher le mono, dont les fixtures mesurent la production.
        self.assertEqual(
            placement_cap_for(8.0, 55.0, multi_sector=False,
                              has_answer=False, has_alternative_allocation=True),
            8.0,
        )


class NarrowingAnUnsolvableSpaceTests(unittest.TestCase):
    """Un espace plus riche qu'on ne sait pas fouiller vaut moins qu'un pauvre."""

    def test_the_cap_keeps_the_readings_that_cover_the_most_demand(self) -> None:
        import json
        from shiftos_highs_fast.shifts import (
            Segment,
            _sector_patterns,
            demand_by_cell,
        )

        path = ROOT / "fixtures/market-zone-problem.json"
        if not path.exists():  # pragma: no cover — fixture générée sur demande
            self.skipTest("fixture zone marché absente")
        problem = json.loads(path.read_text(encoding="utf-8"))
        date = problem["days"][1]["date"]
        # Ce salarié sert les quatre comptoirs : c'est la configuration qui
        # noyait le modèle, et donc la seule où le plafond a un sens.
        employee = dict(problem["employees"][0])
        employee["allowedSectorIds"] = [str(s["id"]) for s in problem["sectors"]]
        day = next(item for item in problem["days"] if item["date"] == date)
        segments = (Segment(8 * 60, 15 * 60),)
        step = int(problem["timeStepMinutes"])

        every = _sector_patterns(problem, employee, day, segments, step)
        mixed = [b for b, _s, _p in every if len({x.sector_id for x in b}) == 2]
        self.assertGreater(len(mixed), 4, "sans lectures mixtes le plafond ne dit rien")

        capped = _sector_patterns(
            problem, employee, day, segments, step, (), 4, demand_by_cell(problem)
        )
        self.assertLess(len(capped), len(every))
        # Les lectures à UN comptoir survivent toutes : sans elles une forme
        # pourrait se retrouver sans aucune lecture, et la cellule serait
        # déclarée impossible par un tri, pas par une règle.
        self.assertEqual(
            sum(1 for b, _s, _p in capped if len({x.sector_id for x in b}) == 1),
            sum(1 for b, _s, _p in every if len({x.sector_id for x in b}) == 1),
        )

    def test_an_ordinary_zone_is_never_narrowed(self) -> None:
        """La soupape ne doit pas se déclencher sur la production.

        Le seuil est la frontière mesurée du placement : sous lui, le MILP
        résout et prouve. Une zone dont chacun sert deux comptoirs reste très
        au-dessous, et rien ne doit lui être retiré.
        """
        import json
        from shiftos_highs.demand import build_demand_model
        from shiftos_highs_fast.allocation import build_allocation_model
        from shiftos_highs_fast.shifts import (
            MAXIMUM_SHIFTS_BEFORE_NARROWING,
            generate_shifts,
        )
        from shiftos_highs_fast.skeleton import generate_skeletons_from_capacity
        from shiftos_highs_fast.skeleton_allocation import (
            build_duration_space,
            solve_for_skeleton,
        )

        path = ROOT / "fixtures/market-zone-problem.json"
        if not path.exists():  # pragma: no cover — fixture générée sur demande
            self.skipTest("fixture zone marché absente")
        problem = json.loads(path.read_text(encoding="utf-8"))
        demand = build_demand_model(problem)
        model = build_allocation_model(problem)
        skeleton = generate_skeletons_from_capacity(
            problem, model, demand, per_family=6, keep=1
        )[0]
        space = build_duration_space(problem, model, demand, skeleton)
        allocation = solve_for_skeleton(problem, model, space, time_limit=8.0, origin="test")
        shifts = generate_shifts(problem, model, allocation, skeleton, demand)
        self.assertLess(len(shifts.shifts), MAXIMUM_SHIFTS_BEFORE_NARROWING)


class TheCounterHasAHolderTests(unittest.TestCase):
    """Qui tient un comptoir de bout en bout, quand la réponse est forcée."""

    @staticmethod
    def _only_available(problem: dict, keep: set[str]) -> dict:
        for entry in problem["employeeDays"]:
            if str(entry["employeeId"]) not in keep:
                entry.update({"available": False, "mandatory": False, "maximumMinutes": 0})
        return problem

    def test_the_only_authorised_person_still_holds_both_ends(self) -> None:
        """La déduction historique, qui ne doit pas être perdue en chemin."""
        from shiftos_highs_fast.shifts import sole_server_duties

        problem = self._only_available(_zone(counters=3), {"c0-1"})
        duties = sole_server_duties(problem)
        # Elle sert aussi c1 en second choix, et y est également seule.
        self.assertIn(("c0", 540, 1020), duties[("c0-1", "2026-07-20")])

    def test_the_only_person_whose_first_counter_it_is_holds_it(self) -> None:
        """L'élargissement demandé par le métier.

        Les autres l'ont en deuxième choix : ils viendront en renfort, mais
        tenir le comptoir d'un bout à l'autre revient à celui dont c'est le
        rayon. Sans cette lecture, un comptoir de douze heures servi par une
        titulaire et un renfort restait sans titulaire désigné, et le moteur
        donnait huit heures à la première puis laissait quatre heures éteintes.
        """
        from shiftos_highs_fast.shifts import sole_server_duties

        # c2-1 et c2-2 servent c0 en SECOND choix ; seule c0-1 l'a en premier.
        problem = self._only_available(_zone(counters=3), {"c0-1", "c2-1", "c2-2"})
        duties = sole_server_duties(problem, designate_holders=True)
        self.assertIn(("c0", 540, 1020), duties[("c0-1", "2026-07-20")])

    def test_two_holders_designate_nobody(self) -> None:
        """Rien n'est forcé quand rien n'est déduit : deux titulaires, pas de règle."""
        from shiftos_highs_fast.shifts import sole_server_duties

        problem = self._only_available(_zone(counters=3), {"c0-1", "c0-2"})
        duties = sole_server_duties(problem, designate_holders=True)
        self.assertNotIn(("c0-1", "2026-07-20"), duties)
        self.assertNotIn(("c0-2", "2026-07-20"), duties)

    def test_a_holder_who_cannot_split_only_owes_the_opening(self) -> None:
        """L'arbitrage du métier, mot pour mot.

        On ne va pas exiger d'une personne qui ne coupe pas qu'elle couvre une
        amplitude plus longue que sa traite — ni la priver du comptoir pour
        autant. Elle ouvre, et fait ses heures à partir de là.
        """
        from shiftos_highs_fast.shifts import sole_server_duties

        problem = self._only_available(_zone(counters=3), {"c0-1"})
        for sector in problem["sectors"]:
            if sector["id"] == "c0":
                sector["days"][0]["closesAtMinutes"] = 1_140  # neuf heures d'amplitude
        for entry in problem["employeeDays"]:
            entry["latestEndMinutes"] = 1_140
        # Seule autorisée, elle garde les deux bouts : personne d'autre ne peut
        # fermer, et une impossibilité doit remonter plutôt que disparaître.
        problem["employees"].append({
            **problem["employees"][0], "id": "renfort", "allowedSectorIds": ["c1", "c0"],
        })
        problem["employeeDays"].append({
            "employeeId": "renfort", "date": "2026-07-20", "available": True,
            "mandatory": True, "fixedRest": False, "earliestStartMinutes": 540,
            "latestEndMinutes": 1_140, "maximumMinutes": 480,
        })
        duties = sole_server_duties(problem, designate_holders=True)
        self.assertIn(("c0", 540, None), duties[("c0-1", "2026-07-20")])

    def test_someone_who_cannot_be_there_at_opening_is_never_designated(self) -> None:
        """Une déduction ne doit jamais rendre une cellule impossible.

        Lui imposer le comptoir ne produirait aucune forme légale : la cellule
        serait déclarée morte par un raisonnement, pas par une règle.
        """
        from shiftos_highs_fast.shifts import sole_server_duties

        problem = self._only_available(_zone(counters=3), {"c0-1"})
        for entry in problem["employeeDays"]:
            if str(entry["employeeId"]) == "c0-1":
                entry["earliestStartMinutes"] = 600
        self.assertNotIn(("c0-1", "2026-07-20"), sole_server_duties(problem))


class OpeningLateIsWorseThanAQuietGapTests(unittest.TestCase):
    """Toutes les heures manquantes ne se valent pas."""

    def test_the_first_hour_of_each_counter_is_marked(self) -> None:
        from shiftos_highs_fast.placement import (
            OPENING_PRIORITY_MINUTES,
            opening_priority_cells,
        )

        problem = _zone(counters=2)
        cells = opening_priority_cells(problem)
        date = "2026-07-20"
        opens_at = 540
        # Exactement la première heure, ni avant ni après.
        self.assertIn(("c0", date, opens_at), cells)
        self.assertIn(("c0", date, opens_at + OPENING_PRIORITY_MINUTES - 15), cells)
        self.assertNotIn(("c0", date, opens_at + OPENING_PRIORITY_MINUTES), cells)
        self.assertNotIn(("c0", date, opens_at - 15), cells)
        # Chaque comptoir a la sienne : la priorité suit l'ouverture du RAYON,
        # pas celle du magasin.
        self.assertIn(("c1", date, opens_at), cells)

    def test_a_closed_counter_has_no_priority(self) -> None:
        from shiftos_highs_fast.placement import opening_priority_cells

        problem = _zone(counters=2)
        for sector in problem["sectors"]:
            for sector_day in sector["days"]:
                sector_day["closed"] = True
        self.assertEqual(opening_priority_cells(problem), set())

    def test_mono_sector_is_never_touched(self) -> None:
        """Sa production est mesurée par des fixtures ; rien ne doit la bouger."""
        from shiftos_highs_fast.placement import opening_priority_cells

        self.assertEqual(opening_priority_cells(_drive()), set())


class TheOracleIsAJudgeAndIsJudgedTests(unittest.TestCase):
    """Une référence fausse est pire que pas de référence."""

    def test_it_proves_the_optimum_of_a_zone_whose_answer_is_known(self) -> None:
        from shiftos_highs.oracle_zone import solve_zone_oracle

        # Deux personnes par comptoir, quatre heures chacune : la journée se
        # couvre exactement. Tout ce qui n'est pas zéro ici est un défaut de
        # l'oracle, pas de la semaine.
        answer = solve_zone_oracle(_zone(counters=3), time_limit_seconds=120.0)
        self.assertEqual(answer["status"], "optimal")
        diagnostics = answer["diagnostics"]
        self.assertEqual(diagnostics["referenceDeficitMinutes"], 0)
        self.assertEqual(diagnostics["referenceShortSlots"], 0)
        # Jugé par l'évaluateur indépendant, jamais sur sa propre parole.
        self.assertTrue(diagnostics["validHardConstraints"], diagnostics["violations"])

    def test_it_honours_contracts_and_daily_budgets(self) -> None:
        """Ce que l'allocation garantissait au placement, l'oracle doit le poser.

        Il choisit les durées lui-même : un « optimum » qui ne respecte pas les
        contrats n'est pas un optimum, c'est une réponse à une autre question.
        """
        from shiftos_highs.oracle_zone import solve_zone_oracle

        problem = _zone(counters=2)
        answer = solve_zone_oracle(problem, time_limit_seconds=120.0)
        self.assertIsNotNone(answer["solution"])
        worked: dict[str, int] = {}
        per_day: dict[str, int] = {}
        for assignment in answer["solution"]["assignments"]:
            minutes = sum(
                int(segment["endMinutes"]) - int(segment["startMinutes"])
                for segment in assignment["segments"]
            )
            worked[str(assignment["employeeId"])] = (
                worked.get(str(assignment["employeeId"]), 0) + minutes
            )
            per_day[assignment["date"]] = per_day.get(assignment["date"], 0) + minutes

        for employee in problem["employees"]:
            self.assertEqual(
                worked.get(str(employee["id"]), 0), int(employee["contractMinutes"])
            )
        for day in problem["days"]:
            self.assertEqual(per_day.get(day["date"], 0), int(day["budgetMinutes"]))


class ZoneEndToEndTests(unittest.TestCase):
    def test_a_small_zone_is_solved_with_nothing_missing(self) -> None:
        from shiftos_highs_fast.pipeline import solve_fast

        problem = _zone(counters=3)
        answer = solve_fast(problem, time_limit_seconds=30.0)
        self.assertEqual(answer["status"], "feasible-zero-deficit")
        report = evaluate(problem, list(answer["solution"]["assignments"]))
        self.assertTrue(report["validHardConstraints"], report["violations"])
        self.assertEqual(report["underCoveredSlots"], 0)

    def test_a_shrunken_zone_adapts_its_target_instead_of_reporting_the_impossible(
        self,
    ) -> None:
        # Half the team is away. The reference profile still describes a normal
        # day; the adapted one describes the day that can actually be staffed,
        # and the placement is now measured against the second — as mono-sector
        # always was. Before, a market zone was measured against the first and
        # reported deficits no schedule could have avoided.
        problem = _zone(counters=2)
        for entry in problem["employeeDays"]:
            if entry["employeeId"].endswith("-2"):
                entry.update({"available": False, "mandatory": False, "maximumMinutes": 0})
        problem["employees"] = [
            employee for employee in problem["employees"]
            if not str(employee["id"]).endswith("-2")
        ]
        problem["employeeDays"] = [
            entry for entry in problem["employeeDays"]
            if not str(entry["employeeId"]).endswith("-2")
        ]
        problem["days"][0]["budgetMinutes"] = 480
        for slot in problem["demandSlots"]:
            slot["requiredEmployees"] = 2

        day = build_day_demand(problem, "2026-07-20")
        self.assertEqual([i.reference_required for i in day.intervals][0], 4)
        # Two people, four hours each: the day can hold 480 employee-minutes and
        # the target says so instead of asking for 3 840.
        self.assertEqual(day.total_adapted_minutes, 480)
        self.assertLessEqual(
            day.total_adapted_minutes, day.available_worked_minutes
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
