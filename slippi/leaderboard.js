document.addEventListener('DOMContentLoaded', function() {
  const leaderboardForm = document.getElementById('leaderboardForm');
  const leaderboardResults = document.getElementById('leaderboardResults');
  const presetButton = document.getElementById('presetButton');
  const toggleAlternate = document.getElementById('toggleAlternateView');
  const tableView = document.getElementById('tableView');
  const altView = document.getElementById('altView');
  const verticalBar = document.getElementById('verticalBar');
  const playerCardsContainer = document.getElementById('playerCards');
  const endpoint = "https://gql-gateway-2-dot-slippi.uc.r.appspot.com/graphql";
  
  const query = `
    fragment profileFieldsV2 on NetplayProfileV2 {
      id ratingOrdinal ratingUpdateCount wins losses dailyGlobalPlacement dailyRegionalPlacement continent 
      characters { character gameCount __typename } __typename 
    }
    fragment userProfilePage on User {
      fbUid displayName connectCode { code __typename } status activeSubscription { level hasGiftSub __typename }
      rankedNetplayProfile { ...profileFieldsV2 __typename }
      rankedNetplayProfileHistory { ...profileFieldsV2 season { id startedAt endedAt name status __typename } __typename }
      __typename 
    }
    query AccountManagementPageQuery($cc: String!, $uid: String!) {
      getUser(fbUid: $uid) { ...userProfilePage __typename }
      getConnectCode(code: $cc) { user { ...userProfilePage __typename } __typename }
    }
  `;
  
  // Global variable to store fetched players data.
  let playersData = [];
  
  // Base colors and helper functions (same as before, with your color adjustment changes).
  const masterBase = "#800080";    // Purple
  const diamondBase = "#1E90FF";     // Dodgerblue
  const platinumBase = "#89CFF0";    // Baby blue
  const goldBase = "#FFD700";        // Gold
  const silverBase = "#C0C0C0";      // Silver
  const bronzeBase = "#CD7F32";      // Bronze
  
  function adjustColor(hex, amount) {
    let usePound = false;
    if (hex[0] === "#") {
      hex = hex.slice(1);
      usePound = true;
    }
    let num = parseInt(hex, 16);
    let r = (num >> 16) + amount;
    if (r > 255) r = 255;
    else if (r < 0) r = 0;
    let g = ((num >> 8) & 0x00FF) + amount;
    if (g > 255) g = 255;
    else if (g < 0) g = 0;
    let b = (num & 0x0000FF) + amount;
    if (b > 255) b = 255;
    else if (b < 0) b = 0;
    return (usePound ? "#" : "") +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0");
  }
  
  function getRank(rating) {
    if (rating >= 2350) return { rankName: "Master 3", color: adjustColor(masterBase, -40) };
    else if (rating >= 2275) return { rankName: "Master 2", color: masterBase };
    else if (rating >= 2191.75) return { rankName: "Master 1", color: adjustColor(masterBase, 40) };
    else if (rating >= 2136.28) return { rankName: "Diamond 3", color: adjustColor(diamondBase, -40) };
    else if (rating >= 2073.67) return { rankName: "Diamond 2", color: diamondBase };
    else if (rating >= 2003.92) return { rankName: "Diamond 1", color: adjustColor(diamondBase, 40) };
    else if (rating >= 1927.03) return { rankName: "Platinum 3", color: adjustColor(platinumBase, -40) };
    else if (rating >= 1843) return { rankName: "Platinum 2", color: platinumBase };
    else if (rating >= 1751.83) return { rankName: "Platinum 1", color: adjustColor(platinumBase, 40) };
    else if (rating >= 1653.52) return { rankName: "Gold 3", color: adjustColor(goldBase, -40) };
    else if (rating >= 1548.07) return { rankName: "Gold 2", color: goldBase };
    else if (rating >= 1435.48) return { rankName: "Gold 1", color: adjustColor(goldBase, 40) };
    else if (rating >= 1315.75) return { rankName: "Silver 3", color: adjustColor(silverBase, -40) };
    else if (rating >= 1188.88) return { rankName: "Silver 2", color: silverBase };
    else if (rating >= 1054.87) return { rankName: "Silver 1", color: adjustColor(silverBase, 40) };
    else if (rating >= 913.72) return { rankName: "Bronze 3", color: adjustColor(bronzeBase, -40) };
    else if (rating >= 765.43) return { rankName: "Bronze 2", color: bronzeBase };
    else return { rankName: "Bronze 1", color: adjustColor(bronzeBase, 40) };
  }
  
  function normalizeKey(name) {
    return name.toLowerCase().replace(/[_\s]+/g, "-");
  }
  
  function renderCharacterIcons(chars) {
    let html = "";
    chars.forEach(ch => {
      const norm = normalizeKey(ch.character);
      html += `<img src="icons/${norm}.png" alt="${ch.character}" title="${ch.gameCount} game(s) played" style="width:24px; height:24px; margin-left:4px;">`;
    });
    return html;
  }
  
  // Generates the standard table view and also stores playersData.
  function processLeaderboardCodes(codes) {
    if (codes.length === 0) {
      leaderboardResults.innerHTML = 'Please enter at least one code.';
      return;
    }
    
    leaderboardResults.innerHTML = 'Loading leaderboard...';
    
    let fetchPromises = codes.map(code => {
      const payload = {
        operationName: "AccountManagementPageQuery",
        query: query,
        variables: { cc: code, uid: code }
      };
      
      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(response => response.json())
      .then(data => {
        const user = data.data.getUser || (data.data.getConnectCode && data.data.getConnectCode.user);
        if (user && user.rankedNetplayProfile && user.rankedNetplayProfile.ratingUpdateCount > 0) {
          const topChars = (user.rankedNetplayProfile.characters || [])
            .slice()
            .sort((a, b) => Number(b.gameCount) - Number(a.gameCount))
            .slice(0, 3);
          return {
            code: code,
            displayName: user.displayName || code,
            rating: user.rankedNetplayProfile.ratingOrdinal || 0,
            wins: user.rankedNetplayProfile.wins || 0,
            losses: user.rankedNetplayProfile.losses || 0,
            topChars: topChars
          };
        } else {
          return null;
        }
      })
      .catch(err => {
        console.error("Error fetching data for", code, err);
        return null;
      });
    });
    
    Promise.all(fetchPromises).then(results => {
      results = results.filter(result => result !== null);
      if (results.length === 0) {
        leaderboardResults.innerHTML = 'No valid ranked users found.';
        return;
      }
      
      results.sort((a, b) => b.rating - a.rating);
      playersData = results; // Store for alternate view
      
      // Build standard table view.
      let tableHTML = '<table style="width:100%; border-collapse: collapse;">';
      tableHTML += '<tr style="border-bottom: 1px solid #555;">'
        + '<th style="padding: 8px;">Rank</th>'
        + '<th style="padding: 8px;">Code</th>'
        + '<th style="padding: 8px;">Display Name</th>'
        + '<th style="padding: 8px;">Rating</th>'
        + '<th style="padding: 8px;">W/L</th>'
        + '</tr>';
      
      results.forEach((result, index) => {
        const rank = getRank(result.rating);
        tableHTML += `<tr style="border-bottom: 1px solid #555; color: ${rank.color};">
                        <td style="padding: 8px;">${index + 1}</td>
                        <td style="padding: 8px;">${result.code}</td>
                        <td style="padding: 8px;"><strong>${result.displayName}</strong> ${renderCharacterIcons(result.topChars)}</td>
                        <td style="padding: 8px;" title="Rank: ${rank.rankName}">${result.rating.toFixed(2)}</td>
                        <td style="padding: 8px;">
                          <span style="color: #39FF14;">${result.wins}</span>
                          <span style="color: #fff;">/</span>
                          <span style="color: #FF073A;">${result.losses}</span>
                        </td>
                      </tr>`;
      });
      tableHTML += '</table>';
      
      leaderboardResults.innerHTML = tableHTML;
      
      // If alternate view is toggled on, update that view too.
      if (toggleAlternate.checked) {
        showAlternateView(playersData);
      }
    });
  }
  
  // Build the alternate view.
  function showAlternateView(players) {
    playerCardsContainer.innerHTML = "";
    // Define rating range for positioning.
    const minRating = 700, maxRating = 2400;
    const viewHeight = altView.clientHeight;
    
    players.forEach((player, index) => {
      // Compute vertical position (in pixels) along the bar.
      let ratio = (player.rating - minRating) / (maxRating - minRating);
      let posY = Math.min(Math.max(ratio * viewHeight, 0), viewHeight);
      
      // Create a card for the player.
      const card = document.createElement('div');
      card.className = 'player-card';
      // Alternate left/right placement.
      const isLeft = index % 2 === 0;
      if (isLeft) {
        card.style.right = "calc(50% + 30px)"; // 30px gap from the bar.
      } else {
        card.style.left = "calc(50% + 30px)";
      }
      card.style.top = posY + "px";
      // Bold display name and condensed info.
      card.innerHTML = `<strong>${player.displayName}</strong><br>
                        Rating: ${player.rating.toFixed(2)}<br>
                        W/L: ${player.wins}/${player.losses}`;
      
      // Append card.
      playerCardsContainer.appendChild(card);
      
      // Create a connector line.
      const connector = document.createElement('div');
      connector.className = 'connector';
      // Determine horizontal starting point at the vertical bar.
      const barX = verticalBar.offsetLeft + verticalBar.offsetWidth / 2;
      // Determine card edge (left or right).
      let cardX;
      if (isLeft) {
        cardX = card.offsetLeft + card.offsetWidth;
      } else {
        cardX = card.offsetLeft;
      }
      // Set connector's position and dimensions.
      // We draw a horizontal line from the vertical bar to the card.
      const leftX = Math.min(barX, cardX);
      const width = Math.abs(barX - cardX);
      connector.style.left = leftX + "px";
      connector.style.top = (posY + 12) + "px";  // approx vertical center of card text.
      connector.style.width = width + "px";
      connector.style.height = "2px";
      
      altView.appendChild(connector);
    });
  }
  
  // Toggle between table view and alternate view.
  toggleAlternate.addEventListener('change', function() {
    if (this.checked) {
      tableView.style.display = "none";
      altView.style.display = "block";
      if (playersData.length > 0) {
        showAlternateView(playersData);
      }
    } else {
      altView.style.display = "none";
      tableView.style.display = "block";
    }
  });
  
  leaderboardForm.addEventListener('submit', function(e) {
    e.preventDefault();
    let codesInput = document.getElementById('codesInput').value;
    let codes = codesInput.split(',').map(code => code.trim()).filter(code => code !== '');
    processLeaderboardCodes(codes);
  });
  
  if (presetButton) {
    presetButton.addEventListener('click', function() {
      leaderboardResults.innerHTML = 'Loading preset leaderboard...';
      fetch('presets/upstate.csv')
        .then(response => response.text())
        .then(text => {
          let codes = text.split(/[\r\n,]+/).map(code => code.trim()).filter(code => code !== '');
          processLeaderboardCodes(codes);
        })
        .catch(error => {
          leaderboardResults.innerHTML = 'Error loading preset data.';
          console.error('Error fetching preset CSV:', error);
        });
    });
  }
});
