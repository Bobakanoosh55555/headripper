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

// GraphQL endpoint and payload (for DMAR#554)
const endpoint = "https://gql-gateway-2-dot-slippi.uc.r.appspot.com/graphql";
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
function createCharacterBarChart(canvasId, characters) {
  const labels = [], data = [], backgroundColors = [];
  characters.forEach(char => {
    labels.push(formatResponseData(char.character));
    data.push(char.gameCount);
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
        legend: { labels: { color: "#ffffff" } },
        tooltip: { callbacks: { label: (context) => `${context.label}: ${context.parsed.y} games` } }
      }
    }
  });
}

// Renders the user profile, including basic info, current profile chart, and history charts.
function renderUserProfile(user) {
  const profileContainer = document.getElementById('profile');
  if (!user) { 
    profileContainer.textContent = 'No user data found.'; 
    return; 
  }

  // Basic Information
  let basicHTML = `
    <p><strong>Name:</strong> ${user.displayName}</p>
    <p><strong>Connect Code:</strong> ${user.connectCode.code}</p>
    <p><strong>Status:</strong> ${formatResponseData(user.status)}</p>
    <p><strong>Subscription:</strong> ${formatResponseData(user.activeSubscription.level)} ${user.activeSubscription.hasGiftSub ? '(Gifted)' : ''}</p>
  `;
  profileContainer.appendChild(createCard("Basic Information", basicHTML));

  // Ranked Netplay Profile with current character usage chart.
  if (user.rankedNetplayProfile) {
    let profile = user.rankedNetplayProfile;
    let profileHTML = `
      <p><strong>Rating:</strong> ${profile.ratingOrdinal.toFixed(2)}</p>
      <p><strong>Rating Updates:</strong> ${profile.ratingUpdateCount}</p>
      <p><strong>Wins:</strong> ${profile.wins}</p>
      <p><strong>Losses:</strong> ${profile.losses}</p>
      <p><strong>Continent:</strong> ${formatResponseData(profile.continent)}</p>
      <h3>Current Character Usage</h3>
      <div class="chart-container"><canvas id="current-profile-chart"></canvas></div>
    `;
    profileContainer.appendChild(createCard("Ranked Netplay Profile", profileHTML));
    if (profile.characters && profile.characters.length > 0) {
      createCharacterBarChart("current-profile-chart", profile.characters);
    }
  }

  // History charts per season.
  if (user.rankedNetplayProfileHistory && user.rankedNetplayProfileHistory.length > 0) {
    user.rankedNetplayProfileHistory.forEach(history => {
      let season = history.season;
      let historyHTML = `
        <p><strong>Season:</strong> ${season.name} (${formatResponseData(season.status)})</p>
        <p><strong>Period:</strong> ${new Date(season.startedAt).toLocaleDateString()} - ${new Date(season.endedAt).toLocaleDateString()}</p>
        <p><strong>Rating:</strong> ${history.ratingOrdinal.toFixed(2)}</p>
        <p><strong>Rating Updates:</strong> ${history.ratingUpdateCount}</p>
        <p><strong>Wins:</strong> ${history.wins}</p>
        <p><strong>Losses:</strong> ${history.losses}</p>
        <p><strong>Continent:</strong> ${formatResponseData(history.continent)}</p>
      `;
      if (history.characters && history.characters.length > 0) {
        const canvasId = "chart-" + season.id;
        historyHTML += `<h4>Character Usage</h4>
          <div class="chart-container"><canvas id="${canvasId}"></canvas></div>`;
      }
      const card = createCard(`Ranked Netplay History - ${season.name}`, historyHTML);
      profileContainer.appendChild(card);
      if (history.characters && history.characters.length > 0) {
        createCharacterBarChart("chart-" + season.id, history.characters);
      }
    });
  }
}

// Fetch data and render profile.
fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
  .then(response => response.json())
  .then(data => {
    const user = data.data.getUser || (data.data.getConnectCode && data.data.getConnectCode.user);
    renderUserProfile(user);
  })
  .catch(error => {
    document.getElementById('profile').textContent = 'Error: ' + error;
  });
