"""Turn the campaign artefacts into the robustness figures, and nothing else.

Every number here is read from a file the solver wrote. Nothing is recomputed,
nothing is inferred, and a scenario that produced no artefact is reported as
missing rather than quietly dropped — a campaign that silently shrinks is how a
robustness figure becomes a claim about the scenarios that happened to work.

    experiments/planning-v3-highs> python robustness_report.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results" / "perturbations"

WITH_SOLUTION = {"feasible-zero-deficit", "feasible-best-effort"}
ORACLE_WITH_SOLUTION = {"optimal", "feasible-time-limit"}


def main() -> int:
    summary_path = RESULTS / "summary.json"
    if not summary_path.exists():
        print("Aucune campagne. Lancer : python perturbations.py --time-limit 60")
        return 1

    campaign = json.loads(summary_path.read_text(encoding="utf-8"))
    scenarios: list[dict[str, Any]] = campaign["scenarios"]
    budget = float(campaign["timeLimitSeconds"])

    legal = [s for s in scenarios if s["status"] in WITH_SOLUTION]
    zero = [s for s in legal if s["referenceShortSlots"] == 0]
    infeasible = [s for s in scenarios if s["status"] == "infeasible-proven"]
    timeouts = [s for s in scenarios if s["status"] == "timeout-without-solution"]
    crashes = [s for s in scenarios if s["crash"]]

    # A false diagnostic in either direction: impossible declared about a week
    # arithmetic says is staffable, or a schedule produced for one it says is not.
    false_infeasible = [
        s for s in scenarios if s["expected"] == "feasible" and s["status"] == "infeasible-proven"
    ]
    false_schedule = [
        s for s in scenarios if s["expected"] == "impossible" and s["status"] in WITH_SOLUTION
    ]
    # A proof claim is only illegitimate on a SCHEDULE.
    #
    # Two heuristic choices sit upstream of the only exact step, so no schedule
    # this engine returns is ever provably best and `proof` must stay `none`.
    # An IMPOSSIBILITY is the opposite case: the demand model and the allocation
    # MILP each prove theirs outright, and `structural` or `solver` is the honest
    # word for it. Counting those as over-claiming would push the engine toward
    # hiding a proof it genuinely has.
    claiming_proof = [
        s
        for s in scenarios
        if s["status"] in WITH_SOLUTION and s["proof"] not in (None, "none")
    ]

    print("=" * 78)
    print("RAPPORT DE ROBUSTESSE — v3-highs-fast")
    print("=" * 78)
    print(f"budget par scénario                       {budget:.0f} s")
    print(f"scénarios                                 {len(scenarios)}")
    print(f"  attendus faisables                      {sum(1 for s in scenarios if s['expected'] == 'feasible')}")
    print(f"  attendus impossibles                    {sum(1 for s in scenarios if s['expected'] == 'impossible')}")
    print()
    print(f"solutions légales produites               {len(legal)}")
    print(f"  dont zéro créneau sous-couvert          {len(zero)}")
    print(f"infaisables déclarés                      {len(infeasible)}")
    print(f"timeouts sans solution                    {len(timeouts)}")
    print(f"plantages                                 {len(crashes)}")
    print()
    print(f"FAUX diagnostics d'infaisabilité          {len(false_infeasible)}")
    for entry in false_infeasible:
        print(f"    {entry['id']} — {entry['description']}")
    print(f"plannings fabriqués sur semaine impossible {len(false_schedule)}")
    for entry in false_schedule:
        print(f"    {entry['id']} — {'; '.join(entry['coherence'][:2])}")
    print(f"revendications de preuve                  {len(claiming_proof)}")
    print()

    timed = [s for s in scenarios if s["seconds"] is not None]
    worst = max(timed, key=lambda s: s["seconds"]) if timed else None
    at_budget = [s for s in timed if s["seconds"] >= budget - 3.0]
    print(f"pire temps                                {worst['seconds']:.2f} s ({worst['id']})" if worst else "pire temps  —")
    print(f"scénarios ayant consommé le budget        {len(at_budget)}")
    if timed:
        ordered = sorted(s["seconds"] for s in timed)
        median = ordered[len(ordered) // 2]
        print(f"temps médian                              {median:.2f} s")
    print()

    shortfalls = [s for s in legal if s["referenceShortSlots"]]
    worst_gap = (
        max(shortfalls, key=lambda s: (s["referenceShortSlots"], s["referenceDeficitMinutes"]))
        if shortfalls
        else None
    )
    print(f"plannings avec un manque                  {len(shortfalls)}")
    if worst_gap:
        print(
            f"pire écart de couverture                  "
            f"{worst_gap['referenceShortSlots']} créneaux / "
            f"{worst_gap['referenceDeficitMinutes']} min ({worst_gap['id']})"
        )
        print(f"  total des créneaux manquants            {sum(s['referenceShortSlots'] for s in shortfalls)}")
        print(f"  total des minutes manquantes            {sum(s['referenceDeficitMinutes'] for s in shortfalls)}")
    print()

    print("par axe")
    print(f"  {'axe':16} {'n':>3} {'légaux':>7} {'0/0':>5} {'infais.':>8} {'pire temps':>11} {'pire manque':>12}")
    for axis in sorted({s["axis"] for s in scenarios}):
        rows = [s for s in scenarios if s["axis"] == axis]
        rows_legal = [s for s in rows if s["status"] in WITH_SOLUTION]
        rows_zero = [s for s in rows_legal if s["referenceShortSlots"] == 0]
        rows_inf = [s for s in rows if s["status"] == "infeasible-proven"]
        slowest = max((s["seconds"] for s in rows), default=0.0)
        gap = max(
            ((s["referenceShortSlots"], s["referenceDeficitMinutes"]) for s in rows_legal),
            default=(0, 0),
        )
        print(
            f"  {axis:16} {len(rows):3} {len(rows_legal):7} {len(rows_zero):5} "
            f"{len(rows_inf):8} {slowest:10.2f}s {f'{gap[0]}/{gap[1]}':>12}"
        )
    print()

    comparison_path = RESULTS / "oracle-comparison.json"
    if not comparison_path.exists():
        print("comparaison oracle : non exécutée")
        print("  python perturbations.py --oracle --oracle-time-limit 300")
        return 0

    comparison = json.loads(comparison_path.read_text(encoding="utf-8"))
    rows = comparison["comparisons"]
    print(f"face à v3-highs-global ({comparison['oracleTimeLimitSeconds']:.0f} s par scénario)")
    print(
        f"  {'scénario':38} {'oracle':>12} {'rapide':>12} {'t.oracle':>10} {'t.rapide':>10} verdict"
    )
    matched = better = worse = contested = 0
    for row in rows:
        oracle_pair = (row["oracleShortSlots"], row["oracleDeficitMinutes"])
        fast_pair = (row["fastShortSlots"], row["fastDeficitMinutes"])
        if row["oracleStatus"] in ORACLE_WITH_SOLUTION and row["fastStatus"] == "infeasible-proven":
            verdict = "FAUX INFAISABLE"
            contested += 1
        elif row["fastStatus"] not in WITH_SOLUTION or row["oracleStatus"] not in ORACLE_WITH_SOLUTION:
            verdict = f"non comparable ({row['oracleStatus']} / {row['fastStatus']})"
        elif fast_pair == oracle_pair:
            verdict = "identique"
            matched += 1
        elif fast_pair < oracle_pair:
            verdict = "rapide meilleur"
            better += 1
        else:
            verdict = f"écart {fast_pair[0] - oracle_pair[0]} créneaux / {fast_pair[1] - oracle_pair[1]} min"
            worse += 1
        print(
            f"  {row['id']:38} {f'{oracle_pair[0]}/{oracle_pair[1]}':>12} "
            f"{f'{fast_pair[0]}/{fast_pair[1]}':>12} {row['oracleSeconds']:9.1f}s "
            f"{(row['fastSeconds'] or 0):9.1f}s {verdict}"
        )
    print()
    print(f"  qualité identique à l'oracle            {matched}/{len(rows)}")
    print(f"  meilleure que l'oracle                  {better}")
    print(f"  moins bonne que l'oracle                {worse}")
    print(f"  faux infaisables confirmés              {contested}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
