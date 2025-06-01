// Updated script.js to support CSV autocomplete + raw ID fallback

const API_URL = "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

let tagToIdMap = {};

async function loadPlayers() {
  try {
    const res = await fetch("players.csv");
    const text = await res.text();
    text.split("\n").forEach(line => {
      const [tag, id] = line.trim().split(",");
      if (tag && id) tagToIdMap[tag.toLowerCase()] = id.trim();
    });
  } catch (err) {
    console.error("Failed to load player list", err);
  }
}

function createAutocomplete(input) {
  input.addEventListener("input", function () {
    closeAllLists();
    const val = this.value.toLowerCase();
    if (!val) return;

    const list = document.createElement("div");
    list.setAttribute("class", "autocomplete-items");
    this.parentNode.appendChild(list);

    Object.keys(tagToIdMap).forEach(tag => {
      if (tag.startsWith(val)) {
        const item = document.createElement("div");
        item.innerHTML = `<strong>${tag.slice(0, val.length)}</strong>${tag.slice(val.length)}`;
        item.addEventListener("click", () => {
          input.value = tagToIdMap[tag];
          closeAllLists();
        });
        list.appendChild(item);
      }
    });
  });

  function closeAllLists() {
    document.querySelectorAll(".autocomplete-items").forEach(e => e.remove());
  }

  document.addEventListener("click", e => closeAllLists());
}

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
      sortBy: "date_desc"
    },
    placementsTabSettings: {
      sortBy: "date_desc"
    }
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY
      },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    const matches = json?.data?.matches?.filter(m => m.type === "match" && m.match) || [];

    const container = document.getElementById("results");
    if (matches.length === 0) {
      container.innerText = "No matches found.";
      return;
    }

    const lines = matches.slice(0, 5).map(m => {
      const match = m.match;
      const p1 = match.p1_info;
      const p2 = match.p2_info;
      const date = new Date(match.event_info.start_date);
      const now = new Date();
      const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      const dateStr = diffDays === 0 ? "today" : `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
      const winner = p1.is_winner ? p1.tag : p2.tag;
      const loser = p1.is_winner ? p2.tag : p1.tag;
      return `${dateStr}: ${winner} beat ${loser}`;
    });

    container.innerHTML = lines.map(line => `<div>${line}</div>`).join("");
  } catch (err) {
    document.getElementById("results").innerText = "Error fetching data.";
    console.error(err);
  }
}

// On DOM load
window.addEventListener("DOMContentLoaded", async () => {
  await loadPlayers();
  createAutocomplete(document.getElementById("p1-id"));
  createAutocomplete(document.getElementById("p2-id"));

  document.getElementById("h2h-form").addEventListener("submit", event => {
    event.preventDefault();
    const p1Input = document.getElementById("p1-id").value.trim();
    const p2Input = document.getElementById("p2-id").value.trim();
    const p1Id = tagToIdMap[p1Input.toLowerCase()] || p1Input;
    const p2Id = tagToIdMap[p2Input.toLowerCase()] || p2Input;
    fetchH2HSets(p1Id, p2Id);
  });
});
