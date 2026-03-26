#!/usr/bin/env python3
"""
compute_ratings.py - Compute Glicko-2 ratings from tournament set data.

Usage:
    python compute_ratings.py <sets_dir> <tournaments_dir> [players.json] [output_dir]

Defaults (relative to script location):
    sets_dir:        ./sets
    tournaments_dir: ./tournaments
    players.json:    ./players.json
    output_dir:      ./computed

Outputs:
    computed/ratings.json  - Glicko-2 rating snapshots after each tournament
    computed/h2h.json      - Head-to-head records between every player pair
    computed/stats.json    - Per-player career stats

DQ sets are excluded from all rating calculations but are counted in stats.

Rating approach:
  New players (no prior rating) are seeded from their final tournament
  placement before Glicko-2 runs. 1st place seeds at 1700, last place at
  1300, smooth curve in between scaled to field size. This gives the
  convergence loop a meaningful prior so established players aren't unfairly
  penalised by facing a strong newcomer who entered at a flat 1500.

  Established players always use their actual Glicko-2 prior — placement
  seeding only applies to first appearances.
"""

import sys
import json
import os
import math
from collections import defaultdict


# ---------------------------------------------------------------------------
# Glicko-2 constants
# ---------------------------------------------------------------------------

MU_0    = 1500.0
PHI_0   = 350.0
SIGMA_0 = 0.06
TAU     = 0.4
EPSILON = 0.000001
SCALE   = 173.7178

MAX_PASSES     = 200
CONVERGE_DELTA = 0.1

# Placement seeding parameters (new players only)
SEED_TOP    = 1700.0   # rating for 1st place
SEED_BOTTOM = 1300.0   # rating for last place
SEED_CURVE  = 0.6      # exponent — < 1 stretches top end, > 1 stretches bottom


def placement_seed(place, n):
    """
    Map a final placement to a starting rating.
    place: 1-indexed finishing position
    n: total entrants in the tournament
    """
    if n <= 1:
        return MU_0
    t = 1.0 - (place - 1) / (n - 1)   # 1.0 for 1st, 0.0 for last
    spread = SEED_TOP - SEED_BOTTOM
    return SEED_BOTTOM + spread * (t ** SEED_CURVE)


# ---------------------------------------------------------------------------
# Glicko-2 core
# ---------------------------------------------------------------------------

def to_g2(mu, phi):
    return (mu - MU_0) / SCALE, phi / SCALE


def to_display(mu, phi):
    return mu * SCALE + MU_0, phi * SCALE


def g(phi):
    return 1.0 / math.sqrt(1 + 3 * phi**2 / math.pi**2)


def E(mu, mu_j, phi_j):
    return 1.0 / (1 + math.exp(-g(phi_j) * (mu - mu_j)))


def glicko2_update(mu, phi, sigma, results):
    if not results:
        phi_new = min(math.sqrt(phi**2 + sigma**2), PHI_0 / SCALE)
        return mu, phi_new, sigma

    v_inv = sum(g(pj)**2 * E(mu, mj, pj) * (1 - E(mu, mj, pj))
                for mj, pj, _ in results)
    v = 1.0 / v_inv

    delta_sum = sum(g(pj) * (s - E(mu, mj, pj)) for mj, pj, s in results)
    delta = v * delta_sum

    a = math.log(sigma**2)

    def f(x):
        ex = math.exp(x)
        return (ex * (delta**2 - phi**2 - v - ex) /
                (2 * (phi**2 + v + ex)**2) - (x - a) / TAU**2)

    A = a
    if delta**2 > phi**2 + v:
        B = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0 and k < 100:
            k += 1
        B = a - k * TAU

    fA, fB = f(A), f(B)
    for _ in range(200):
        if abs(B - A) <= EPSILON:
            break
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB < 0:
            A, fA = B, fB
        else:
            fA /= 2
        B, fB = C, fC

    sigma_new = math.exp(A / 2)
    phi_star  = math.sqrt(phi**2 + sigma_new**2)
    phi_new   = 1.0 / math.sqrt(1.0 / phi_star**2 + 1.0 / v)
    mu_new    = mu + phi_new**2 * delta_sum

    return mu_new, phi_new, sigma_new


