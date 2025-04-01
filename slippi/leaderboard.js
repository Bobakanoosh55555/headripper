document.addEventListener('DOMContentLoaded', function() {
  const leaderboardForm = document.getElementById('leaderboardForm');
  const leaderboardResults = document.getElementById('leaderboardResults');
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
  
  leaderboardForm.addEventListener('submit', function(e) {
    e.preventDefault();
    leaderboardResults.innerHTML = 'Loading leaderboard...';
    
    let codesInput = document.getElementById('codesInput').value;
    // Split on commas, trim each code, and filter out any empty values
    let codes = codesInput.split(',').map(code => code.trim()).filter(code => code !== '');
    
    if (codes.length === 0) {
      leaderboardResults.innerHTML = 'Please enter at least one code.';
      return;
    }
    
    // Create an array of promises for fetching each user's data
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
        // Only include user if they have ranked data and their activeSubscription level isn't "NONE"
        if (user && user.rankedNetplayProfile && user.activeSubscription && user.activeSubscription.level !== 'NONE') {
          return {
            code: code,
            displayName: user.displayName || code,
            rating: user.rankedNetplayProfile.ratingOrdinal || 0
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
      // Filter out any null results (discarded users)
      results = results.filter(result => result !== null);
      if(results.length === 0) {
        leaderboardResults.innerHTML = 'No valid ranked users found.';
        return;
      }
      
      // Sort results by rating descending (highest first)
      results.sort((a, b) => b.rating - a.rating);
      
      // Build an HTML table to display the leaderboard
      let tableHTML = '<table style="width:100%; border-collapse: collapse;">';
      tableHTML += '<tr style="border-bottom: 1px solid #555;">'
        + '<th style="padding: 8px;">Rank</th>'
        + '<th style="padding: 8px;">Code</th>'
        + '<th style="padding: 8px;">Display Name</th>'
        + '<th style="padding: 8px;">Rating</th>'
        + '</tr>';
      
      results.forEach((result, index) => {
        tableHTML += `<tr style="border-bottom: 1px solid #555;">
                        <td style="padding: 8px;">${index + 1}</td>
                        <td style="padding: 8px;">${result.code}</td>
                        <td style="padding: 8px;">${result.displayName}</td>
                        <td style="padding: 8px;">${result.rating.toFixed(2)}</td>
                      </tr>`;
      });
      tableHTML += '</table>';
      
      leaderboardResults.innerHTML = tableHTML;
    });
  });
});
