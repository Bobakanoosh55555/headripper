const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

const SUPABASE_SEARCH_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

const API_URL_SEARCH =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/player-search-v2";
const API_URL_H2H =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";


// Now we map "displayString" → player_id
let p1SearchResults = {};
let p2SearchResults = {};

let p1DebounceTimer = null;
let p2DebounceTimer = null;

window.addEventListener("DOMContentLoaded", () => {
  const p1Input = document.getElementById("p1-id");
  const p2Input = document.getElementById("p2-id");

  // When Player 1 types, debounce then search
  p1Input.addEventListener("input", () => {
    clearTimeout(p1DebounceTimer);
    p1DebounceTimer = setTimeout(() => {
      performPlayerSearch(p1Input.value.trim(), "p1");
    }, 300);
  });

  // When Player 2 types, debounce then search
  p2Input.addEventListener("input", () => {
    clearTimeout(p2DebounceTimer);
    p2DebounceTimer = setTimeout(() => {
      performPlayerSearch(p2Input.value.trim(), "p2");
    }, 300);
  });

  // Show datalist suggestions on focus (ArrowDown event)
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

  // Clear-button (“×”) logic for both inputs
  document.querySelectorAll(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = "";
        input.focus();
        // Also clear out stored results and dropdown
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

  // Form-submission: resolve displayString → player_id, then fetch H2H
  document.getElementById("h2h-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const rawP1 = document.getElementById("p1-id").value.trim();
    const rawP2 = document.getElementById("p2-id").value.trim();
    if (!rawP1 || !rawP2) return;

    // Look up the exact displayString in our map; otherwise assume raw ID
    const p1Id = p1SearchResults[rawP1] || rawP1;
    const p2Id = p2SearchResults[rawP2] || rawP2;

    fetchH2HSets(p1Id, p2Id);
  });
});

// ─────────────────────────────────────────────────────────
// performPlayerSearch(searchTerm, whichPlayer)
// ─────────────────────────────────────────────────────────
//
// POST to /player-search-v2 with { sport: "melee", searchTerm, searchMode: "all-players" }
// Populate the correct <datalist> (p1-list or p2-list). Also reset
// p1SearchResults or p2SearchResults by clearing the global object directly.
// Now we use the full "tag (num_events)" as the <option>.value.
// ─────────────────────────────────────────────────────────
async function performPlayerSearch(searchTerm, whichPlayer) {
  const listEl = document.getElementById(
    whichPlayer === "p1" ? "p1-list" : "p2-list"
  );

  // Clear the appropriate global map and dropdown
  if (whichPlayer === "p1") {
    p1SearchResults = {};
  } else {
    p2SearchResults = {};
  }
  listEl.innerHTML = "";

  if (!searchTerm) {
    return; // nothing to search if input is empty
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
    // json.data is an array of objects like:
    // { tag: "Bobakanoosh", player_id: "S12345", num_events: 175, … }

    // Make sure our map is cleared before repopulating
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

      // Build a unique display string, e.g. "Bobakanoosh (175)"
      const displayString = `${tag} (${count})`;

      // Store mapping from that exact displayString → player_id
      if (whichPlayer === "p1") {
        p1SearchResults[displayString] = pid;
      } else {
        p2SearchResults[displayString] = pid;
      }

      // Create an <option> whose value is the display string
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
// POST to /h2h-sheet-v2 with payload. Renders up to 5 match lines.
// ─────────────────────────────────────────────────────────
async function fetchH2HSets(p1Id, p2Id) {
  const payload = {
    sport: "melee",
    p1PlayerId: p1Id,
    p2PlayerId: p2Id,
    tab: "overview",              // “overview” to get match data first
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
    // The “overview” response includes `data.matches` array
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