# ---------------------------------------------------------------------------
# Rating convergence
# ---------------------------------------------------------------------------

def run_tournament(playable, prior_states, dq_losses=None):
    """
    Compute converged ratings for one tournament period.
    prior_states already has placement seeds applied for new players.

    Pass 1: standard Glicko-2 (establishes RD/volatility).
    Passes 2+: freeze RD/volatility, iterate ratings until convergence.
    """
    period_players = set(t for ta, tb, _, __ in playable for t in (ta, tb))
    mu0, phi0 = to_g2(MU_0, PHI_0)

    def get_prior(tag):
        return prior_states.get(tag, [mu0, phi0, SIGMA_0])

    # Pass 1
    states = {}
    for tag in period_players:
        cur = get_prior(tag)
        results = [
            (get_prior(tb)[0], get_prior(tb)[1], oa) if ta == tag
            else (get_prior(ta)[0], get_prior(ta)[1], ob)
            for ta, tb, oa, ob in playable if ta == tag or tb == tag
        ]
        nm, np, ns = glicko2_update(cur[0], cur[1], cur[2], results)
        states[tag] = [nm, np, ns]

    frozen_phi   = {t: states[t][1] for t in period_players}
    frozen_sigma = {t: states[t][2] for t in period_players}

    # Passes 2+ — iterate ratings only, starting from each player's prior
    # (not from mu0=1500). This is critical: using mu0 would treat all
    # established players as 1500 during convergence, completely ignoring
    # their actual rating when computing expected outcomes.
    for _ in range(1, MAX_PASSES):
        new_states = {}
        for tag in period_players:
            phi, sigma = frozen_phi[tag], frozen_sigma[tag]
            prior_mu = get_prior(tag)[0]
            results = [
                (states[tb][0], frozen_phi[tb], oa) if ta == tag
                else (states[ta][0], frozen_phi[ta], ob)
                for ta, tb, oa, ob in playable if ta == tag or tb == tag
            ]
            nm, np, ns = glicko2_update(prior_mu, phi, sigma, results)
            new_states[tag] = [nm, frozen_phi[tag], frozen_sigma[tag]]

        max_delta = max(
            abs(to_display(new_states[t][0], 0)[0] -
                to_display(states[t][0], 0)[0])
            for t in period_players
        )
        states = new_states
        if max_delta < CONVERGE_DELTA:
            break

    # Apply DQ losses: each DQ'd player takes a half-penalty loss against
    # their actual opponent's converged rating. A score of 0.4 (part way
    # between 0=full loss and 0.5=draw) gives half the normal Glicko-2
    # penalty applied ON TOP of the converged rating — not from the prior.
    # Using the real opponent means losing to a strong player hurts less
    # than losing to a weak one, as expected.
    if dq_losses:
        mu0_g2, phi0_g2 = to_g2(MU_0, PHI_0)
        for tag, opp_tag in dq_losses:
            cur = states.get(tag)
            if cur is None:
                cur = [get_prior(tag)[0], phi0_g2, SIGMA_0]
            # Use opponent's converged rating if available, else their prior
            if opp_tag in states:
                opp_mu  = states[opp_tag][0]
                opp_phi = frozen_phi.get(opp_tag, states[opp_tag][1])
            else:
                opp_mu, opp_phi = get_prior(opp_tag)[:2]
            # Start from converged rating (cur[0]), not prior, so the penalty
            # applies on top of what they actually earned in real sets
            nm, np, ns = glicko2_update(
                cur[0],
                frozen_phi.get(tag, cur[1]),
                SIGMA_0,
                [(opp_mu, opp_phi, 0.4)]  # half-penalty vs actual opponent
            )
            states[tag] = [nm, frozen_phi.get(tag, cur[1]), SIGMA_0]

    return states


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def build_alt_index(players):
    index = {}
    for p in players:
        index[p['tag'].lower()] = p['tag']
        for alt in p.get('alternate_tags', []):
            index[alt.lower()] = p['tag']
    return index


