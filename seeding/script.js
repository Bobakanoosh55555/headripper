const API_URL = "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk";

let players = [];

async function loadPlayersCSV() {
  const res = await fetch("players.csv");
  const text = await res.text();
  players = text.trim().split("\n").map(line => {
    const [name, id] = line.split(",");
    return { name: name.trim(), id: id.trim() };
  });

  populateDatalists();
}

function populateDatalists() {
  const datalist1 = document.getElementById("p1-list");
  const datalist2 = document.getElementById("p2-list");
  datalist1.innerHTML = "";
  datalist2.innerHTML = "";

  players.forEach(p => {
    const option1 = document.createElement("option");
    option1.value = p.name;
    datalist1.appendChild(option1);

    const option2 = document.createElement("option");
    option2.value = p.name;
    datalist2.appendChild(option2);
  });
}

function resolveToId(inputValue) {
  const found = players.find(p => p.name.toLowerCase() === inputValue.toLowerCase());
  return found ? found.id : inputValue;
}

async function fetchH2HSets(p1IdInput, p2IdInput) {
  const p1Id = resolveToId(p1IdInput);
  const p2Id = resolveToId(p2IdInput);

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

const form = document.getElementById("h2h-form");
form.addEventListener("submit", event => {
  event.preventDefault();
  const p1Input = document.getElementById("p1-id").value.trim();
  const p2Input = document.getElementById("p2-id").value.trim();
  if (p1Input && p2Input) fetchH2HSets(p1Input, p2Input);
});

window.addEventListener("DOMContentLoaded", loadPlayersCSV);
