"""Reproducible empirical experiments for stake-vote-econ-v2.0.0.

These Monte Carlo results characterize configured scenarios; they do not prove
an equilibrium, a security threshold, or any theorem.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, replace
from datetime import datetime, timezone
from itertools import product
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from model import (
    ABSTAIN, BUYER, SELLER, MODEL_VERSION, WEI, MechanismConfig,
    SchellingVotingModel, attack_economics, strategies_mixed,
)

HERE = Path(__file__).resolve().parent
DEFAULT_SEED = 20260810


def mean_ci(values, z=1.96):
    x = np.asarray(values, dtype=float)
    mean = float(x.mean()) if len(x) else float("nan")
    half = float(z * x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 1 else 0.0
    return mean, mean - half, mean + half


def parse_csv(text, cast):
    return [cast(item.strip()) for item in text.split(",") if item.strip()]


def paired_strategy_payoffs(cfg, qs, n, reps, seed):
    """Common-random-number comparison: alternative payoff minus honest payoff."""
    alternatives = ["honest", "invert", "always_buyer", "always_seller", "abstain"]
    rows = []
    for q, alternative in product(qs, alternatives):
        differences, honest_values, alternative_values = [], [], []
        outcomes = {"correct": 0, "wrong": 0, "void": 0}
        for r in range(reps):
            rng = np.random.default_rng(seed + 100_000 * int(q * 1000) + r)
            true_state = int(rng.integers(0, 2))
            correct = rng.random(n) < q
            signals = np.where(correct, true_state, 1 - true_state)
            active_draws = rng.random(n)
            base = SchellingVotingModel(
                n, q, cfg, strategies_mixed(n, [("honest", n)]), true_state,
                signals=signals, active_draws=active_draws,
            ).step()
            alt = SchellingVotingModel(
                n, q, cfg, strategies_mixed(n, [("honest", n - 1), (alternative, 1)]),
                true_state, signals=signals, active_draws=active_draws,
            ).step()
            honest_payoff = base.voters[-1].net_wei / WEI
            alternative_payoff = alt.voters[-1].net_wei / WEI
            honest_values.append(honest_payoff)
            alternative_values.append(alternative_payoff)
            differences.append(alternative_payoff - honest_payoff)
            outcomes[alt.outcome] += 1
        diff, lo, hi = mean_ci(differences)
        hmean, _, _ = mean_ci(honest_values)
        amean, _, _ = mean_ci(alternative_values)
        rows.append({
            "model_version": MODEL_VERSION, "q": q, "n": n,
            "alternative": alternative, "paired_difference_alt_minus_honest_eth": diff,
            "ci95_low_eth": lo, "ci95_high_eth": hi,
            "honest_mean_eth": hmean, "alternative_mean_eth": amean,
            "correct_rate": outcomes["correct"] / reps,
            "wrong_rate": outcomes["wrong"] / reps,
            "void_rate": outcomes["void"] / reps, "reps": reps,
        })
    return pd.DataFrame(rows)


def factorial_experiment(base_cfg, thresholds, qs, ns, coalitions, turnouts, reps, seed, benefit):
    """Configurable threshold × q × n × coalition × turnout design."""
    rows = []
    for combo_id, (threshold, q, n, coalition, turnout) in enumerate(
        product(thresholds, qs, ns, coalitions, turnouts)
    ):
        cfg = replace(base_cfg, majority_bps=threshold)
        k = min(n, max(0, int(round(n * coalition))))
        coalition_idx = list(range(k))
        strategies = strategies_mixed(n, [("always_seller", k), ("honest", n - k)])
        outcome_counts = {"correct": 0, "wrong": 0, "void": 0}
        profits, slashings = [], []
        for r in range(reps):
            model = SchellingVotingModel(
                n, q, cfg, strategies, true_state=BUYER, turnout=turnout,
                forced_active=coalition_idx, seed=seed + combo_id * 1_000_003 + r,
            ).step()
            outcome_counts[model.outcome] += 1
            econ = attack_economics(model, coalition_idx, benefit)
            profits.append(econ["profit_eth"])
            slashings.append(econ["failed_slashing_eth"])
        profit, profit_lo, profit_hi = mean_ci(profits)
        rows.append({
            "model_version": MODEL_VERSION, "majority_bps": threshold,
            "threshold_fraction": threshold / 10000, "q": q, "n": n,
            "coalition_fraction_requested": coalition, "coalition_size": k,
            "coalition_fraction_realized": k / n, "honest_turnout": turnout,
            "correct_rate": outcome_counts["correct"] / reps,
            "wrong_rate": outcome_counts["wrong"] / reps,
            "void_rate": outcome_counts["void"] / reps,
            "expected_attack_profit_eth": profit,
            "attack_profit_ci95_low_eth": profit_lo,
            "attack_profit_ci95_high_eth": profit_hi,
            "expected_failed_slashing_eth": float(np.mean(slashings)),
            "success_benefit_if_wrong_eth": benefit,
            "refundable_stake_principal_eth": k * cfg.stake_eth,
            "nonref_identity_fee_eth": k * cfg.identity_fee_eth,
            "capital_opportunity_cost_eth": k * cfg.opportunity_cost_per_identity_eth,
            "gas_cost_eth": k * cfg.gas_per_identity_eth,
            "coordination_cost_eth": (cfg.coordination_fixed_eth if k else 0) + k * cfg.coordination_per_identity_eth,
            "reps": reps,
        })
    return pd.DataFrame(rows)


def fund_accounting(base_cfg, reps, seed):
    rng = np.random.default_rng(seed)
    rows = []
    strategies = ["honest", "invert", "always_buyer", "always_seller", "abstain"]
    for r in range(reps):
        n = int(rng.integers(3, 31))
        cfg = replace(base_cfg, majority_bps=int(rng.choice([5000, 6000, 6500, 6667, 7000])))
        model = SchellingVotingModel(
            n, float(rng.uniform(0.5, 0.95)), cfg,
            strategies=str(rng.choice(strategies)), turnout=float(rng.uniform(0.4, 1.0)),
            seed=seed + r,
        ).step()
        expected = -model.dust_wei() if model.effective else 0
        rows.append({
            "model_version": MODEL_VERSION, "case": r, "outcome": model.outcome,
            "sum_net_wei": model.sum_net_wei(), "expected_sum_net_wei": expected,
            "deviation_wei": model.sum_net_wei() - expected,
        })
    return pd.DataFrame(rows)


def repeated_reputation_experiment(cfg, q, n, rounds, reps, seed, reputation_values):
    """Minimal repeated-participation scenario, not a calibrated reputation system.

    A focal voter earns one reputation unit when it votes with a correct effective
    verdict. Utility is monetary settlement payoff plus the configured value per
    reputation unit. Abstention earns neither settlement payoff nor reputation.
    """
    rows = []
    for reputation_value in reputation_values:
        utility_diffs, money_diffs, reputation_diffs = [], [], []
        for rep in range(reps):
            honest_money = abstain_money = 0.0
            honest_rep = abstain_rep = 0.0
            for t in range(rounds):
                rng = np.random.default_rng(seed + rep * 100_003 + t)
                true_state = int(rng.integers(0, 2))
                correct = rng.random(n) < q
                signals = np.where(correct, true_state, 1 - true_state)
                active = np.zeros(n)
                honest = SchellingVotingModel(
                    n, q, cfg, strategies_mixed(n, [("honest", n)]), true_state,
                    signals=signals, active_draws=active,
                ).step()
                abstain = SchellingVotingModel(
                    n, q, cfg, strategies_mixed(n, [("honest", n - 1), ("abstain", 1)]),
                    true_state, signals=signals, active_draws=active,
                ).step()
                honest_money += honest.voters[-1].net_wei / WEI
                abstain_money += abstain.voters[-1].net_wei / WEI
                honest_rep += float(honest.outcome == "correct" and honest.voters[-1].vote == honest.winner)
                abstain_rep += float(abstain.outcome == "correct" and abstain.voters[-1].vote == abstain.winner)
            money_diff = honest_money - abstain_money
            rep_diff = honest_rep - abstain_rep
            money_diffs.append(money_diff)
            reputation_diffs.append(rep_diff)
            utility_diffs.append(money_diff + reputation_value * rep_diff)
        util, lo, hi = mean_ci(utility_diffs)
        rows.append({
            "model_version": MODEL_VERSION, "q": q, "n": n, "rounds": rounds,
            "reputation_value_eth_per_unit": reputation_value,
            "mean_money_honest_minus_abstain_eth": float(np.mean(money_diffs)),
            "mean_reputation_honest_minus_abstain": float(np.mean(reputation_diffs)),
            "mean_utility_honest_minus_abstain_eth": util,
            "utility_ci95_low_eth": lo, "utility_ci95_high_eth": hi, "reps": reps,
        })
    return pd.DataFrame(rows)


def save_plots(output, paired, factorial, repeated):
    plot_dir = output / "plots"
    plot_dir.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for strategy, group in paired.groupby("alternative"):
        ax.plot(group.q, group.paired_difference_alt_minus_honest_eth, marker="o", label=strategy)
    ax.axhline(0, color="black", lw=0.8)
    ax.set(xlabel="signal accuracy q", ylabel="alternative − honest payoff (ETH)", title="Paired one-round payoff differences")
    ax.legend(ncol=2)
    fig.tight_layout(); fig.savefig(plot_dir / "paired_payoffs.png", dpi=180); plt.close(fig)

    grouped = factorial.groupby("threshold_fraction")[["correct_rate", "wrong_rate", "void_rate"]].mean()
    fig, ax = plt.subplots(figsize=(7, 4.5))
    grouped.plot(ax=ax, marker="o")
    ax.axvline(0.65, color="gray", ls="--", label="65%")
    ax.set(xlabel="threshold", ylabel="mean rate across factorial cells", title="Correct / wrong / void remain distinct")
    fig.tight_layout(); fig.savefig(plot_dir / "factorial_outcomes.png", dpi=180); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.errorbar(repeated.reputation_value_eth_per_unit, repeated.mean_utility_honest_minus_abstain_eth,
                yerr=[repeated.mean_utility_honest_minus_abstain_eth - repeated.utility_ci95_low_eth,
                      repeated.utility_ci95_high_eth - repeated.mean_utility_honest_minus_abstain_eth], marker="o")
    ax.axhline(0, color="black", lw=0.8)
    ax.set(xlabel="reputation value (ETH/unit)", ylabel="honest − abstain utility (ETH)", title="Minimal repeated-participation incentive scenario")
    fig.tight_layout(); fig.savefig(plot_dir / "repeated_reputation.png", dpi=180); plt.close(fig)


def unique_output_dir(mode, seed, requested=None):
    if requested:
        path = Path(requested).resolve()
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = HERE / "results" / f"{MODEL_VERSION}_{mode}_seed{seed}_{stamp}"
    candidate, suffix = path, 1
    while candidate.exists():
        candidate = Path(f"{path}_{suffix}")
        suffix += 1
    candidate.mkdir(parents=True)
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="run the bounded quick suite")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--thresholds", default="5000,6500,6667")
    parser.add_argument("--qs", default="0.6,0.8")
    parser.add_argument("--ns", default="9,21")
    parser.add_argument("--coalitions", default="0,0.25,0.4")
    parser.add_argument("--turnouts", default="0.6,1.0")
    parser.add_argument("--success-benefit", type=float, default=5.0)
    parser.add_argument("--output-dir")
    args = parser.parse_args()

    mode = "quick" if args.quick else "full"
    reps = {"paired": 400, "factorial": 200, "fund": 500, "repeated": 200} if args.quick else {"paired": 3000, "factorial": 1500, "fund": 4000, "repeated": 1500}
    rounds = 20 if args.quick else 50
    cfg = MechanismConfig()
    output = unique_output_dir(mode, args.seed, args.output_dir)

    thresholds = parse_csv(args.thresholds, int)
    qs = parse_csv(args.qs, float)
    ns = parse_csv(args.ns, int)
    coalitions = parse_csv(args.coalitions, float)
    turnouts = parse_csv(args.turnouts, float)
    paired_qs = sorted(set(qs + [0.51, 0.7, 0.9]))

    print(f"[{mode}] model={MODEL_VERSION} output={output}")
    paired = paired_strategy_payoffs(cfg, paired_qs, 15, reps["paired"], args.seed)
    factorial = factorial_experiment(cfg, thresholds, qs, ns, coalitions, turnouts, reps["factorial"], args.seed, args.success_benefit)
    accounting = fund_accounting(cfg, reps["fund"], args.seed + 7_000_000)
    repeated = repeated_reputation_experiment(cfg, 0.7, 15, rounds, reps["repeated"], args.seed + 8_000_000, [0.0, 0.01, 0.05, 0.1])

    paired.to_csv(output / "paired_strategy_payoffs.csv", index=False)
    factorial.to_csv(output / "factorial_attack_economics.csv", index=False)
    accounting.to_csv(output / "fund_accounting.csv", index=False)
    repeated.to_csv(output / "repeated_reputation.csv", index=False)
    save_plots(output, paired, factorial, repeated)

    outcome_error = float((factorial[["correct_rate", "wrong_rate", "void_rate"]].sum(axis=1) - 1).abs().max())
    summary = {
        "model_version": MODEL_VERSION,
        "mode": mode,
        "seed": args.seed,
        "mechanism_config": asdict(cfg),
        "experiment_parameters": {
            "thresholds_bps": thresholds, "qs": qs, "ns": ns,
            "coalition_fractions": coalitions, "turnouts": turnouts,
            "success_benefit_eth": args.success_benefit, "repetitions": reps,
            "repeated_rounds": rounds,
        },
        "checks": {
            "max_outcome_partition_error": outcome_error,
            "max_fund_accounting_deviation_wei": int(accounting.deviation_wei.abs().max()),
        },
        "interpretation_warning": "Monte Carlo scenario evidence only; no theorem or equilibrium is proved.",
        "solidity_sync_status": "pending differential synchronization with the refactored Solidity contract",
    }
    (output / "run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary["checks"], indent=2))
    print("Quick/full suite complete. Old result files were not used or overwritten.")


if __name__ == "__main__":
    main()
