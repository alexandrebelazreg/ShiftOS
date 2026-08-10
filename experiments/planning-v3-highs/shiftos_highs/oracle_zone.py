"""L'oracle d'une zone marché : le meilleur planning, sans choix heuristique.

Pourquoi il manquait
--------------------
Le moteur rapide décide dans l'ordre : les rôles, puis les durées, puis les
horaires. Les deux premières décisions sont heuristiques, et il le dit — il
n'annonce jamais d'optimum. Restait donc une question sans réponse : **de
combien manque-t-il ?** `shiftos_highs/solver.py` y répondait pour un rayon
unique et ignore complètement les comptoirs, si bien qu'une zone n'avait aucune
référence. On mesurait des progrès sans savoir contre quoi.

Ce module pose la question en UN seul morceau. Aucune durée n'est fixée d'avance,
aucun rôle n'est distribué : toutes les durées travaillables de chaque cellule
entrent en concurrence, avec toutes leurs positions et toutes leurs lectures par
comptoir, et le MILP choisit l'ensemble. Ce qu'il rend est optimal pour la
semaine — pas pour une allocation.

Ce qu'il n'est pas
------------------
Rapide. C'est un instrument de mesure, pas un moteur : il n'a aucune raison de
tenir en soixante secondes et on lui donne des minutes. S'il s'arrête avant
d'avoir prouvé, il le dit, et son écart borne alors ce qui reste à gagner.

Il est aussi DÉLIBÉRÉMENT écrit à part. Partager la construction de lignes du
placement lui ferait hériter de ses erreurs, et un juge qui se trompe comme
l'accusé n'est pas un juge. Les seules choses partagées sont celles dont
l'exactitude ne se discute pas : l'énumération des formes légales et le modèle
de demande, tous deux déjà vérifiés par ailleurs.

Pourquoi la matrice est construite en tableaux
----------------------------------------------
Une semaine à quatre comptoirs produit 396 293 candidats, 964 164 plages et
12,4 millions de cases de couverture. Posées une par une depuis Python, elles
demandaient plus de vingt minutes — mesuré, 912 secondes de processeur pour
vingt-trois minutes d'horloge, soit un seul cœur occupé : ce n'était pas le
solveur qui peinait, c'était la boucle qui le nourrissait. L'oracle était donc
inutilisable précisément sur les semaines qu'on voulait mesurer.

Chaque cellule atomique reçoit un NUMÉRO, ce qui transforme « quels shifts
couvrent cette cellule » en une opération sur des tableaux. La construction est
tombée à une dizaine de secondes, et les résultats sont restés identiques au mot
près sur les zones de contrôle — mêmes dimensions de modèle, même optimum.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from shiftos_highs.demand import build_demand_model
from shiftos_highs.evaluate import evaluate
from shiftos_highs.fingerprint import fingerprint_problem
from shiftos_highs_fast.allocation import Allocation, build_allocation_model
from shiftos_highs_fast.placement import (
    DARK_COUNTER_WEIGHT,
    OPENING_DARK_MULTIPLIER,
    SHORT_SLOT_WEIGHT,
    opening_priority_cells,
)
from shiftos_highs_fast.shifts import generate_shifts, latest_close, role_implied_by_demand
from shiftos_highs_fast.skeleton import Skeleton
from shiftos_highs_fast.skeleton_allocation import build_duration_space

ENGINE = "zone-oracle"

_SCIPY_OPTIMAL = 0
_SCIPY_INFEASIBLE = 2


class _Rows:
    """Accumulateur de lignes creuses, alimenté par blocs plutôt que par cases.

    Deux entrées, et la distinction est la raison d'être de cette classe :

    - `add` pose UNE ligne à partir d'un dictionnaire. C'est le cas des lignes
      peu nombreuses — contrats, budgets, rôles, repos — dont l'écriture en
      Python ne coûte rien ;
    - `extend` verse des triplets déjà calculés en numpy dans des lignes DÉJÀ
      réservées. C'est le cas de la couverture, où douze millions de cases
      doivent entrer dans la matrice : les poser une par une depuis Python
      prenait des dizaines de minutes, ce qui rendait l'oracle inutilisable
      précisément sur les semaines qu'on voulait mesurer.

    `add` rend l'indice de la ligne qu'il vient de créer, ce qui permet de la
    réserver vide puis de la remplir en bloc.
    """

    def __init__(self) -> None:
        self._rows: list[np.ndarray] = []
        self._cols: list[np.ndarray] = []
        self._values: list[np.ndarray] = []
        self.lower: list[float] = []
        self.upper: list[float] = []

    def add(self, coefficients: dict[int, float], lb: float, ub: float) -> int:
        row = len(self.lower)
        if coefficients:
            columns = np.fromiter(
                coefficients.keys(), dtype=np.int64, count=len(coefficients)
            )
            values = np.fromiter(
                coefficients.values(), dtype=np.float64, count=len(coefficients)
            )
            keep = values != 0.0
            kept = int(keep.sum())
            if kept:
                self._rows.append(np.full(kept, row, dtype=np.int64))
                self._cols.append(columns[keep])
                self._values.append(values[keep])
        self.lower.append(lb)
        self.upper.append(ub)
        return row

    def extend(self, rows: Any, cols: Any, values: Any = 1.0) -> None:
        rows = np.asarray(rows, dtype=np.int64)
        if rows.size == 0:
            return
        self._rows.append(rows)
        self._cols.append(np.asarray(cols, dtype=np.int64))
        self._values.append(
            np.full(rows.size, float(values), dtype=np.float64)
            if np.isscalar(values)
            else np.asarray(values, dtype=np.float64)
        )

    def constraint(self, columns: int) -> LinearConstraint:
        empty_int = np.empty(0, dtype=np.int64)
        empty_float = np.empty(0, dtype=np.float64)
        matrix = coo_matrix(
            (
                np.concatenate(self._values) if self._values else empty_float,
                (
                    np.concatenate(self._rows) if self._rows else empty_int,
                    np.concatenate(self._cols) if self._cols else empty_int,
                ),
            ),
            shape=(len(self.lower), columns),
        ).tocsr()
        return LinearConstraint(matrix, np.array(self.lower), np.array(self.upper))


def score_like_the_oracle(
    problem: dict[str, Any], assignments: list[dict[str, Any]]
) -> float:
    """Noter un planning EXISTANT avec la règle exacte de l'oracle.

    Sans cela, comparer le moteur rapide au plancher de l'oracle reviendrait à
    comparer deux échelles : le moteur rapporte des minutes de déficit, l'oracle
    minimise des minutes PONDÉRÉES — une première personne manquante sur un
    comptoir y pèse quatre fois une suivante, et un créneau entamé compte à
    part. Deux nombres qui ne mesurent pas la même chose ne se soustraient pas.
    """
    step = int(problem["timeStepMinutes"])
    multi_sector = bool(problem.get("sectors"))
    demand = build_demand_model(problem)

    present: dict[tuple[str, str, int], int] = {}
    for assignment in assignments:
        blocks = assignment.get("sectorAssignments") or [
            {
                "sectorId": problem["sectorId"],
                "startMinutes": segment["startMinutes"],
                "endMinutes": segment["endMinutes"],
            }
            for segment in assignment["segments"]
        ]
        for block in blocks:
            for start in range(int(block["startMinutes"]), int(block["endMinutes"]), step):
                key = (str(block["sectorId"]), assignment["date"], start)
                present[key] = present.get(key, 0) + 1

    slot_of_cell: dict[tuple[str, str, int], list[str]] = {}
    for slot in problem["demandSlots"]:
        sector_id = str(slot.get("sectorId") or problem["sectorId"])
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            slot_of_cell.setdefault((sector_id, slot["date"], start), []).append(
                str(slot["id"])
            )

    priority = opening_priority_cells(problem)
    total = 0.0
    short_slots: set[str] = set()
    for date in sorted(demand.days):
        day = demand.days[date]
        cells = day.sector_intervals if multi_sector else day.intervals
        for cell in cells:
            sector_id = str(getattr(cell, "sector_id", problem["sectorId"]))
            here = present.get((sector_id, date, cell.start), 0)
            missing = max(0, cell.reference_required - here)
            if missing <= 0:
                continue
            dark = 1 if here == 0 else 0
            weight = DARK_COUNTER_WEIGHT * (
                OPENING_DARK_MULTIPLIER
                if (sector_id, date, cell.start) in priority
                else 1
            )
            total += step * (missing - dark) + step * weight * dark
            short_slots.update(slot_of_cell.get((sector_id, date, cell.start), []))
    return total + step * SHORT_SLOT_WEIGHT * len(short_slots)


def _every_shift(
    problem: dict[str, Any], model: Any, demand: Any, stride: int = 1
) -> Any:
    """Toutes les formes légales de chaque cellule, toutes durées confondues.

    `generate_shifts` demande une allocation, donc une durée par cellule. On la
    rappelle une fois par valeur admissible et on réunit les résultats : ce qui
    revient est l'espace complet, celui que le moteur rapide ne voit jamais en
    entier parce qu'il a déjà choisi.

    `stride` n'en garde qu'une valeur sur N.

    ATTENTION — MESURÉ INUTILE SUR UNE VRAIE SEMAINE, et la raison mérite d'être
    retenue : les contrats et les budgets journaliers sont des ÉGALITÉS en
    minutes. Une grille de durées trouée ne tombe juste sur aucune des deux, et
    le modèle devient `infeasible-proven` — non pas parce que la semaine est
    impossible, mais parce qu'on a retiré les valeurs qui permettaient aux sommes
    d'exister. Sur la zone à quatre comptoirs, un pas de six suffit à rendre la
    semaine irréalisable en quarante-trois secondes.

    Ce levier ne sert donc que sur des semaines sans budget exact. Ce qui
    freine réellement l'oracle est ailleurs : 396 293 candidats et 12,4 millions
    d'unités de couverture, dont chacune est une insertion Python dans la
    matrice. L'énumération ne prend que 47 secondes ; c'est la construction du
    modèle qui dure des dizaines de minutes, et c'est elle qu'il faut
    vectoriser.
    """
    skeleton = Skeleton(roles=(), family="oracle", score=(0, 0, 0))
    space = build_duration_space(problem, model, demand, skeleton)
    if space.dead_cells:
        return None, space.dead_cells

    days_count = len([d for d in problem["days"] if not d["closed"]])
    employees_count = len(problem["employees"])
    values = sorted(
        {option.minutes for options in space.options.values() for option in options}
    )
    if stride > 1:
        # La plus longue et la plus courte sont gardées quoi qu'il arrive : ce
        # sont elles qui bornent ce qu'une journée peut couvrir.
        kept = set(values[::stride])
        kept.update({values[0], values[-1]})
        values = sorted(kept)

    merged: list[Any] = []
    by_cell: dict[tuple[int, int], list[int]] = {}
    for value in values:
        minutes = tuple(
            tuple(
                value if value in space.durations(employee, day) else 0
                for day in range(days_count)
            )
            for employee in range(employees_count)
        )
        partial = generate_shifts(
            problem, model, Allocation(minutes=minutes, origin="oracle"), skeleton, demand
        )
        for shift in partial.shifts:
            by_cell.setdefault((shift.employee_index, shift.day_index), []).append(
                len(merged)
            )
            merged.append(shift)
    return (merged, by_cell), ()


def solve_zone_oracle(
    problem: dict[str, Any],
    *,
    time_limit_seconds: float = 900.0,
    duration_stride: int = 1,
    relaxation_only: bool = False,
) -> dict[str, Any]:
    """Le meilleur planning de la semaine, ou la borne de ce qui reste à gagner.

    `relaxation_only` ne cherche pas de planning : il rend le PLANCHER du
    déficit, c'est-à-dire ce qu'aucun horaire ne pourra jamais battre. À
    utiliser quand le modèle entier est hors de portée — ce qui est le cas dès
    quatre comptoirs — parce qu'un plancher répond déjà à « de combien le moteur
    rapide manque-t-il ».
    """
    started = time.perf_counter()
    step = int(problem["timeStepMinutes"])
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    rules = problem["rules"]

    demand = build_demand_model(problem)
    if demand.infeasible_days:
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint_problem(problem),
            "solution": None,
            "diagnostics": {
                "reason": "day-cannot-be-staffed",
                "infeasibleDays": list(demand.infeasible_days),
                "totalSeconds": time.perf_counter() - started,
            },
        }

    model = build_allocation_model(problem)
    built, dead = _every_shift(problem, model, demand, duration_stride)
    if built is None:
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint_problem(problem),
            "solution": None,
            "diagnostics": {
                "reason": "cell-without-any-workable-duration",
                "deadCells": [list(cell) for cell in dead[:20]],
                "totalSeconds": time.perf_counter() - started,
            },
        }
    shifts, by_cell = built

    # ── Colonnes ────────────────────────────────────────────────────────────
    multi_sector = bool(problem.get("sectors"))
    intervals: list[tuple[str, str, int, int, int]] = []
    for date in sorted(demand.days):
        day = demand.days[date]
        cells = day.sector_intervals if multi_sector else day.intervals
        for cell in cells:
            sector_id = getattr(cell, "sector_id", problem["sectorId"])
            intervals.append(
                (sector_id, date, cell.start, cell.hard_minimum, cell.reference_required)
            )

    slot_ids = [slot["id"] for slot in sorted(problem["demandSlots"], key=lambda s: s["id"])]
    slot_index = {identifier: position for position, identifier in enumerate(slot_ids)}
    membership: dict[tuple[str, str, int], list[int]] = {}
    for slot in problem["demandSlots"]:
        sector_id = str(slot.get("sectorId") or problem["sectorId"])
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            membership.setdefault((sector_id, slot["date"], start), []).append(
                slot_index[slot["id"]]
            )

    shift_count = len(shifts)
    thin_offset = shift_count
    dark_offset = thin_offset + len(intervals)
    slot_offset = dark_offset + len(intervals)
    columns = slot_offset + len(slot_ids)

    # ── Les shifts, lus une fois pour toutes en tableaux ────────────────────
    #
    # Tout ce qui suit interroge les mêmes quatre-cent-mille candidats sous des
    # angles différents. Les relire objet par objet à chaque fois est ce qui
    # coûtait des dizaines de minutes ; lus une fois en colonnes, ils se
    # questionnent en une opération.
    shift_minutes = np.fromiter(
        (shift.minutes for shift in shifts), dtype=np.float64, count=shift_count
    )
    shift_employee = np.fromiter(
        (shift.employee_index for shift in shifts), dtype=np.int64, count=shift_count
    )
    shift_day = np.fromiter(
        (shift.day_index for shift in shifts), dtype=np.int64, count=shift_count
    )

    sector_ids = (
        [str(sector["id"]) for sector in problem["sectors"]]
        if multi_sector
        else [str(problem["sectorId"])]
    )
    sector_position = {sector_id: index for index, sector_id in enumerate(sector_ids)}
    date_position = {day["date"]: index for index, day in enumerate(days)}

    # Un bloc par (shift, plage sur un comptoir). Seule boucle Python qui reste
    # sur les candidats, et elle ne fait que recopier quatre entiers.
    block_shift: list[int] = []
    block_sector: list[int] = []
    block_start: list[int] = []
    block_end: list[int] = []
    for index, shift in enumerate(shifts):
        for block in shift.sector_assignments:
            block_shift.append(index)
            block_sector.append(sector_position[block.sector_id])
            block_start.append(block.start)
            block_end.append(block.end)

    blocks_shift = np.asarray(block_shift, dtype=np.int64)
    blocks_sector = np.asarray(block_sector, dtype=np.int64)
    blocks_start = np.asarray(block_start, dtype=np.int64)
    blocks_end = np.asarray(block_end, dtype=np.int64)
    blocks_day = shift_day[blocks_shift] if blocks_shift.size else blocks_shift

    rows = _Rows()

    # Une forme, et une seule, par cellule travaillée.
    for key, bucket in sorted(by_cell.items()):
        row = rows.add({}, 1.0, 1.0)
        rows.extend(np.full(len(bucket), row, dtype=np.int64), np.asarray(bucket))

    # ── Ce que l'allocation garantissait, et qu'il faut donc poser ici ──────
    #
    # Le placement n'a jamais eu à imposer contrats ni budgets : une allocation
    # les avait déjà réglés avant lui. L'oracle, lui, choisit les durées, donc
    # c'est à lui de les tenir — les oublier rendrait un « optimum » qui ne
    # respecte pas les contrats, c'est-à-dire rien du tout.
    for employee_index, employee in enumerate(employees):
        own = np.flatnonzero(shift_employee == employee_index)
        contract = float(employee["contractMinutes"])
        row = rows.add({}, contract, contract)
        rows.extend(np.full(own.size, row, dtype=np.int64), own, shift_minutes[own])

    for day_index, day in enumerate(days):
        budget = day.get("budgetMinutes")
        if budget is None:
            continue
        own = np.flatnonzero(shift_day == day_index)
        exact = day.get("budgetMode", "exact") == "exact"
        row = rows.add(
            {}, float(budget) if exact else 0.0, float(budget)
        )
        rows.extend(np.full(own.size, row, dtype=np.int64), own, shift_minutes[own])

    # ── Couverture, par comptoir et par quart d'heure ───────────────────────
    #
    # Chaque cellule atomique — un comptoir, un jour, un quart d'heure — reçoit
    # un NUMÉRO. Une fois cet encodage posé, savoir quels shifts couvrent quelle
    # cellule cesse d'être un parcours et devient une opération sur des tableaux.
    #
    # Le calcul qui suit déroule chaque bloc en ses quarts d'heure sans écrire
    # une seule boucle : `repeat` répète le numéro de départ autant de fois que
    # le bloc dure, et la soustraction du début de chaque groupe fabrique les
    # décalages 0, 1, 2… Douze millions de cases sortent de là en une fraction
    # de seconde, là où les poser une par une depuis Python demandait des
    # dizaines de minutes.
    slots_per_day = 1_440 // step
    cell_count = len(sector_ids) * len(days) * slots_per_day

    def cell_number(sector: int, day_index: int, minute: int) -> int:
        return (sector * len(days) + day_index) * slots_per_day + minute // step

    interval_of_cell = np.full(cell_count, -1, dtype=np.int64)
    for position, (sector_id, date, start, _hard, _required) in enumerate(intervals):
        interval_of_cell[
            cell_number(sector_position[sector_id], date_position[date], start)
        ] = position

    if blocks_shift.size:
        units = (blocks_end - blocks_start) // step
        first_cell = np.empty(blocks_shift.size, dtype=np.int64)
        np.multiply(blocks_sector, len(days), out=first_cell)
        np.add(first_cell, blocks_day, out=first_cell)
        np.multiply(first_cell, slots_per_day, out=first_cell)
        np.add(first_cell, blocks_start // step, out=first_cell)

        total_units = int(units.sum())
        group_start = np.repeat(np.cumsum(units) - units, units)
        offsets = np.arange(total_units, dtype=np.int64) - group_start
        covered_cells = np.repeat(first_cell, units) + offsets
        covering_shift = np.repeat(blocks_shift, units)

        covered_position = interval_of_cell[covered_cells]
        useful = covered_position >= 0
        covered_position = covered_position[useful]
        covering_shift = covering_shift[useful]
        del covered_cells, offsets, group_start
    else:
        covered_position = np.empty(0, dtype=np.int64)
        covering_shift = np.empty(0, dtype=np.int64)

    # Les lignes sont réservées d'abord, dans l'ordre exact où la version
    # naïve les écrivait, puis remplies en bloc. L'ordre importe : deux
    # matrices identiques aux permutations près ne sont pas identiques pour un
    # solveur, et cet oracle doit rester reproductible.
    hard_row_of = np.full(len(intervals), -1, dtype=np.int64)
    target_row_of = np.full(len(intervals), -1, dtype=np.int64)
    for position, (sector_id, date, start, hard, required) in enumerate(intervals):
        if hard > 0:
            hard_row_of[position] = rows.add({}, float(hard), np.inf)
        missing = {thin_offset + position: 1.0, dark_offset + position: 1.0}
        if required > hard:
            target_row_of[position] = rows.add(missing, float(required), np.inf)
        for slot in membership.get((sector_id, date, start), []):
            if required > 0:
                rows.add({**missing, slot_offset + slot: -float(required)}, -np.inf, 0.0)

    for row_of_interval in (hard_row_of, target_row_of):
        target_rows = row_of_interval[covered_position]
        wanted = target_rows >= 0
        rows.extend(target_rows[wanted], covering_shift[wanted])

    # ── Ouvertures et fermetures de comptoir ────────────────────────────────
    #
    # La version naïve rebalayait TOUS les candidats pour chaque comptoir-jour,
    # soit vingt-quatre passages sur quatre-cent-mille shifts. Les bornes de
    # chaque comptoir tiennent dans un tableau indexé par (comptoir, jour) : un
    # bloc est une ouverture s'il commence à l'heure d'ouverture du sien, et le
    # test se pose alors sur tous les blocs à la fois.
    shape = (len(sector_ids), len(days))
    opens_at_of = np.full(shape, -1, dtype=np.int64)
    closes_at_of = np.full(shape, -1, dtype=np.int64)
    latest_of = np.full(shape, -1, dtype=np.int64)
    opening_row_of = np.full(shape, -1, dtype=np.int64)
    closing_row_of = np.full(shape, -1, dtype=np.int64)

    for sector in problem.get("sectors") or []:
        sector_id = str(sector["id"])
        column = sector_position[sector_id]
        for sector_day in sector["days"]:
            if sector_day["closed"] or role_implied_by_demand(problem, sector_id, sector_day):
                continue
            line = date_position.get(sector_day["date"])
            if line is None:
                continue
            opens_at_of[column, line] = int(sector_day["opensAtMinutes"])
            closes_at_of[column, line] = int(sector_day["closesAtMinutes"])
            latest_of[column, line] = latest_close(sector_day)
            opening_row_of[column, line] = rows.add(
                {}, float(sector_day["minimumOpenings"]), np.inf
            )
            closing_row_of[column, line] = rows.add(
                {}, float(sector_day["exactClosings"]), np.inf
            )

    if blocks_shift.size:
        own_opens = opens_at_of[blocks_sector, blocks_day]
        own_closes = closes_at_of[blocks_sector, blocks_day]
        own_latest = latest_of[blocks_sector, blocks_day]
        is_opener = (own_opens >= 0) & (blocks_start == own_opens)
        is_closer = (
            (own_closes >= 0) & (blocks_end >= own_closes) & (blocks_end <= own_latest)
        )
        for mask, row_of in ((is_opener, opening_row_of), (is_closer, closing_row_of)):
            if not mask.any():
                continue
            # Un shift coupé pose deux blocs sur le même comptoir : sans ce
            # dédoublonnage il compterait deux fois comme ouvreur, et la ligne
            # serait satisfaite par une personne au lieu de deux.
            pairs = np.unique(
                np.stack(
                    [row_of[blocks_sector[mask], blocks_day[mask]], blocks_shift[mask]],
                    axis=1,
                ),
                axis=0,
            )
            rows.extend(pairs[:, 0], pairs[:, 1])

    # ── Repos entre deux journées travaillées ───────────────────────────────
    #
    # Toutes les journées disponibles sont travaillées — le contrat V3 n'a pas
    # de jour optionnel — donc les paires à contraindre sont connues d'avance.
    rest = int(rules["minimumRestMinutes"])
    for employee_index in range(len(employees)):
        worked = [
            day_index
            for day_index in range(len(days))
            if by_cell.get((employee_index, day_index))
        ]
        for position in range(1, len(worked)):
            previous, current = worked[position - 1], worked[position]
            gap = (current - previous) * 1_440
            coefficients: dict[int, float] = {}
            for index in by_cell.get((employee_index, current), ()):
                coefficients[index] = coefficients.get(index, 0.0) + shifts[index].first_start
            for index in by_cell.get((employee_index, previous), ()):
                coefficients[index] = coefficients.get(index, 0.0) - shifts[index].last_end
            rows.add(coefficients, float(rest - gap), np.inf)

    # ── Objectif : le même que celui du moteur, sinon on compare deux choses ─
    priority = opening_priority_cells(problem)

    objective = np.zeros(columns)
    for position, (sector_id, date, start, _hard, _required) in enumerate(intervals):
        objective[thin_offset + position] = float(step)
        weight = DARK_COUNTER_WEIGHT * (
            OPENING_DARK_MULTIPLIER if (sector_id, date, start) in priority else 1
        )
        objective[dark_offset + position] = float(step * weight)
    for position in range(len(slot_ids)):
        objective[slot_offset + position] = float(step * SHORT_SLOT_WEIGHT)

    lower = np.zeros(columns)
    upper = np.ones(columns)
    for position, (_s, _d, _t, _h, required) in enumerate(intervals):
        upper[thin_offset + position] = float(max(0, required - 1))

    # ── Le plancher, quand le plafond est hors de portée ────────────────────
    #
    # Relâcher l'exigence d'entiers — accepter des demi-personnes — donne un
    # problème incomparablement plus facile dont l'optimum est TOUJOURS
    # inférieur ou égal à celui du vrai. C'est donc un plancher valide sur le
    # déficit : aucun planning entier ne peut faire mieux.
    #
    # Cela suffit à répondre à la question qui motivait cet oracle. Comparé au
    # déficit que le moteur rapide obtient réellement, le plancher BORNE ce
    # qu'une meilleure recherche pourrait encore gagner — sans qu'on ait jamais
    # eu à résoudre la semaine. Un plancher à quinze heures contre un moteur à
    # seize dit « au plus une heure à gagner », et c'est une réponse.
    if relaxation_only:
        relaxed = milp(
            objective,
            integrality=np.zeros(columns, dtype=np.int8),
            bounds=Bounds(lower, upper),
            constraints=rows.constraint(columns),
            options={"time_limit": float(time_limit_seconds)},
        )
        return {
            "engine": ENGINE,
            "status": "lower-bound" if relaxed.status == _SCIPY_OPTIMAL else "no-bound",
            "problemFingerprint": fingerprint_problem(problem),
            "solution": None,
            "diagnostics": {
                "objectiveLowerBound": (
                    None if relaxed.fun is None else float(relaxed.fun)
                ),
                "solverStatus": int(relaxed.status),
                "shiftCandidates": shift_count,
                "columns": columns,
                "rows": len(rows.lower),
                "totalSeconds": time.perf_counter() - started,
            },
        }

    result = milp(
        objective,
        integrality=np.ones(columns, dtype=np.int8),
        bounds=Bounds(lower, upper),
        constraints=rows.constraint(columns),
        options={"time_limit": float(time_limit_seconds), "mip_rel_gap": 0.0},
    )
    seconds = time.perf_counter() - started

    shape = {
        "shiftCandidates": shift_count,
        "columns": columns,
        "rows": len(rows.lower),
        "totalSeconds": seconds,
        "durationStride": duration_stride,
    }
    if result.status == _SCIPY_INFEASIBLE:
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint_problem(problem),
            "solution": None,
            "diagnostics": {"reason": "no-schedule-satisfies-the-week", **shape},
        }
    if result.x is None:
        return {
            "engine": ENGINE,
            "status": "timeout-without-solution",
            "problemFingerprint": fingerprint_problem(problem),
            "solution": None,
            "diagnostics": {"reason": "oracle-found-nothing-in-its-budget", **shape},
        }

    chosen = [index for index in range(shift_count) if result.x[index] > 0.5]
    assignments = [
        {
            "employeeId": model.employees[shifts[index].employee_index],
            "date": days[shifts[index].day_index]["date"],
            "segments": [
                {"startMinutes": s.start, "endMinutes": s.end}
                for s in shifts[index].segments
            ],
            "sectorAssignments": [
                {
                    "sectorId": block.sector_id,
                    "startMinutes": block.start,
                    "endMinutes": block.end,
                }
                for block in shifts[index].sector_assignments
            ],
        }
        for index in chosen
    ]
    assignments.sort(key=lambda item: (item["date"], item["employeeId"]))

    # Le juge est jugé : un oracle qui rend un planning illégal n'est pas une
    # référence, c'est un bug avec de l'autorité.
    report = evaluate(problem, assignments)
    gap = getattr(result, "mip_gap", None)
    return {
        "engine": ENGINE,
        "status": (
            "optimal"
            if result.status == _SCIPY_OPTIMAL
            else "feasible-not-proven"
        ),
        "problemFingerprint": fingerprint_problem(problem),
        "solution": {"version": "v3.0.0", "assignments": assignments},
        "evaluation": report,
        "diagnostics": {
            "referenceShortSlots": report["underCoveredSlots"],
            "referenceDeficitMinutes": report["totalDeficitMinutes"],
            "validHardConstraints": report["validHardConstraints"],
            "violations": report["violations"][:5],
            "proven": result.status == _SCIPY_OPTIMAL,
            "gap": None if gap is None or gap != gap else float(gap),
            **shape,
        },
    }
