const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

const SUPABASE_SEARCH_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

const API_URL_SEARCH =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/player-search-v2";
const API_URL_H2H =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";
// Map “displayString” → player_id
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

  // Show datalist suggestions on focus (ArrowDown hack)
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

  // Clear‐button (“×”) logic
  document.querySelectorAll(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = "";
        input.focus();
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

  // Revised submit handler that ensures lookup before sending
  document
    .getElementById("h2h-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();

      const rawP1 = document.getElementById("p1-id").value.trim();
      const rawP2 = document.getElementById("p2-id").value.trim();
      if (!rawP1 || !rawP2) return;

      // Normalize whitespace
      const normP1 = rawP1.replace(/\s+/g, " ");
      const normP2 = rawP2.replace(/\s+/g, " ");

      // Strip “(count)” to get just the tag for a fresh search if needed
      let baseTag1 = normP1.replace(/\s*\(.*\)$/, "");
      let baseTag2 = normP2.replace(/\s*\(.*\)$/, "");

      // 1) Try exact lookup
      let p1Id = p1SearchResults[normP1];
      let p2Id = p2SearchResults[normP2];

      // 2) If p1Id not found, run a fresh search on the tag
      if (!p1Id) {
        await performPlayerSearch(baseTag1, "p1");
        p1Id = p1SearchResults[normP1];
      }
      // 3) If still not found, fallback to prefix match
      if (!p1Id) {
        const fallbackKeyP1 = Object.keys(p1SearchResults).find((key) => {
          const normKey = key.replace(/\s+/g, " ");
          return normKey.startsWith(baseTag1 + " (");
        });
        if (fallbackKeyP1) {
          p1Id = p1SearchResults[fallbackKeyP1];
        }
      }

      // Repeat for Player 2
      if (!p2Id) {
        await performPlayerSearch(baseTag2, "p2");
        p2Id = p2SearchResults[normP2];
      }
      if (!p2Id) {
        const fallbackKeyP2 = Object.keys(p2SearchResults).find((key) => {
          const normKey = key.replace(/\s+/g, " ");
          return normKey.startsWith(baseTag2 + " (");
        });
        if (fallbackKeyP2) {
          p2Id = p2SearchResults[fallbackKeyP2];
        }
      }

      // 4) If still missing either ID, log and bail
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

      // 5) Now we have real IDs—fetch H2H
      fetchH2HSets(p1Id, p2Id);
    });
}); // ← close DOMContentLoaded


// ─────────────────────────────────────────────────────────
// performPlayerSearch(searchTerm, whichPlayer)
// ─────────────────────────────────────────────────────────
//
// If searchTerm ends with “(number)”, skip the API call.
// Otherwise, fetch from player-search-v2, populate
// displayString → player_id mappings, and build datalist.
// ─────────────────────────────────────────────────────────
async function performPlayerSearch(searchTerm, whichPlayer) {
  // If the user’s input already looks like “Tag (count)”, do nothing
  if (/\(.+\)$/.test(searchTerm)) {
    return;
  }

  const listEl = document.getElementById(
    whichPlayer === "p1" ? "p1-list" : "p2-list"
  );

  // Clear old mapping + dropdown
  if (whichPlayer === "p1") {
    p1SearchResults = {};
  } else {
    p2SearchResults = {};
  }
  listEl.innerHTML = "";

  if (!searchTerm) return;

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
    // Clear again before repopulating
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
      const displayString = `${tag} (${count})`;

      if (whichPlayer === "p1") {
        p1SearchResults[displayString] = pid;
      } else {
        p2SearchResults[displayString] = pid;
      }

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
// POST to /h2h-sheet-v2 with tab="overview" so we get data.matches.
// Then render up to 5 match lines.
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

    // 1) Log the raw array so you can inspect its structure:
    console.log("RAW last_5_matches:", json.data.last_5_matches);

    // 2) Use the entire array, without extra filtering:
    const matches = json.data.last_5_matches || [];

    const container = document.getElementById("results");
    if (matches.length === 0) {
      container.innerText = "No matches found.";
      return;
    }

    // 3) Build lines from each match object:
    const now = new Date();
    const lines = matches.map((m) => {
      // Expect each m to have:
      //   - m.p1_info: { tag: "...", is_winner: true/false, ... }
      //   - m.p2_info: { tag: "...", is_winner: ... }
      //   - m.event_info.start_date: ISO string
      const p1 = m.p1_info;
      const p2 = m.p2_info;
      const start = m.event_info.start_date;

      // If any of these are missing, skip that entry:
      if (!p1 || !p2 || !start) return null;

      const date = new Date(start);
      const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      const dateStr =
        diffDays === 0 ? "today" : `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;

      const winner = p1.is_winner ? p1.tag : p2.tag;
      const loser = p1.is_winner ? p2.tag : p1.tag;
      return `${dateStr}: ${winner} beat ${loser}`;
    })
    .filter(Boolean); // drop any nulls

    // 4) If after mapping there are still no valid lines, show “No matches”:
    if (lines.length === 0) {
      container.innerText = "No matches found.";
      return;
    }

    // 5) Otherwise render the lines:
    container.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
  } catch (err) {
    document.getElementById("results").innerText = "Error fetching data.";
    console.error("fetchH2HSets() exception:", err);
  }
}
