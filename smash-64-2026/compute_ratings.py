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
    """Return (score_a, score_b) as floats, or None to skip."""
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
    """Canonical sorted key for a player pair."""
    return tuple(sorted([a, b]))


# ---------------------------------------------------------------------------
# Rating convergence
# ---------------------------------------------------------------------------

def run_tournament(playable, prior_states):
    period_players = set(t for ta, tb, _, __ in playable for t in (ta, tb))
    mu0, phi0 = to_g2(MU_0, PHI_0)

    def get_prior(tag):
        return prior_states.get(tag, [mu0, phi0, SIGMA_0])

    # Pass 1: standard Glicko-2
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

    # Passes 2+: iterate ratings only
    for _ in range(1, MAX_PASSES):
        new_states = {}
        for tag in period_players:
            phi, sigma = frozen_phi[tag], frozen_sigma[tag]
            results = [
                (states[tb][0], frozen_phi[tb], oa) if ta == tag
                else (states[ta][0], frozen_phi[ta], ob)
                for ta, tb, oa, ob in playable if ta == tag or tb == tag
            ]
            nm, np, ns = glicko2_update(mu0, phi, sigma, results)
            new_states[tag] = [nm, frozen_phi[tag], frozen_sigma[tag]]

        max_delta = max(
            abs(to_display(new_states[t][0], 0)[0] -
                to_display(states[t][0], 0)[0])
            for t in period_players
        )
        states = new_states
        if max_delta < CONVERGE_DELTA:
            break

    return states


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

    # --- Persistent state ---
    mu0, phi0 = to_g2(MU_0, PHI_0)
    global_ratings = {}   # tag -> [mu, phi, sigma, sets, tournaments]

    # H2H: (tag_a, tag_b) sorted -> {wins_a, wins_b, sets, tournaments: {tid: {wins_a, wins_b, sets}}}
    h2h = defaultdict(lambda: {
        "wins": [0, 0],
        "sets": 0,
        "by_tournament": {}
    })

    # Stats accumulators per player
    # We'll track: sets_won, sets_lost, sets_total, tournaments, placements,
    #              best_placement, peak_rating, peak_rating_after
    stats_acc = defaultdict(lambda: {
        "sets_won":       0,
        "sets_lost":      0,
        "sets_total":     0,
        "tournaments":    0,
        "placements":     [],   # list of {tournament, place}
        "peak_rating":    None,
        "peak_rating_after": None,
    })

    snapshots = []

    for tournament in tournaments:
        tid  = tournament['id']
        date = tournament['date']
        name = tournament['name']

        sets_path = os.path.join(sets_dir, f"{tid}.json")
        if not os.path.exists(sets_path):
            print(f"  WARNING: no sets file for {tid}, skipping", file=sys.stderr)
            continue

        raw_sets = load_json(sets_path)

        # Build placement lookup for this tournament
        placement_map = {resolve(p['tag'], alt_index): p['place'] for p in tournament.get('placements', [])}

        # Separate DQ and playable sets
        playable = []
        dq_count = 0
        for s in raw_sets:
            outcome = set_outcome(s)
            tag_a = resolve(s['player_a'], alt_index)
            tag_b = resolve(s['player_b'], alt_index)
            if outcome is None:
                dq_count += 1
                # Still count DQ in stats (as a loss for the DQ'd player)
                if is_dq(s):
                    if s.get('score_b') == 'DQ':
                        stats_acc[tag_a]['sets_won']   += 1
                        stats_acc[tag_a]['sets_total'] += 1
                        stats_acc[tag_b]['sets_lost']  += 1
                        stats_acc[tag_b]['sets_total'] += 1
                    elif s.get('score_a') == 'DQ':
                        stats_acc[tag_b]['sets_won']   += 1
                        stats_acc[tag_b]['sets_total'] += 1
                        stats_acc[tag_a]['sets_lost']  += 1
                        stats_acc[tag_a]['sets_total'] += 1
                continue
            playable.append((tag_a, tag_b, outcome[0], outcome[1]))

        period_players = set(t for ta, tb, _, __ in playable for t in (ta, tb))

        # --- Update stats from playable sets ---
        for tag_a, tag_b, oa, ob in playable:
            stats_acc[tag_a]['sets_total'] += 1
            stats_acc[tag_b]['sets_total'] += 1
            if oa > ob:
                stats_acc[tag_a]['sets_won']  += 1
                stats_acc[tag_b]['sets_lost'] += 1
            elif ob > oa:
                stats_acc[tag_b]['sets_won']  += 1
                stats_acc[tag_a]['sets_lost'] += 1

        # --- Update H2H from playable sets ---
        for tag_a, tag_b, oa, ob in playable:
            key = h2h_key(tag_a, tag_b)
            entry = h2h[key]
            is_a_first = key[0] == tag_a

            if tid not in entry['by_tournament']:
                entry['by_tournament'][tid] = {"wins": [0, 0], "sets": 0}
            bt = entry['by_tournament'][tid]

            entry['sets'] += 1
            bt['sets']    += 1

            if oa > ob:   # tag_a won
                idx = 0 if is_a_first else 1
                entry['wins'][idx] += 1
                bt['wins'][idx]    += 1
            elif ob > oa: # tag_b won
                idx = 1 if is_a_first else 0
                entry['wins'][idx] += 1
                bt['wins'][idx]    += 1

        # --- Ratings ---
        prior = {t: global_ratings[t][:3] for t in global_ratings}
        new_ratings = run_tournament(playable, prior)

        # RD decay for absent players
        for tag, st in global_ratings.items():
            if tag not in period_players:
                phi_d = min(math.sqrt(st[1]**2 + st[2]**2), PHI_0 / SCALE)
                global_ratings[tag][1] = phi_d

        # Commit ratings and update tournament counts
        all_tournament_players = set()
        for tag_a, tag_b, _, __ in playable:
            all_tournament_players.add(tag_a)
            all_tournament_players.add(tag_b)
        # Also include DQ players in tournament count
        for s in raw_sets:
            if is_dq(s):
                all_tournament_players.add(resolve(s['player_a'], alt_index))
                all_tournament_players.add(resolve(s['player_b'], alt_index))

        for tag in period_players:
            nr  = new_ratings[tag]
            prev = global_ratings.get(tag, [mu0, phi0, SIGMA_0, 0, 0])
            set_count = sum(1 for ta, tb, _, __ in playable if ta == tag or tb == tag)
            global_ratings[tag] = [
                nr[0], nr[1], nr[2],
                prev[3] + set_count,
                prev[4] + 1
            ]

        for tag in all_tournament_players:
            stats_acc[tag]['tournaments'] += 1
            place = placement_map.get(tag)
            # Also check alternate tags for placement lookup

            if place is not None:
                stats_acc[tag]['placements'].append({
                    "tournament": tid,
                    "place": place
                })

        # --- Build ratings snapshot ---
        ranked = sorted(
            [
                {
                    "tag":         tag,
                    "rank":        0,
                    "rating":      round(to_display(st[0], 0)[0], 2),
                    "rd":          round(to_display(0, st[1])[1], 2),
                    "volatility":  round(st[2], 6),
                    "sets":        st[3],
                    "tournaments": st[4],
                }
                for tag, st in global_ratings.items()
            ],
            key=lambda x: x['rating'],
            reverse=True
        )
        for i, p in enumerate(ranked):
            p['rank'] = i + 1

        # Update peak rating in stats
        for entry in ranked:
            tag = entry['tag']
            rating = entry['rating']
            if (stats_acc[tag]['peak_rating'] is None or
                    rating > stats_acc[tag]['peak_rating']):
                stats_acc[tag]['peak_rating']       = rating
                stats_acc[tag]['peak_rating_after'] = tid

        snapshots.append({
            "after":   tid,
            "name":    name,
            "date":    date,
            "ratings": ranked,
        })

        print(f"  {name} ({date}): {len(playable)} sets rated, "
              f"{dq_count} DQ skipped, {len(period_players)} players")

    # --- Write ratings.json ---
    os.makedirs(output_dir, exist_ok=True)
    ratings_path = os.path.join(output_dir, 'ratings.json')
    with open(ratings_path, 'w', encoding='utf-8') as f:
        json.dump({"snapshots": snapshots}, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {ratings_path}")

    # --- Write h2h.json ---
    # Convert to a list keyed by sorted player pair for easy lookup
    h2h_out = []
    for (pa, pb), data in sorted(h2h.items()):
        h2h_out.append({
            "players": [pa, pb],
            "wins":    data['wins'],        # [pa_wins, pb_wins]
            "sets":    data['sets'],
            "by_tournament": {
                tid: {
                    "wins": bt['wins'],
                    "sets": bt['sets']
                }
                for tid, bt in data['by_tournament'].items()
            }
        })

    h2h_path = os.path.join(output_dir, 'h2h.json')
    with open(h2h_path, 'w', encoding='utf-8') as f:
        json.dump(h2h_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {h2h_path}  ({len(h2h_out)} pairs)")

    # --- Write stats.json ---
    # Get final rating for each player from last snapshot
    final_ratings = {}
    if snapshots:
        for entry in snapshots[-1]['ratings']:
            final_ratings[entry['tag']] = {
                'rating': entry['rating'],
                'rd':     entry['rd'],
                'rank':   entry['rank'],
            }

    stats_out = []
    all_tags = set(stats_acc.keys()) | set(final_ratings.keys())
    for tag in sorted(all_tags):
        acc = stats_acc[tag]
        fr  = final_ratings.get(tag)
        sets_total = acc['sets_total']
        sets_won   = acc['sets_won']
        placements = sorted(acc['placements'], key=lambda p: p['tournament'])
        best_place = min((p['place'] for p in placements), default=None)

        stats_out.append({
            "tag":              tag,
            "tournaments":      acc['tournaments'],
            "sets_total":       sets_total,
            "sets_won":         sets_won,
            "sets_lost":        acc['sets_lost'],
            "win_rate":         round(sets_won / sets_total, 4) if sets_total else 0,
            "best_placement":   best_place,
            "placements":       placements,
            "peak_rating":      acc['peak_rating'],
            "peak_rating_after": acc['peak_rating_after'],
            "current_rating":   fr['rating'] if fr else None,
            "current_rd":       fr['rd']     if fr else None,
            "current_rank":     fr['rank']   if fr else None,
        })

    stats_out.sort(key=lambda x: x['current_rank'] if x['current_rank'] else 9999)

    stats_path = os.path.join(output_dir, 'stats.json')
    with open(stats_path, 'w', encoding='utf-8') as f:
        json.dump(stats_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {stats_path}  ({len(stats_out)} players)")


if __name__ == '__main__':
    main()
