const API_URL = "https://slpurukxtnleofuopadw.supabase.co/functions/v1/h2h-sheet-v2";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJz...";

let players = [];

async function loadPlayersCSV() {
  const res = await fetch("players.csv");
  const text = await res.text();
  players = text
    .trim()
    .split("\n")
    .map(line => {
      const [name, id] = line.split(",");
      return { name: name.trim(), id: id.trim() };
    });

  populateDatalists();
}

function populateDatalists() {
  // grab the <datalist> elements, not the <input>
  const p1List = document.getElementById("p1-list");
  const p2List = document.getElementById("p2-list");

  [p1List, p2List].forEach(list => {
    list.innerHTML = ""; // clear any existing <option>
    players.forEach(p => {
      const option = document.createElement("option");
      // Each option.value should be the player’s NAME (so the user sees the name)
      option.value = p.name;
      list.appendChild(option);
    });

    // “Other (type ID)” lets the user switch to manual ID entry
    const manualOption = document.createElement("option");
    manualOption.value = "custom";
    manualOption.textContent = "Other (type ID)";
    list.appendChild(manualOption);
  });

  // If the user picks “custom,” hide the original input and add a plain‐text field
  ["p1-id", "p2-id"].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      if (input.value === "custom") {
        const manual = document.createElement("input");
        manual.type = "text";
        manual.placeholder = "Enter ID manually";
        manual.id = `${id}-manual`;

        input.insertAdjacentElement("afterend", manual);
        input.classList.add("hidden");
      }
    });
  });
}

function resolveToId(inputValue) {
  // Look up by name (case‐insensitive). If not found, assume they already typed an ID.
  const found = players.find(
    p => p.name.toLowerCase() === inputValue.toLowerCase()
  );
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
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY
      },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    const matches = json?.data?.matches
      ?.filter(m => m.type === "match" && m.match)
      .slice(0, 5) || [];

    const container = document.getElementById("results");
    if (matches.length === 0) {
      container.innerText = "No matches found.";
      return;
    }

    const now = new Date();
    const lines = matches.map(m => {
      const match = m.match;
      const p1 = match.p1_info;
      const p2 = match.p2_info;
      const date = new Date(match.event_info.start_date);
      const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      const dateStr =
        diffDays === 0 ? "today" : `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
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

document
  .getElementById("h2h-form")
  .addEventListener("submit", event => {
    event.preventDefault();
    // If the user used “custom”, grab the manual‐ID field’s value instead
    const p1Input = document.getElementById("p1-id").classList.contains("hidden")
      ? document.getElementById("p1-id-manual").value.trim()
      : document.getElementById("p1-id").value.trim();
    const p2Input = document.getElementById("p2-id").classList.contains("hidden")
      ? document.getElementById("p2-id-manual").value.trim()
      : document.getElementById("p2-id").value.trim();

    if (p1Input && p2Input) fetchH2HSets(p1Input, p2Input);
  });

window.addEventListener("DOMContentLoaded", loadPlayersCSV);
