#!/usr/bin/env python3
"""
update_players.py - Sync players.json from a tournament placements file.

Usage:
    python update_players.py <tournament.json> [players.json]

If players.json path is omitted, looks for players.json in the same folder
as this script. Creates players.json if it does not exist.

For each player in the tournament's placements array, checks whether their
tag (or any of their alternate_tags) already exists in players.json. If not,
adds a new entry with empty links and country.

Players schema:
[
  {
    "tag": "Wario",
    "alternate_tags": [],
    "country": "",
    "links": { "twitter": "", "twitch": "", "startgg": "" }
  }
]
"""

import sys
import json
import os


def load_players(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_players(players, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(players, f, indent=2, ensure_ascii=False)


def build_tag_index(players):
    """Return a set of all known tags and alternate_tags (lowercased for comparison)."""
    known = {}
    for p in players:
        known[p['tag'].lower()] = p['tag']
        for alt in p.get('alternate_tags', []):
            known[alt.lower()] = p['tag']
    return known


def main():
    if len(sys.argv) < 2:
        print("Usage: python update_players.py <tournament.json> [players.json]", file=sys.stderr)
        sys.exit(1)

    tournament_path = sys.argv[1]
    script_dir = os.path.dirname(os.path.abspath(__file__))
    players_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(script_dir, 'players.json')

    with open(tournament_path, encoding='utf-8') as f:
        tournament = json.load(f)

    placements = tournament.get('placements', [])
    if not placements:
        print("No placements found in tournament file.")
        sys.exit(0)

    players = load_players(players_path)
    created = not os.path.exists(players_path)
    known = build_tag_index(players)

    added = []
    for entry in placements:
        tag = entry['tag']
        if tag.lower() not in known:
            new_player = {
                "tag": tag,
                "alternate_tags": [],
                "country": "",
                "links": {
                    "twitter": "",
                    "twitch": "",
                    "startgg": ""
                }
            }
            players.append(new_player)
            known[tag.lower()] = tag
            added.append(tag)

    players.sort(key=lambda p: p['tag'].lower())
    save_players(players, players_path)

    if created:
        print(f"Created: {players_path}")
    print(f"Players in file: {len(players)}")
    if added:
        print(f"Added ({len(added)}):")
        for tag in added:
            print(f"  + {tag}")
    else:
        print("No new players — all tags already known.")


if __name__ == '__main__':
    main()