def resolve(tag, alt_index):
    return alt_index.get(tag.lower(), tag)


def is_dq(s):
    return s.get('score_a') == 'DQ' or s.get('score_b') == 'DQ'


def set_outcome(s):
    if is_dq(s):
        return None
    sa, sb = s.get('score_a'), s.get('score_b')
    if sa == 'W' or sb == 'L':   return 1.0, 0.0
    if sb == 'W' or sa == 'L':   return 0.0, 1.0
    if isinstance(sa, (int, float)) and isinstance(sb, (int, float)):
        if sa > sb: return 1.0, 0.0
        if sb > sa: return 0.0, 1.0
        return 0.5, 0.5
    return None


def h2h_key(a, b):
    return tuple(sorted([a, b]))


def round_weight(round_name):
    """
    Return a weight multiplier for a set based on its round.
    Pool sets are baseline 1.0. Bracket rounds increase toward finals.
    This ensures a Grand Final loss doesn't disproportionately punish
    a player who ran the entire winners bracket to get there.
    """
    r = round_name.lower()
    if 'pool' in r:                    return 1.0
    if 'round 1' in r:                 return 1.1
    if 'round 2' in r:                 return 1.15
    if 'round 3' in r:                 return 1.2
    if 'quarter' in r:                 return 1.25
    if 'semi' in r:                    return 1.35
    if 'final' in r and 'grand' not in r: return 1.5
    if 'grand final reset' in r:       return 1.6
    if 'grand final' in r:             return 1.6
    return 1.0


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def run_pipeline(tournaments, sets_dir, alt_index, retroactive=False, season_ratings=None):
    """
    Process all tournaments and return (snapshots, h2h, stats_acc).

    retroactive=False  — sequential: each tournament uses ratings from all
                         prior tournaments as priors (standard Glicko-2).

    retroactive=True   — retroactive: before processing tournament N, reset
                         global ratings and reprocess tournaments 1..N-1 from
                         scratch. This means every snapshot is computed with
                         full-season context, so early wins against players who
                         later prove strong are correctly valued.
    """
    mu0, phi0 = to_g2(MU_0, PHI_0)

    h2h = defaultdict(lambda: {"wins": [0, 0], "sets": 0, "by_tournament": {}})
    stats_acc = defaultdict(lambda: {
        "sets_won": 0, "sets_lost": 0, "sets_total": 0,
        "tournaments": 0, "placements": [],
        "peak_rating": None, "peak_rating_after": None,
    })
    snapshots = []

    def process_tournaments_up_to(idx, existing_h2h=None, existing_stats=None):
        """Process tournaments[0..idx] and return global_ratings."""
        gr = {}
        for tournament in tournaments[:idx + 1]:
            gr = process_one_tournament(tournament, gr, sets_dir, alt_index,
                                        mu0, phi0, existing_h2h, existing_stats)
        return gr

    def process_one_tournament(tournament, global_ratings, sets_dir, alt_index,
                                mu0, phi0, h2h_acc=None, stats_acc_=None,
                                season_ratings=None):
        tid        = tournament['id']
        n_entrants = tournament.get('entrant_count', 0)
        sets_path  = os.path.join(sets_dir, f"{tid}.json")
        if not os.path.exists(sets_path):
            return global_ratings

        raw_sets      = load_json(sets_path)
        placement_map = {resolve(p['tag'], alt_index): p['place']
                         for p in tournament.get('placements', [])}

        playable  = []
        dq_losses = []
        dq_count  = 0
        players_with_real_sets = set()

        for s in raw_sets:
            outcome = set_outcome(s)
            tag_a   = resolve(s['player_a'], alt_index)
            tag_b   = resolve(s['player_b'], alt_index)
            if outcome is None:
                dq_count += 1
                if is_dq(s):
                    if s.get('score_b') == 'DQ':
                        dq_losses.append((tag_b, tag_a))
                        if stats_acc_ is not None:
                            stats_acc_[tag_b]['sets_lost']  += 1
                            stats_acc_[tag_b]['sets_total'] += 1
                    elif s.get('score_a') == 'DQ':
                        dq_losses.append((tag_a, tag_b))
                        if stats_acc_ is not None:
                            stats_acc_[tag_a]['sets_lost']  += 1
                            stats_acc_[tag_a]['sets_total'] += 1
                continue
            playable.append((tag_a, tag_b, outcome[0], outcome[1]))
            players_with_real_sets.add(tag_a)
            players_with_real_sets.add(tag_b)

        period_players = set(t for ta, tb, _, __ in playable for t in (ta, tb))

        if stats_acc_ is not None:
            for tag_a, tag_b, oa, ob in playable:
                stats_acc_[tag_a]['sets_total'] += 1
                stats_acc_[tag_b]['sets_total'] += 1
                if oa > ob:
                    stats_acc_[tag_a]['sets_won']  += 1
                    stats_acc_[tag_b]['sets_lost'] += 1
                elif ob > oa:
                    stats_acc_[tag_b]['sets_won']  += 1
                    stats_acc_[tag_a]['sets_lost'] += 1

        if h2h_acc is not None:
            for tag_a, tag_b, oa, ob in playable:
                key = h2h_key(tag_a, tag_b)
                entry = h2h_acc[key]
                is_a_first = key[0] == tag_a
                if tid not in entry['by_tournament']:
                    entry['by_tournament'][tid] = {"wins": [0, 0], "sets": 0}
                bt = entry['by_tournament'][tid]
                entry['sets'] += 1
                bt['sets']    += 1
                if oa > ob:
                    idx_ = 0 if is_a_first else 1
                    entry['wins'][idx_] += 1
                    bt['wins'][idx_]    += 1
                elif ob > oa:
                    idx_ = 1 if is_a_first else 0
                    entry['wins'][idx_] += 1
                    bt['wins'][idx_]    += 1

        established_ratings = [
            to_display(global_ratings[t][0], 0)[0]
            for t in period_players if t in global_ratings
        ]
        has_established = len(established_ratings) > 0

        if season_ratings is not None:
            # Retroactive mode: use median of ALL players in this field's
            # final season ratings as the ceiling. This means a stacked field
            # gets a higher ceiling even if most players were new at the time.
            field_season_ratings = sorted([
                season_ratings[t] for t in period_players if t in season_ratings
            ])
            if field_season_ratings:
                seed_top = field_season_ratings[len(field_season_ratings) // 2]
            else:
                seed_top = SEED_TOP
            has_established = True  # always seed from placement in retroactive mode
        elif has_established:
            sorted_est = sorted(established_ratings)
            seed_top = sorted_est[len(sorted_est) // 2]
        else:
            seed_top = SEED_TOP

        prior = {}
        for tag in period_players:
            if tag in global_ratings:
                prior[tag] = global_ratings[tag][:3]
            else:
                place = placement_map.get(tag)
                if has_established and place is not None and n_entrants > 1:
                    t_norm = 1.0 - (place - 1) / (n_entrants - 1)
                    seed_mu = SEED_BOTTOM + (seed_top - SEED_BOTTOM) * (t_norm ** SEED_CURVE)
                    seed_mu_g2, _ = to_g2(seed_mu, 0)
                    prior[tag] = [seed_mu_g2, phi0, SIGMA_0]
                else:
                    prior[tag] = [mu0, phi0, SIGMA_0]

        new_ratings = run_tournament(playable, prior, dq_losses)

        # RD decay for absent players
        for tag, st in global_ratings.items():
            if tag not in period_players:
                phi_d = min(math.sqrt(st[1]**2 + st[2]**2), PHI_0 / SCALE)
                global_ratings[tag][1] = phi_d

        all_tournament_players = set(period_players)
        for s in raw_sets:
            if is_dq(s):
                all_tournament_players.add(resolve(s['player_a'], alt_index))
                all_tournament_players.add(resolve(s['player_b'], alt_index))

        for tag in period_players:
            nr   = new_ratings[tag]
            prev = global_ratings.get(tag, [mu0, phi0, SIGMA_0, 0, 0])
            set_count = sum(1 for ta, tb, _, __ in playable if ta == tag or tb == tag)
            global_ratings[tag] = [nr[0], nr[1], nr[2], prev[3] + set_count, prev[4] + 1]

        if stats_acc_ is not None:
            for tag in all_tournament_players:
                if tag in players_with_real_sets:
                    stats_acc_[tag]['tournaments'] += 1
                    place = placement_map.get(tag)
                    if place is not None:
                        stats_acc_[tag]['placements'].append({"tournament": tid, "place": place})

        return global_ratings

    # ── Main loop ──
    global_ratings = {}
    for i, tournament in enumerate(tournaments):
        tid  = tournament['id']
        date = tournament['date']
        name = tournament['name']

        sets_path = os.path.join(sets_dir, f"{tid}.json")
        if not os.path.exists(sets_path):
            print(f"  WARNING: no sets file for {tid}, skipping", file=sys.stderr)
            continue

        if retroactive and i > 0:
            # For the retroactive snapshot of tournament i, reprocess all
            # prior tournaments from scratch using the same logic, but without
            # accumulating h2h/stats (those come from the sequential pass).
            # This gives us ratings for tournaments 0..i-1 that already reflect
            # the full context of who those players turned out to be.
            retroactive_ratings = {}
            for j, prior_t in enumerate(tournaments[:i]):
                prior_path = os.path.join(sets_dir, f"{prior_t['id']}.json")
                if os.path.exists(prior_path):
                    retroactive_ratings = process_one_tournament(
                        prior_t, retroactive_ratings, sets_dir, alt_index,
                        mu0, phi0, None, None, season_ratings
                    )
            global_ratings = retroactive_ratings

        global_ratings = process_one_tournament(
            tournament, global_ratings, sets_dir, alt_index,
            mu0, phi0, h2h, stats_acc, season_ratings
        )

        ranked = sorted(
            [{"tag": tag, "rank": 0,
              "rating":      round(to_display(st[0], 0)[0], 2),
              "rd":          round(to_display(0, st[1])[1], 2),
              "volatility":  round(st[2], 6),
              "sets":        st[3],
              "tournaments": st[4]}
             for tag, st in global_ratings.items()],
            key=lambda x: x['rating'], reverse=True
        )
        for i_, p in enumerate(ranked):
            p['rank'] = i_ + 1

        for entry in ranked:
            tag, rating = entry['tag'], entry['rating']
            if stats_acc[tag]['peak_rating'] is None or rating > stats_acc[tag]['peak_rating']:
                stats_acc[tag]['peak_rating']       = rating
                stats_acc[tag]['peak_rating_after'] = tid

        snapshots.append({"after": tid, "name": name, "date": date, "ratings": ranked})
        mode = "retroactive" if retroactive else "sequential"
        print(f"  [{mode}] {name} ({date}): {len(ranked)} players")

    return snapshots, h2h, stats_acc


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))

    sets_dir        = sys.argv[1] if len(sys.argv) > 1 else os.path.join(script_dir, 'sets')
    tournaments_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(script_dir, 'tournaments')
    players_path    = sys.argv[3] if len(sys.argv) > 3 else os.path.join(script_dir, 'players.json')
    output_dir      = sys.argv[4] if len(sys.argv) > 4 else os.path.join(script_dir, 'computed')

    players   = load_json(players_path) if os.path.exists(players_path) else []
    alt_index = build_alt_index(players)

    tournaments = []
    for fname in sorted(os.listdir(tournaments_dir)):
        if fname.endswith('.json'):
            tournaments.append(load_json(os.path.join(tournaments_dir, fname)))
    tournaments.sort(key=lambda t: t['date'])

    os.makedirs(output_dir, exist_ok=True)

    # ── Run both pipelines ──
    print("Running sequential pipeline...")
    seq_snaps, seq_h2h, seq_stats = run_pipeline(tournaments, sets_dir, alt_index, retroactive=False)

    # Build season_ratings: each player's rating after their last attended tournament.
    # Used by the retroactive pass to set informed seed ceilings even for tournament 1.
    season_ratings = {}
    for snap in seq_snaps:
        for p in snap['ratings']:
            # Overwrite each time — last snapshot where player appears wins
            season_ratings[p['tag']] = p['rating']

    print("Running retroactive pipeline...")
    ret_snaps, _, _ = run_pipeline(tournaments, sets_dir, alt_index,
                                    retroactive=True, season_ratings=season_ratings)

    # ── Write ratings files ──
    seq_path = os.path.join(output_dir, 'ratings.json')
    with open(seq_path, 'w', encoding='utf-8') as f:
        json.dump({"snapshots": seq_snaps}, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {seq_path}")

    ret_path = os.path.join(output_dir, 'ratings-retroactive.json')
    with open(ret_path, 'w', encoding='utf-8') as f:
        json.dump({"snapshots": ret_snaps}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {ret_path}")

    # ── H2H (same for both — based on actual results, not ratings) ──
    h2h_out = [{"players": list(k), "wins": v['wins'], "sets": v['sets'],
                 "by_tournament": {t: {"wins": b['wins'], "sets": b['sets']}
                                   for t, b in v['by_tournament'].items()}}
               for k, v in sorted(seq_h2h.items())]
    h2h_path = os.path.join(output_dir, 'h2h.json')
    with open(h2h_path, 'w', encoding='utf-8') as f:
        json.dump(h2h_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {h2h_path}  ({len(h2h_out)} pairs)")

    # ── Stats (use sequential ratings as current_rating/rank baseline) ──
    final_ratings = {}
    for entry in seq_snaps[-1]['ratings']:
        final_ratings[entry['tag']] = {'rating': entry['rating'],
                                        'rd': entry['rd'], 'rank': entry['rank']}

    stats_out = []
    for tag in sorted(set(seq_stats.keys()) | set(final_ratings.keys())):
        acc = seq_stats[tag]
        fr  = final_ratings.get(tag)
        st  = acc['sets_total']
        sw  = acc['sets_won']
        pl  = sorted(acc['placements'], key=lambda p: p['tournament'])
        stats_out.append({
            "tag": tag, "tournaments": acc['tournaments'],
            "sets_total": st, "sets_won": sw, "sets_lost": acc['sets_lost'],
            "win_rate": round(sw / st, 4) if st else 0,
            "best_placement": min((p['place'] for p in pl), default=None),
            "placements": pl,
            "peak_rating": acc['peak_rating'],
            "peak_rating_after": acc['peak_rating_after'],
            "current_rating": fr['rating'] if fr else None,
            "current_rd":     fr['rd']     if fr else None,
            "current_rank":   fr['rank']   if fr else None,
        })

    stats_out.sort(key=lambda x: x['current_rank'] if x['current_rank'] else 9999)
    stats_path = os.path.join(output_dir, 'stats.json')
    with open(stats_path, 'w', encoding='utf-8') as f:
        json.dump(stats_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {stats_path}  ({len(stats_out)} players)")


if __name__ == '__main__':
    main()
