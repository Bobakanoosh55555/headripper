// Character-to-color mapping (keys are lowercase with hyphens)
const characterColors = {
  "bowser": "green",
  "captain-falcon": "red",
  "donkey-kong": "saddlebrown",
  "dr-mario": "white",
  "falco": "blue",
  "fox": "sandybrown",
  "game-and-watch": "black",
  "ganondorf": "darkviolet",
  "ice-climbers": "blueviolet",
  "jigglypuff": "lightpink",
  "kirby": "deeppink",
  "link": "limegreen",
  "luigi": "green",
  "mario": "red",
  "marth": "mediumblue",
  "mewtwo": "mediumorchid",
  "ness": "crimson",
  "peach": "pink",
  "pichu": "yellow",
  "pikachu": "gold",
  "roy": "red",
  "samus": "red",
  "sheik": "lightsteelblue",
  "yoshi": "forestgreen",
  "young-link": "seagreen",
  "zelda": "thistle"
};

// GraphQL endpoint and base query
const endpoint = "https://internal.slippi.gg/graphql";
const query = `
  fragment profileFields on NetplayProfile {
    id
    ratingOrdinal
    ratingUpdateCount
    wins
    losses
    dailyGlobalPlacement
    dailyRegionalPlacement
    continent
    characters { character gameCount __typename }
    __typename
  }

  fragment userProfilePage on User {
    fbUid
    displayName
    connectCode { code __typename }
    status
    activeSubscription { level hasGiftSub __typename }
    rankedNetplayProfile { ...profileFields __typename }
    rankedNetplayProfileHistory {
      ...profileFields
      season { id startedAt endedAt name status __typename }
      __typename
    }
    __typename
  }

  query UserProfilePageQuery($cc: String, $uid: String) {
    getUser(fbUid: $uid, connectCode: $cc) {
      ...userProfilePage
      __typename
    }
  }
`;

