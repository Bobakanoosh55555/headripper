const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";
const API_URL =
  "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";

let players = [];

async function loadPlayersCSV() {
  try {
    const res = await fetch("players.csv");
    if (!res.ok) {
      console.error("Failed to fetch players.csv:", res.status);
      return;
    }
    const text = await res.text();
    players = text.trim().split("\n").map((line) => {
      const [name, id] = line.split(",");
      return { name: name.trim(), id: id.trim() };
    });
    console.log("Loaded players:", players.length, players[0]);
    populateDatalists();
  } catch (err) {
    console.error("Error in loadPlayersCSV():", err);
  }
}

function populateDatalists() {
  const p1List = document.getElementById("p1-list");
  const p2List = document.getElementById("p2-list");

  [p1List, p2List].forEach((list) => {
    list.innerHTML = "";
    players.forEach((p) => {
      const option = document.createElement("option");
      option.value = p.name;
      list.appendChild(option);
    });
    // We no longer append a “custom” option here,
    // because we don't want to inject a second textbox.
    console.log(list.id, "now has", list.options.length, "options");
  });
}

function resolveToId(inputValue) {
  const found = players.find(
    (p) => p.name.toLowerCase() === inputValue.toLowerCase()
  );
  // If the typed value exactly matches a player name, return its ID;
  // otherwise, assume the user typed a raw ID and return that.
  return found ? found.id : inputValue;
}

async function fetchH2HSets(p1Id, p2Id) {
  console.log(
    "✔︎ SUPABASE_KEY (length",
    SUPABASE_KEY.length,
    "):",
    SUPABASE_KEY
  );

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
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    console.log("Status code:", res.status);
    if (!res.ok) {
      const txt = await res.text();
      console.error("Error fetching data:", res.status, txt);
      document.getElementById("results").innerText = "Error fetching data.";
      return;
    }

    const json = await res.json();
    const matches = (json?.data?.matches || []).filter(
      (m) => m.type === "match" && m.match
    );

    const container = document.getElementById("results");
    if (matches.length === 0) {
      container.innerText = "No matches found test.";
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

window.addEventListener("DOMContentLoaded", () => {
  // 1) Populate the datalists from players.csv
  loadPlayersCSV();

  // 2) On focus, fire an “ArrowDown” so the datalist dropdown opens
  ["p1-id", "p2-id"].forEach((inputId) => {
    const inp = document.getElementById(inputId);
    inp.addEventListener("focus", () => {
      inp.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, which: 40 })
      );
    });
  });

  // 3) Attach clear‐button logic (same as before)
  document.querySelectorAll(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = "";
        input.focus();
      }
    });
  });

  // 4) Form‐submission: simply read whatever is typed in p1-id/p2-id
  document.getElementById("h2h-form").addEventListener("submit", (event) => {
    event.preventDefault();

    // Grab the raw text from each input
    const rawP1 = document.getElementById("p1-id").value.trim();
    const rawP2 = document.getElementById("p2-id").value.trim();
    if (!rawP1 || !rawP2) return;

    // Resolve names → IDs if they match a known player, else assume it’s already an ID
    const id1 = resolveToId(rawP1);
    const id2 = resolveToId(rawP2);
    fetchH2HSets(id1, id2);
  });
});
