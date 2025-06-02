const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

const SUPABASE_SEARCH_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

const API_URL_SEARCH =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/player-search-v2";
const API_URL_H2H =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";
// We’ll map the exact displayString → player_id
let p1SearchResults = {};
let p2SearchResults = {};

let p1DebounceTimer = null;
let p2DebounceTimer = null;

window.addEventListener("DOMContentLoaded", () => {
  const p1Input = document.getElementById("p1-id");
  const p2Input = document.getElementById("p2-id");

  // Whenever Player 1 types, debounce then search
  p1Input.addEventListener("input", () => {
    clearTimeout(p1DebounceTimer);
    p1DebounceTimer = setTimeout(() => {
      performPlayerSearch(p1Input.value.trim(), "p1");
    }, 300);
  });

  // Whenever Player 2 types, debounce then search
  p2Input.addEventListener("input", () => {
    clearTimeout(p2DebounceTimer);
    p2DebounceTimer = setTimeout(() => {
      performPlayerSearch(p2Input.value.trim(), "p2");
    }, 300);
  });

  // Show datalist as soon as input is focused (ArrowDown hack)
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

  // Clear‐button (“×”) logic for both inputs
  document.querySelectorAll(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = "";
        input.focus();
        // Clear mapping and dropdown for that player
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

  // Form submission: look up exact displayString → player_id, then fetch H2H
  // Revised form‐submit logic (complete replacement of the previous handler)
  document.getElementById("h2h-form").addEventListener("submit", (event) => {
    event.preventDefault();
  
    const rawP1 = document.getElementById("p1-id").value.trim();
    const rawP2 = document.getElementById("p2-id").value.trim();
    if (!rawP1 || !rawP2) return;
  
    // Normalize: collapse multiple spaces to a single space
    const normP1 = rawP1.replace(/\s+/g, " ");
    const normP2 = rawP2.replace(/\s+/g, " ");
  
    // 1) Try exact match first
    let p1Id = p1SearchResults[normP1];
    let p2Id = p2SearchResults[normP2];
  
    // 2) If no exact match, attempt to match keys that start with the tag + " ("
    if (!p1Id) {
      const fallbackKeyP1 = Object.keys(p1SearchResults).find((key) => {
        // Normalize key’s whitespace as well
        const normKey = key.replace(/\s+/g, " ");
        return normKey.startsWith(normP1 + " (");
      });
      if (fallbackKeyP1) {
        p1Id = p1SearchResults[fallbackKeyP1];
      }
    }
    if (!p2Id) {
      const fallbackKeyP2 = Object.keys(p2SearchResults).find((key) => {
        const normKey = key.replace(/\s+/g, " ");
        return normKey.startsWith(normP2 + " (");
      });
      if (fallbackKeyP2) {
        p2Id = p2SearchResults[fallbackKeyP2];
      }
    }
  
    // 3) If we still don’t have IDs, log all keys to help debug
    if (!p1Id || !p2Id) {
      console.error("Could not resolve to player_id:");
      if (!p1Id) {
        console.error("• P1 raw input:", rawP1);
        console.error("• Available P1 keys:", Object.keys(p1SearchResults));
      }
      if (!p2Id) {
        console.error("• P2 raw input:", rawP2);
        console.error("• Available P2 keys:", Object.keys(p2SearchResults));
      }
      return;
    }
  
    fetchH2HSets(p1Id, p2Id);
  });
});

// ─────────────────────────────────────────────────────────
// performPlayerSearch(searchTerm, whichPlayer)
// ─────────────────────────────────────────────────────────
//
// POST to /player-search-v2 with { sport: "melee", searchTerm, searchMode: "all-players" }
// Populate the correct <datalist> (p1-list or p2-list), using displayString = `${tag} (${count})`
// as the .value of each <option>, and store that exact displayString → player_id.
// ─────────────────────────────────────────────────────────
async function performPlayerSearch(searchTerm, whichPlayer) {
  const listEl = document.getElementById(
    whichPlayer === "p1" ? "p1-list" : "p2-list"
  );

  // Clear previous mapping + dropdown
  if (whichPlayer === "p1") {
    p1SearchResults = {};
  } else {
    p2SearchResults = {};
  }
  listEl.innerHTML = "";

  if (!searchTerm) {
    return; // nothing to do
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
        apikey: SUPABASE_SEARCH_KEY,
        Authorization: `Bearer ${SUPABASE_SEARCH_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error("Player search failed:", res.status, await res.text());
      return;
    }

    const json = await res.json();
    // json.data is an array of objects: { tag, player_id, num_events, … }

    // Double‐clear before repopulating
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

      // Build the unique display string, e.g. "Bobakanoosh (159)"
      const displayString = `${tag} (${count})`;

      // Map displayString → player_id
      if (whichPlayer === "p1") {
        p1SearchResults[displayString] = pid;
      } else {
        p2SearchResults[displayString] = pid;
      }

      // Create an <option> whose value is exactly displayString
      const opt = document.createElement("option");
      opt.value = displayString;
      listEl.appendChild(opt);
    });
  } catch (err) {
    console.error("Error in performPlayerSearch():", err);
  }
}


// ─────────────────────────────────────────────────────────
// fetchH2HSets(p1Id, p2Id)
// ─────────────────────────────────────────────────────────
//
// POST to /h2h-sheet-v2 with payload: tab="overview" so that
// the response includes data.matches. Then render the top 5 lines.
// ─────────────────────────────────────────────────────────
async function fetchH2HSets(p1Id, p2Id) {
  const payload = {
    sport: "melee",
    p1PlayerId: p1Id,
    p2PlayerId: p2Id,
    tab: "overview",
    globalDateRange: "All Time",
    globalFilterContext: "All",
    filterToVods: false,
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