// Helper to convert any string to title case, handling spaces and underscores.
function titleCase(str) {
  return typeof str === 'string'
    ? str.split(/[_\s]+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
    : str;
}

// (Optional) Retain the old function if needed elsewhere.
function formatResponseData(text) {
  return typeof text === 'string' ? text.toLowerCase() : text;
}

// Updated normalizeKey: converts the name to lowercase and replaces underscores and spaces with hyphens.
function normalizeKey(name) {
  return typeof name === 'string' ? name.toLowerCase().replace(/[_\s]+/g, "-").trim() : name;
}

// Converts a normalized key into title case with spaces.
function titleCaseFromKey(key) {
  return key.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

// Returns the color for a character using the normalized key.
function getCharacterColor(apiName) {
  const key = normalizeKey(apiName);
  return characterColors[key] || 'gray';
}

function createCard(title, contentHTML) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>${title}</h2><div>${contentHTML}</div>`;
  return card;
}

function createCharacterBarChart(canvasId, characters) {
  const sortedCharacters = characters.slice().sort((a, b) => b.gameCount - a.gameCount);
  const labels = [], data = [], backgroundColors = [];
  
  sortedCharacters.forEach(char => {
    const norm = normalizeKey(char.character);
    labels.push(titleCaseFromKey(norm));
    data.push(Number(char.gameCount));
    backgroundColors.push(getCharacterColor(char.character));
  });
  
  const ctx = document.getElementById(canvasId).getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: { 
      labels, 
      datasets: [{
        label: 'Games Played',
        data,
        backgroundColor: backgroundColors,
        borderColor: backgroundColors,
        borderWidth: 1,
        minBarLength: 2
      }] 
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#ffffff" },
          title: { display: true, text: 'Characters', color: "#ffffff" }
        },
        y: {
          ticks: { color: "#ffffff" },
          title: { display: true, text: 'Games Played', color: "#ffffff" },
          beginAtZero: true
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (context) => `${context.label}: ${context.parsed.y} games` } }
      }
    }
  });
}

function renderUserProfile(user) {
  const profileContainer = document.getElementById('profile');
  profileContainer.innerHTML = '';
  if (!user) {
    profileContainer.textContent = 'No user data found.';
    return;
  }
  
  const sub = user.activeSubscription || { level: 'NONE', hasGiftSub: false };
  let subscriptionStatus = (sub.level === 'NONE')
    ? 'INACTIVE'
    : `${titleCase(user.status)} - ${titleCase(sub.level).replace(/(Tier)(\d+)/i, '$1 $2')}`;
  if (sub.hasGiftSub) subscriptionStatus += ' (Gifted)';

  const userHeader = document.createElement('div');
  userHeader.innerHTML = `
    <h1>${user.displayName}</h1>
    <h3>${user.connectCode.code}</h3>
    <p><strong>Subscription Status:</strong> ${subscriptionStatus}</p>
  `;
  profileContainer.appendChild(userHeader);
  
  if (user.rankedNetplayProfile) {
    let profile = user.rankedNetplayProfile;
    let profileHTML = `
      <p><strong>Rating:</strong> ${profile.ratingOrdinal.toFixed(2)}</p>
      <p><strong>Sets Played:</strong> ${profile.ratingUpdateCount}</p>
      <p><strong>Wins:</strong> ${profile.wins}</p>
      <p><strong>Losses:</strong> ${profile.losses}</p>
      <p><strong>Continent:</strong> ${titleCase(profile.continent)}</p>
      <h3>Current Character Usage</h3>
      <div class="chart-container"><canvas id="current-profile-chart"></canvas></div>
    `;
    profileContainer.appendChild(createCard("Current Season", profileHTML));
    if (profile.characters && profile.characters.length > 0) {
      createCharacterBarChart("current-profile-chart", profile.characters);
    }
  }
  
  if (user.rankedNetplayProfileHistory && user.rankedNetplayProfileHistory.length > 0) {
    const tabsHTML = `
      <div class="tabs">
        <button type="button" class="tab-button active" data-target="aggregateData">Aggregate Data</button>
        <button type="button" class="tab-button" data-target="previousSeason">Previous Season</button>
      </div>
      <div id="aggregateData" class="tab-content active">
        <div class="chart-container"><canvas id="aggregate-chart"></canvas></div>
      </div>
      <div id="previousSeason" class="tab-content"></div>
    `;
    profileContainer.appendChild(createCard("", tabsHTML));
    
    const prevContainer = document.getElementById('previousSeason');
    user.rankedNetplayProfileHistory.forEach(history => {
      let season = history.season;
      // Removed the inner <p> line for season name since it's already in the card header.
      let historyHTML = `
        <p><strong>Period:</strong> ${new Date(season.startedAt).toLocaleDateString()} - ${new Date(season.endedAt).toLocaleDateString()}</p>
        <p><strong>Rating:</strong> ${history.ratingOrdinal.toFixed(2)}</p>
        <p><strong>Sets Played:</strong> ${history.ratingUpdateCount}</p>
        <p><strong>Wins:</strong> ${history.wins}</p>
        <p><strong>Losses:</strong> ${history.losses}</p>
        <p><strong>Continent:</strong> ${titleCase(history.continent)}</p>
      `;
      if (history.characters && history.characters.length > 0) {
        const canvasId = "chart-" + season.id;
        historyHTML += `<h4>Character Usage</h4>
          <div class="chart-container"><canvas id="${canvasId}"></canvas></div>`;
      }
      const card = createCard(`Season: ${season.name}`, historyHTML);
      prevContainer.appendChild(card);
      if (history.characters && history.characters.length > 0) {
        createCharacterBarChart("chart-" + season.id, history.characters);
      }
    });
    
    // Aggregate Data: Sum character usage across all seasons including current.
    const aggregateUsage = {};
    if (user.rankedNetplayProfile && user.rankedNetplayProfile.characters) {
      user.rankedNetplayProfile.characters.forEach(char => {
        const normKey = normalizeKey(char.character);
        const count = Number(char.gameCount);
        aggregateUsage[normKey] = (aggregateUsage[normKey] || 0) + (isNaN(count) ? 0 : count);
      });
    }
    user.rankedNetplayProfileHistory.forEach(history => {
      if (history.characters) {
        history.characters.forEach(char => {
          const normKey = normalizeKey(char.character);
          const count = Number(char.gameCount);
          aggregateUsage[normKey] = (aggregateUsage[normKey] || 0) + (isNaN(count) ? 0 : count);
        });
      }
    });
    console.log("Aggregate Usage:", aggregateUsage);
    const aggregateArray = Object.keys(aggregateUsage).map(key => ({
      character: titleCaseFromKey(key),
      gameCount: aggregateUsage[key]
    }));
    if (aggregateArray.length > 0) {
      createCharacterBarChart("aggregate-chart", aggregateArray);
    }
    
    // Scope the tab toggle to the current profile render (prevents form submits / cross-page interference)
    const tabsRoot = profileContainer;
    tabsRoot.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', function (e) {
        e.preventDefault(); // extra guard if inside a <form>
    
        tabsRoot.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        tabsRoot.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
        this.classList.add('active');
        const target = this.getAttribute('data-target');
        const panel = tabsRoot.querySelector(`#${CSS.escape(target)}`);
        if (panel) panel.classList.add('active');
      });
    });
  }
}

function fetchProfile(userCode) {
  const payload = {
    operationName: "UserProfilePageQuery",
    query,
    variables: { cc: userCode, uid: userCode }
  };

  fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apollographql-client-name': 'slippi-web'
      // Browsers set Origin/Referer automatically; no need to add them.
    },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res.json();
  })
  .then(data => {
    if (!data || data.errors) {
      console.error('GraphQL error:', data?.errors);
      throw new Error('GraphQL error');
    }
    const user = data.data?.getUser || null;
    renderUserProfile(user);
  })
  .catch(err => {
    console.error(err);
    document.getElementById('profile').textContent = 'Error loading profile.';
  });
}

document.getElementById('userForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const userCode = document.getElementById('userCode').value.trim();
  if (userCode) {
    fetchProfile(userCode);
  }
});
