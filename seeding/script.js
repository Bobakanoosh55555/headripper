// ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// Replace the string below with exactly the 174-character key you copied
// from Smashers.app’s Network → Request Headers → Authorization: Bearer <…>
// ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHVydWt4dG5sZW9mdW9wYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzQyMzYwMjIsImV4cCI6MTk4OTgxMjAyMn0.WN3Th51ocS4riD01CGhxJv6BsXtG8bqLPHZFeepyoyk"
// ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――

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
    const manualOption = document.createElement("option");
    manualOption.value = "custom";
    manualOption.textContent = "Other (type ID)";
    list.appendChild(manualOption);
    console.log(list.id, "now has", list.options.length, "options");
  });

  ["p1-id", "p2-id"].forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      if (input.value === "custom" && !document.getElementById(`${id}-manual`)) {
        const manual = document.createElement("input");
        manual.type = "text";
        manual.placeholder = "Enter ID manually";
        manual.id = `${id}-manual`;
        input.insertAdjacentElement("afterend", manual);
        input.value = "";
        console.log("Switched", id, "to manual input mode");
      }
    });
  });
}

function resolveToId(inputValue) {
  const found = players.find(
    (p) => p.name.toLowerCase() === inputValue.toLowerCase()
  );
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

document.getElementById("h2h-form").addEventListener("submit", (event) => {
  event.preventDefault();
  let p1Input = document.getElementById("p1-id").value.trim();
  const p1ManualElem = document.getElementById("p1-id-manual");
  if (p1Input === "custom" && p1ManualElem) {
    p1Input = p1ManualElem.value.trim();
  }
  let p2Input = document.getElementById("p2-id").value.trim();
  const p2ManualElem = document.getElementById("p2-id-manual");
  if (p2Input === "custom" && p2ManualElem) {
    p2Input = p2ManualElem.value.trim();
  }
  if (!p1Input || !p2Input) return;
  const id1 = resolveToId(p1Input);
  const id2 = resolveToId(p2Input);
  fetchH2HSets(id1, id2);
});

window.addEventListener("DOMContentLoaded", () => {
  loadPlayersCSV();
  ["p1-id", "p2-id"].forEach((inputId) => {
    const inp = document.getElementById(inputId);
    inp.addEventListener("focus", () => {
      inp.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, which: 40 })
      );
    });
  });
});
