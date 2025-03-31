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

// GraphQL endpoint
const endpoint = "https://gql-gateway-2-dot-slippi.uc.r.appspot.com/graphql";

// Base payload used for the GraphQL query.
const payload = {
  operationName: "AccountManagementPageQuery",
  query: `fragment profileFieldsV2 on NetplayProfileV2 {
  id ratingOrdinal ratingUpdateCount wins losses dailyGlobalPlacement dailyRegionalPlacement continent characters { character gameCount __typename } __typename }
fragment userProfilePage on User {
  fbUid displayName connectCode { code __typename } status activeSubscription { level hasGiftSub __typename } rankedNetplayProfile { ...profileFieldsV2 __typename } rankedNetplayProfileHistory { ...profileFieldsV2 season { id startedAt endedAt name status __typename } __typename } __typename }
query AccountManagementPageQuery($cc: String!, $uid: String!) {
  getUser(fbUid: $uid) { ...userProfilePage __typename }
  getConnectCode(code: $cc) { user { ...userProfilePage __typename } __typename }
}`,
  variables: { cc: "DMAR#554", uid: "DMAR#554" }
};

// Formats an all-caps, underscore-separated string into a display-friendly format.
function formatResponseData(text) {
  if (typeof text !== 'string') return text;
  return text
    .toLowerCase()
    .split('_')
    .map(word => {
      const match = word.match(/([a-z]+)(\d*)/);
      return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) + (match[2] ? ' ' + match[2] : '') : word;
    })
    .join(' ');
}

// Returns icon path based on character API name.
function getCharacterIcon(apiName) {
  return `icons/${apiName.toLowerCase().replace(/_/g, "-")}.png`;
}

// Returns color for a character based on mapping.
function getCharacterColor(apiName) {
  const key = apiName.toLowerCase().replace(/_/g, "-");
  return characterColors[key] || 'gray';
}

// Creates a card element with a title and content.
function createCard(title, contentHTML) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>${title}</h2><div>${contentHTML}</div>`;
  return card;
}

// Creates a vertical bar chart for character usage using Chart.js.
// Characters are sorted from largest to smallest.
function createCharacterBarChart(canvasId, characters) {
  const sortedCharacters = characters.slice().sort((a, b) => b.gameCount - a.gameCount);
  const labels = [], data = [], backgroundColors = [];
  
  sortedCharacters.forEach(char => {
    labels.push(formatResponseData(char.character));
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
        borderWidth: 1 
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

// Renders the user profile, including header, current season, and season history tabs.
function renderUserProfile(user) {
  const profileContainer = document.getElementById('profile');
  profileContainer.innerHTML = ''; // Clear previous content
  if (!user) { 
    profileContainer.textContent = 'No user data found.'; 
    return; 
  }
  
  // User Header: Name as h1, connect code as h3, and subscription status line.
  const userHeader = document.createElement('div');
  userHeader.innerHTML = `
    <h1>${user.displayName}</h1>
    <h3>${user.connectCode.code}</h3>
    <p><strong>Subscription Status:</strong> ${formatResponseData(user.status)} - ${formatResponseData(user.activeSubscription.level)} ${user.activeSubscription.hasGiftSub ? '(Gifted)' : ''}</p>
  `;
  profileContainer.appendChild(userHeader);
  
  // Current Season (formerly Ranked Netplay Profile)
  if (user.rankedNetplayProfile) {
    let profile = user.rankedNetplayProfile;
    let profileHTML = `
      <p><strong>Rating:</strong> ${profile.ratingOrdinal.toFixed(2)}</p>
      <p><strong>Sets Played:</strong> ${profile.ratingUpdateCount}</p>
      <p><strong>Wins:</strong> ${profile.wins}</p>
      <p><strong>Losses:</strong> ${profile.losses}</p>
      <p><strong>Continent:</strong> ${formatResponseData(profile.continent)}</p>
      <h3>Current Character Usage</h3>
      <div class="chart-container"><canvas id="current-profile-chart"></canvas></div>
    `;
    profileContainer.appendChild(createCard("Current Season", profileHTML));
    if (profile.characters && profile.characters.length > 0) {
      createCharacterBarChart("current-profile-chart", profile.characters);
    }
  }
  
  // Season History Tabs
  if (user.rankedNetplayProfileHistory && user.rankedNetplayProfileHistory.length > 0) {
    const tabsHTML = `
      <div class="tabs">
        <button class="tab-button active" data-target="aggregateData">Aggregate Data</button>
        <button class="tab-button" data-target="previousSeason">Previous Season</button>
      </div>
      <div id="aggregateData" class="tab-content active">
        <div class="chart-container"><canvas id="aggregate-chart"></canvas></div>
      </div>
      <div id="previousSeason" class="tab-content"></div>
    `;
    profileContainer.appendChild(createCard("", tabsHTML)); // No header text in the card.
    
    // Render Previous Season data.
    const prevContainer = document.getElementById('previousSeason');
    user.rankedNetplayProfileHistory.forEach(history => {
      let season = history.season;
      let historyHTML = `
        <p><strong>Season:</strong> ${season.name} (${formatResponseData(season.status)})</p>
        <p><strong>Period:</strong> ${new Date(season.startedAt).toLocaleDateString()} - ${new Date(season.endedAt).toLocaleDateString()}</p>
        <p><strong>Rating:</strong> ${history.ratingOrdinal.toFixed(2)}</p>
        <p><strong>Sets Played:</strong> ${history.ratingUpdateCount}</p>
        <p><strong>Wins:</strong> ${history.wins}</p>
        <p><strong>Losses:</strong> ${history.losses}</p>
        <p><strong>Continent:</strong> ${formatResponseData(history.continent)}</p>
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
    
    // Aggregate Data: Sum character usage across all seasons including the current season.
    const aggregateUsage = {};
    if (user.rankedNetplayProfile && user.rankedNetplayProfile.characters) {
      user.rankedNetplayProfile.characters.forEach(char => {
        const count = Number(char.gameCount);
        aggregateUsage[char.character] = (aggregateUsage[char.character] || 0) + (isNaN(count) ? 0 : count);
      });
    }
    user.rankedNetplayProfileHistory.forEach(history => {
      if (history.characters) {
        history.characters.forEach(char => {
          const count = Number(char.gameCount);
          aggregateUsage[char.character] = (aggregateUsage[char.character] || 0) + (isNaN(count) ? 0 : count);
        });
      }
    });
    const aggregateArray = Object.keys(aggregateUsage).map(key => ({ character: key, gameCount: aggregateUsage[key] }));
    if (aggregateArray.length > 0) {
      createCharacterBarChart("aggregate-chart", aggregateArray);
    }
    
    // Tab switching logic.
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', function() {
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        this.classList.add('active');
        const target = this.getAttribute('data-target');
        document.getElementById(target).classList.add('active');
      });
    });
  }
}

// Fetches the profile data for the given user code.
function fetchProfile(userCode) {
  const dynamicPayload = {
    ...payload,
    variables: { cc: userCode, uid: userCode }
  };
  
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dynamicPayload)
  })
    .then(response => response.json())
    .then(data => {
      const user = data.data.getUser || (data.data.getConnectCode && data.data.getConnectCode.user);
      renderUserProfile(user);
    })
    .catch(error => {
      document.getElementById('profile').textContent = 'Error: ' + error;
    });
}

// Set up form submission handler.
document.getElementById('userForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const userCode = document.getElementById('userCode').value.trim();
  if (userCode) {
    fetchProfile(userCode);
  }
});
