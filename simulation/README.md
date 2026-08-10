# Stake-voting simulation

This directory contains **model `stake-vote-econ-v2.0.0`**, a reproducible Monte Carlo characterization of a configurable stake-voting mechanism. It does not prove a theorem, an equilibrium, or security at a universal coalition threshold.

## Corrections embodied in v2

- Refundable stake principal is reported but is **not automatically counted as attack cost**. Economic profit separately includes settlement gains/losses, benefit from a successful wrong verdict, failed slashing, non-refundable identity fees, capital opportunity cost, gas, and coordination costs.
- Honest one-round monetary payoff can be below the zero payoff from abstaining. The paired experiment reports `alternative − honest` with a 95% confidence interval rather than assuming honesty is a best response.
- `6500 bps` means **65%**, not two thirds. Exact two-thirds-style integer configuration is represented separately by `6667 bps`.
- Every aggregate keeps `correct_rate`, `wrong_rate`, and `void_rate` separate. A void verdict is not counted as incorrect or correct.
- Results are empirical scenario estimates only. No output is labelled as proof or theorem validation.

## Reproducible entry point

Python 3.11 is recommended. From this directory:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python experiments.py --quick
```

The quick suite uses seed `20260810`, bounded repetitions, and runs all experiments. A full run uses the same entry point without `--quick`:

```bash
.venv/Scripts/python experiments.py
```

Each invocation creates a new directory under `results/` containing CSVs, plots, and `run_summary.json`; it never treats the legacy `exp1`–`exp5` files as fresh validation and does not overwrite them. Use `--output-dir PATH` for an explicit new destination (the command refuses to reuse it and adds a suffix).

## Central mechanism configuration

`MechanismConfig` in `model.py` is the single source of mechanism/economic defaults:

| Parameter | Default | Meaning |
|---|---:|---|
| `model_version` | `stake-vote-econ-v2.0.0` | Schema/semantics identifier |
| `stake_eth` | 1.0 | Refundable principal unless slashed |
| `majority_bps` | 6500 | 65% directional-vote threshold |
| `min_directional_votes` | 3 | Minimum BUYER+SELLER votes |
| `identity_fee_eth` | 0.10 | Non-refundable identity fee |
| `capital_annual_rate` | 8% | Opportunity-cost assumption |
| `lock_days` | 7 | Capital lock duration |
| `gas_per_identity_eth` | 0.003 | Per-identity transaction cost |
| `coordination_fixed_eth` | 0.05 | Fixed coalition coordination cost |
| `coordination_per_identity_eth` | 0.002 | Variable coordination cost |

The attack profit identity is:

```text
profit = I(wrong effective verdict) × success benefit
       + coalition settlement net payoff
       - non-refundable identity fees
       - capital opportunity cost
       - gas cost
       - coordination cost
```

Failed slashing is exposed as a separate diagnostic and is already part of settlement net payoff, so it is not deducted twice. Stake principal is shown as `refundable_stake_principal_eth`, not called a sunk cost.

## Experiments and outputs

1. **Paired strategy payoff differences** (`paired_strategy_payoffs.csv`): common random numbers compare a focal alternative to honest voting. It reports `alternative − honest`, its 95% normal CI, and correct/wrong/void rates.
2. **Configurable factorial experiment** (`factorial_attack_economics.csv`): threshold × signal accuracy `q` × electorate size `n` × coalition fraction × honest turnout. Coordinated coalition identities always turn out; turnout applies to ordinary voters.
3. **Fund accounting** (`fund_accounting.csv`): checks settlement net payoff against integer-division dust for random paths.
4. **Repeated participation/reputation** (`repeated_reputation.csv`): a deliberately minimal, uncalibrated experiment. A focal honest voter gains one reputation unit only when it votes with a correct effective verdict; abstention gains none. Several assumed ETH values per reputation unit show when this added utility may offset weaker one-round monetary incentives.

The factorial dimensions are CLI-configurable:

```bash
python experiments.py --quick \
  --thresholds 5000,6500,6667 \
  --qs 0.6,0.8 \
  --ns 9,21 \
  --coalitions 0,0.25,0.4 \
  --turnouts 0.6,1.0 \
  --success-benefit 5
```

Coalition fractions are converted to integer coalition sizes with `round(n × fraction)` and both requested and realized fractions are saved.

## Model boundary and pending Solidity synchronization

The contract is being refactored in parallel, so this version intentionally does **not** claim byte-for-byte parity. After the new Solidity contract stabilizes, add differential fixtures for at least:

- threshold rounding and tie/winner priority at 6500 and 6667 bps;
- whether abstainers register/lock stake and how they are refunded;
- the exact minimum-voter denominator (directional votes versus all participants);
- void, correct effective, and wrong effective settlement paths;
- winner reward integer division, residual dust, and claim timing;
- identity-fee destination/refundability and stake lock duration;
- turnout/eligibility representation and duplicate-identity constraints;
- gas measurements and any on-chain reputation update rules.

Until those fixtures pass, `stake-vote-econ-v2.0.0` is an explicit economic reference model, not a claim about the final Solidity implementation.
