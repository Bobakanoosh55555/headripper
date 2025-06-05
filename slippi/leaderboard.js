document.addEventListener('DOMContentLoaded', function() {
  const leaderboardForm = document.getElementById('leaderboardForm');
  const leaderboardResults = document.getElementById('leaderboardResults');
  const presetButton = document.getElementById('presetButton');
  const resetButton = document.getElementById('resetButton'); // New Reset button
  const toggleAlternate = document.getElementById('toggleAlternateView');
  const tableView = document.getElementById('tableView');
  const altView = document.getElementById('altView');
  const verticalBar = document.getElementById('verticalBar');
  const playerCardsContainer = document.getElementById('playerCards');
  const endpoint = "https://internal.slippi.gg/graphql";
  const query = `
    fragment profileFields on NetplayProfile {
      id ratingOrdinal ratingUpdateCount wins losses dailyGlobalPlacement dailyRegionalPlacement continent 
      characters { character gameCount __typename } __typename 
    }
    fragment userProfilePage on User {
      fbUid displayName connectCode { code __typename } status activeSubscription { level hasGiftSub __typename }
      rankedNetplayProfile { ...profileFields __typename }
      rankedNetplayProfileHistory { ...profileFields season { id startedAt endedAt name status __typename } __typename }
      __typename 
    }
    query AccountManagementPageQuery($uid: String!) {
      getUser(fbUid: $uid) { ...userProfilePage __typename }
    }
  `;
  
  // Global variable to store fetched players data.
  let playersData = [];
  
  // Base colors for rank groups.
  const masterBase = "#800080";    // Purple
  const diamondBase = "#1E90FF";     // Dodgerblue
  const platinumBase = "#89CFF0";    // Baby blue
  const goldBase = "#FFD700";        // Gold
  const silverBase = "#C0C0C0";      // Silver
  const bronzeBase = "#CD7F32";      // Bronze
  
  // Helper: Adjust a hex color's brightness.
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
  
  // Determine rank with color variations.
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
  
  // Process leaderboard codes (standard table view).
  // Modified to append new results to existing leaderboard instead of wiping it.
  function processLeaderboardCodes(codes) {
    if (codes.length === 0) {
      leaderboardResults.innerHTML = 'Please enter at least one code.';
      return;
    }
    
    leaderboardResults.innerHTML = 'Loading leaderboard...';
    
    // Filter out any codes that are already present.
    codes = codes.filter(code => !playersData.some(p => p.code === code));
    
    // If none are new, just rebuild the display.
    if (codes.length === 0) {
      updateDisplay();
      return;
    }
    
    let fetchPromises = codes.map(code => {
      const payload = {
        operationName: "AccountManagementPageQuery",
        query: query,
        variables: { uid: code }
      };
      
      return fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'apollographql-client-name': 'slippi-web',
          'Origin': 'https://slippi.gg',
          'Referer': 'https://slippi.gg/'
        },
        body: JSON.stringify(payload)
      })
      .then(response => response.json())
      .then(data => {
        const user = data.data.getUser;
        if (user && user.rankedNetplayProfile && user.rankedNetplayProfile.ratingUpdateCount > 0) {
          const topChars = (user.rankedNetplayProfile.characters || [])
            .slice()
            .sort((a, b) => Number(b.gameCount) - Number(a.gameCount))
            .slice(0, 3);
          return {
            code: user.connectCode.code,
            displayName: user.displayName || user.connectCode.code,
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
      // If there are no new valid entries and nothing in our current leaderboard, show a message.
      if (results.length === 0 && playersData.length === 0) {
        leaderboardResults.innerHTML = 'No valid ranked users found.';
        return;
      }
      
      // Append new results to the existing playersData.
      playersData = playersData.concat(results);
      // Sort the leaderboard by rating in descending order.
      playersData.sort((a, b) => b.rating - a.rating);
      
      updateDisplay();
    });
  }
  
  // Helper function to update the leaderboard display.
  function updateDisplay() {
    let tableHTML = '<table style="width:100%; border-collapse: collapse;">';
    tableHTML += '<tr style="border-bottom: 1px solid #555;">'
      + '<th style="padding: 8px;">Rank</th>'
      + '<th style="padding: 8px;">Code</th>'
      + '<th style="padding: 8px;">Display Name</th>'
      + '<th style="padding: 8px;">Rating</th>'
      + '<th style="padding: 8px;">W/L</th>'
      + '</tr>';
    
    playersData.forEach((result, index) => {
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
    
    // Update alternate view if needed.
    if (toggleAlternate.checked) {
      showAlternateView(playersData);
    }
  }
  
  function showAlternateView(players) {
    playerCardsContainer.innerHTML = "";
    const minRating = 700, maxRating = 3000;
    const viewHeight = altView.offsetHeight;  // expected 8000px
    const verticalOffset = 130;  // shift all cards/lines down by this offset
    
    const altRect = altView.getBoundingClientRect();
    const barRect = verticalBar.getBoundingClientRect();
    
    players.forEach((player, index) => {
      let ratio = (maxRating - player.rating) / (maxRating - minRating);
      let posY = ratio * viewHeight;
      posY += verticalOffset;
      
      const card = document.createElement('div');
      card.className = 'player-card';
      card.style.top = posY + "px";
      
      const isLeft = (index % 2 === 0);
      if (isLeft) {
        card.style.left = "0px";
      } else {
        card.style.left = (altRect.width - 220) + "px";
      }
      
      card.innerHTML = `<strong>${player.displayName}</strong> | ${player.code}<br>
                        ${player.rating.toFixed(2)} | ${player.wins}/${player.losses}`;
      playerCardsContainer.appendChild(card);
      
      const cardRect = card.getBoundingClientRect();
      
      if (isLeft) {
        const barLeftLocal = barRect.left - altRect.left;
        let cardLeft = barLeftLocal - (cardRect.width + 30);
        card.style.left = cardLeft + "px";
      } else {
        const barRightLocal = (barRect.left + barRect.width) - altRect.left;
        let cardLeft = barRightLocal + 30;
        card.style.left = cardLeft + "px";
      }
      
      const finalCardRect = card.getBoundingClientRect();
      
      const connector = document.createElement('div');
      connector.className = 'connector';
      
      let startX = isLeft 
        ? (barRect.left - altRect.left) 
        : ((barRect.left + barRect.width) - altRect.left);
      
      let cardEdge = isLeft 
        ? (finalCardRect.right - altRect.left) 
        : (finalCardRect.left - altRect.left);
      
      let connectorLeft = Math.min(startX, cardEdge);
      let connectorWidth = Math.abs(startX - cardEdge);
      
      let connectorTop = (finalCardRect.top + finalCardRect.height / 2) - altRect.top;
      
      connector.style.left = connectorLeft + "px";
      connector.style.top = connectorTop + "px";
      connector.style.width = connectorWidth + "px";
      connector.style.height = "2px";
      
      altView.appendChild(connector);
    });
  }
  
  // Toggle view.
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
    let codes = codesInput.split(',')
      .map(code => code.trim())
      .filter(code => code !== '');
    processLeaderboardCodes(codes);
  });
  
  // Existing preset button for Upstate NY.
  if (presetButton) {
    presetButton.addEventListener('click', function() {
      leaderboardResults.innerHTML = 'Loading preset leaderboard...';
      fetch('presets/upstate.csv')
        .then(response => response.text())
        .then(text => {
          let codes = text.split(/[\r\n,]+/)
            .map(code => code.trim())
            .filter(code => code !== '');
          processLeaderboardCodes(codes);
        })
        .catch(error => {
          leaderboardResults.innerHTML = 'Error loading preset data.';
          console.error('Error fetching preset CSV:', error);
        });
    });
  }
  
  // New Reset button functionality.
  if (resetButton) {
    resetButton.addEventListener('click', function() {
      // Clear stored data and UI elements.
      playersData = [];
      leaderboardResults.innerHTML = '';
      altView.innerHTML = '';
      playerCardsContainer.innerHTML = '';
    });
  }
});
