const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";
const API_URL_SEARCH = "https://slpurukxtnleofuopadw.supabase.co/functions/v1/player-search-v2";
const API_URL_H2H    = "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";

let p1SearchResults = {}; // { tagString → player_idString }
let p2SearchResults = {};

let p1DebounceTimer = null;
let p2DebounceTimer = null;

window.addEventListener("DOMContentLoaded", () => {
  const p1Input = document.getElementById("p1-id");
  const p2Input = document.getElementById("p2-id");

  // Whenever Player 1 types, debounce and then call search
  p1Input.addEventListener("input", () => {
    clearTimeout(p1DebounceTimer);
    p1DebounceTimer = setTimeout(() => {
      performPlayerSearch(p1Input.value.trim(), "p1");
    }, 300); // 300ms debounce
  });

  // Whenever Player 2 types, debounce and then call search
  p2Input.addEventListener("input", () => {
    clearTimeout(p2DebounceTimer);
    p2DebounceTimer = setTimeout(() => {
      performPlayerSearch(p2Input.value.trim(), "p2");
    }, 300);
  });

  // Show datalist suggestions on focus (arrow-down hack)
  ["p1-id", "p2-id"].forEach((inputId) => {
    const inp = document.getElementById(inputId);
    inp.addEventListener("focus", () => {
      inp.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          keyCode: 40,
          which: 40,
        })
      );
    });
  });

  // Clear-button logic (×) for both inputs
  document.querySelectorAll(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = "";
        input.focus();
        // Also clear out any stored results for that input:
        if (targetId === "p1-id") {
          p1SearchResults = {};
          document.getElementById("p1-list").innerHTML = "";
        } else {
          p2SearchResults = {};
          document.getElementById("p2-list").innerHTML = "";
        }
      }
    });
  });

  // Form‐submit logic
  document.getElementById("h2h-form").addEventListener("submit", (event) => {
    event.preventDefault();

    // Read what’s currently in both inputs
    const rawP1 = document.getElementById("p1-id").value.trim();
    const rawP2 = document.getElementById("p2-id").value.trim();
    if (!rawP1 || !rawP2) return;

    // Resolve tag → player_id (if we have it); otherwise assume they typed a raw ID
    const p1Id = p1SearchResults[rawP1] || rawP1;
    const p2Id = p2SearchResults[rawP2] || rawP2;

    fetchH2HSets(p1Id, p2Id);
  });
});


// ─────────────────────────────────────────────────────────
// 1) performPlayerSearch(term, whichPlayer)
// ─────────────────────────────────────────────────────────
//
// Fetch from `/player-search-v2` with JSON: { sport: "melee", searchTerm: term, searchMode: "all-players" }
// Then populate the appropriate <datalist> (p1-list or p2-list) with options.
// Also update p1SearchResults or p2SearchResults to map each returned tag → its player_id.
// ─────────────────────────────────────────────────────────
async function performPlayerSearch(searchTerm, whichPlayer) {
  const listEl = document.getElementById(whichPlayer === "p1" ? "p1-list" : "p2-list");
  const resultsMap = whichPlayer === "p1" ? p1SearchResults : p2SearchResults;

  // Clear previous mapping & dropdown
  resultsMap = {};
  listEl.innerHTML = "";

  if (!searchTerm) {
    // If input is empty, don’t query; just clear the dropdown.
    return;
  }

  const payload = {
    sport: "melee",
    searchTerm: searchTerm,
    searchMode: "all-players",
  };

  try {
    const res = await fetch(API_URL_SEARCH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error("Player search failed:", res.status, await res.text());
      return;
    }

    const json = await res.json();
    // json.data is an array of objects, e.g. { tag: "a", player_id: "S2443527", num_events: 88, … }

    // Clear any old entries
    if (whichPlayer === "p1") {
      p1SearchResults = {};
    } else {
      p2SearchResults = {};
    }
    listEl.innerHTML = "";

    json.data.forEach((player) => {
      const tag = player.tag;
      const pid = player.player_id;
      const count = player.num_events;

      // Store mapping tag → player_id
      if (whichPlayer === "p1") {
        p1SearchResults[tag] = pid;
      } else {
        p2SearchResults[tag] = pid;
      }

      // Create an <option> so the dropdown shows “Tag (num_events)”
      // Browsers that support label on datalist options will display the label instead of value.
      const opt = document.createElement("option");
      opt.value = tag;
      // label is what shows in the dropdown. If the browser does not support label,
      // end‐users will still see “tag” but we want “tag (count)”.
      opt.label = `${tag} (${count})`;
      listEl.appendChild(opt);
    });
  } catch (err) {
    console.error("Error in performPlayerSearch():", err);
  }
}


// ─────────────────────────────────────────────────────────
// 2) fetchH2HSets(p1Id, p2Id)
// ─────────────────────────────────────────────────────────
//
// Exactly as before: POST to `/h2h-sheet-v2` with payload. Then render up to 5 lines.
// ─────────────────────────────────────────────────────────
async function fetchH2HSets(p1Id, p2Id) {
  const payload = {
    sport: "melee",
    p1PlayerId: p1Id,
    p2PlayerId: p2Id,
    tab: "matches",
    globalDateRange: "All Time",
    globalFilterContext: "All",
    filterToVods: false,
    filterToP1Wins: false,
    filterToP2Wins: false,
    sortBy: "date_desc",
    matchesTabSettings: {
      filterToP1Wins: false,
      filterToP2Wins: false,
      sortBy: "date_desc",
    },
    placementsTabSettings: {
      sortBy: "date_desc",
    },
  };

  try {
    const res = await fetch(API_URL_H2H, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Error fetching H2H:", res.status, txt);
      document.getElementById("results").innerText = "Error fetching data.";
      return;
    }

    const json = await res.json();
    const matches = (json?.data?.matches || []).filter(
      (m) => m.type === "match" && m.match
    );
    const container = document.getElementById("results");
    if (matches.length === 0) {
      container.innerText = "No matches found.";
      return;
    }

    const now = new Date();
    const lines = matches.slice(0, 5).map((m) => {
      const match = m.match;
      const p1 = match.p1_info;
      const p2 = match.p2_info;
      const date = new Date(match.event_info.start_date);
      const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      const dateStr =
        diffDays === 0
          ? "today"
          : `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
      const winner = p1.is_winner ? p1.tag : p2.tag;
      const loser = p1.is_winner ? p2.tag : p1.tag;
      return `${dateStr}: ${winner} beat ${loser}`;
    });

    container.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
  } catch (err) {
    document.getElementById("results").innerText = "Error fetching data.";
    console.error("fetchH2HSets() exception:", err);
  }
}
