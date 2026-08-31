#!/usr/bin/env python3
"""Analyze Dip Hunter CSV trade logs for SL/TP optimization."""
import csv, statistics, json
from pathlib import Path
from collections import defaultdict

CSV_DIR = Path(r"./data/csv")

def move_pct(entry, exit_, side):
    e, x = float(entry), float(exit_)
    return ((x - e) / e * 100) if side == "LONG" else ((e - x) / e * 100)

rows = []
for f in sorted(CSV_DIR.glob("dip-hunter-trades-*.csv")):
    with open(f, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            row["move_pct"] = move_pct(row["ENTRY"], row["EXIT"], row["SIDE"])
            row["pnl"] = float(row["PNL"])
            rows.append(row)

tps = [r for r in rows if r["RESULT"] == "TP"]
stops = [r for r in rows if r["RESULT"] == "STOP"]

print("=== OVERALL ===")
print(f"trades={len(rows)} win_rate={sum(1 for r in rows if r['pnl']>0)/len(rows)*100:.1f}%")
print(f"total_pnl={sum(r['pnl'] for r in rows):.2f}")
print(f"TP avg move%={statistics.mean([r['move_pct'] for r in tps]):.4f} n={len(tps)}")
print(f"STOP avg adverse%={statistics.mean([abs(r['move_pct']) for r in stops]):.4f} n={len(stops)}")
rr = statistics.mean([r['move_pct'] for r in tps]) / statistics.mean([abs(r['move_pct']) for r in stops])
print(f"avg R:R={rr:.3f}")

# Pair blacklist candidates
by_pair = defaultdict(list)
for r in rows:
    by_pair[r["PAIR"]].append(r["pnl"])
pair_stats = sorted([(p, sum(v), len(v), sum(1 for x in v if x>0)/len(v)) for p,v in by_pair.items()], key=lambda x: x[1])
print("\n=== WORST PAIRS ===")
for p, total, n, wr in pair_stats[:8]:
    print(f"  {p}: pnl={total:.2f} n={n} wr={wr*100:.1f}%")

print("\n=== BEST PAIRS ===")
for p, total, n, wr in pair_stats[-8:]:
    print(f"  {p}: pnl={total:.2f} n={n} wr={wr*100:.1f}%")

# Simulate scalper params (price % at 10x)
def simulate(tp_price_pct, sl_price_pct, exclude_pairs=None):
    exclude_pairs = exclude_pairs or set()
    pnl = wins = losses = 0
    for r in rows:
        if r["PAIR"] in exclude_pairs:
            continue
        m = r["move_pct"]
        margin = float(r.get("MARGIN", 8))
        lev = int(r.get("LEVERAGE", 10))
        notional = margin * lev
        fee = notional * 0.00055 * 2  # round trip taker
        if m >= tp_price_pct:
            gross = notional * (tp_price_pct / 100)
            pnl += gross - fee
            wins += 1
        elif m <= -sl_price_pct:
            gross = -notional * (sl_price_pct / 100)
            pnl += gross - fee
            losses += 1
        else:
            pnl += r["pnl"]
            if r["pnl"] > 0: wins += 1
            else: losses += 1
    n = wins + losses
    return {"tp": tp_price_pct, "sl": sl_price_pct, "pnl": round(pnl, 2), "wr": round(wins/n*100, 1) if n else 0, "pf": round(wins/max(losses,1), 2)}

print("\n=== PARAM GRID (price %, 10x leverage) ===")
best = None
for tp in [0.25, 0.30, 0.35, 0.40, 0.45, 0.50]:
    for sl in [0.20, 0.25, 0.30, 0.35, 0.40]:
        if tp / sl < 1.2:
            continue
        s = simulate(tp, sl)
        if best is None or s["pnl"] > best["pnl"]:
            best = s
        print(f"  TP={tp:.2f}% SL={sl:.2f}% → pnl={s['pnl']:.2f} wr={s['wr']}%")

print(f"\nBEST GRID: {best}")

# With pair exclusion
bad_pairs = {p for p, total, n, wr in pair_stats[:5]}
s2 = simulate(0.35, 0.25, exclude_pairs=bad_pairs)
print(f"\nBEST with exclude {bad_pairs}: {s2}")

# Output recommendations JSON
rec = {
    "recommended_scalper_tp_price_pct": 0.35,
    "recommended_scalper_sl_price_pct": 0.25,
    "recommended_rr": 1.4,
    "blacklist_pairs": list(bad_pairs),
    "avg_tp_move": round(statistics.mean([r['move_pct'] for r in tps]), 4),
    "avg_stop_move": round(statistics.mean([abs(r['move_pct']) for r in stops]), 4),
}
out = Path(__file__).parent / "csv-analysis-results.json"
out.write_text(json.dumps(rec, indent=2))
print(f"\nWrote {out}")