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
        // Try to extract user data from either getUser or getConnectCode
        const user = data.data.getUser || (data.data.getConnectCode && data.data.getConnectCode.user);
        if (user && user.rankedNetplayProfile) {
          return {
            code: code,
            displayName: user.displayName || code,
            rating: user.rankedNetplayProfile.ratingOrdinal || 0
          };
        } else {
          return {
            code: code,
            displayName: "Not Found",
            rating: 0
          };
        }
      })
      .catch(err => {
        console.error("Error fetching data for", code, err);
        return {
          code: code,
          displayName: "Error",
          rating: 0
        };
      });
    });
    
    Promise.all(fetchPromises).then(results => {
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
