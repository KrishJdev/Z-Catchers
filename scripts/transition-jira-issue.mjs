const JIRA_DOMAIN = process.env.JIRA_DOMAIN || 'krishjaiswal2182003.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL || 'krish.jaiswal2182003@gmail.com';
const JIRA_TOKEN = process.env.JIRA_TOKEN;

if (!JIRA_TOKEN) {
  console.log('No JIRA_TOKEN set. If running locally, set JIRA_TOKEN to execute Jira transition.');
  process.exit(0);
}

const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

async function debugJira() {
  console.log(`Checking current Jira user on ${JIRA_DOMAIN}...`);
  const userRes = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/myself`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  console.log('User status:', userRes.status);
  if (userRes.ok) {
    const user = await userRes.json();
    console.log(`Logged in as: ${user.displayName} (${user.emailAddress})`);
  } else {
    console.log('User error:', await userRes.text());
  }

  console.log('Fetching projects...');
  const projRes = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/project`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  console.log('Projects status:', projRes.status);
  if (projRes.ok) {
    const projects = await projRes.json();
    console.log('Available projects:', projects.map((p) => `${p.key} (${p.name})`));
  } else {
    console.log('Projects error:', await projRes.text());
  }

  console.log('Searching recent issues...');
  const searchRes = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/search/jql?jql=order+by+created+DESC&maxResults=10`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    console.log(
      'Recent issues:',
      (searchData.issues || []).map((i) => `${i.key}: ${i.fields?.summary} [Status: ${i.fields?.status?.name}]`)
    );
  } else {
    // try fallback search endpoint
    const fallbackRes = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/search?maxResults=10`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (fallbackRes.ok) {
      const searchData = await fallbackRes.json();
      console.log(
        'Recent issues (fallback):',
        (searchData.issues || []).map((i) => `${i.key}: ${i.fields?.summary} [Status: ${i.fields?.status?.name}]`)
      );
    }
  }
}

async function transitionIssue(issueKey, targetState = 'in progress') {
  if (process.env.JIRA_DEBUG === '1') {
    await debugJira();
  }

  console.log(`\nFetching transitions for ${issueKey}...`);
  const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue/${issueKey}/transitions`, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch transitions for ${issueKey}: ${res.status} ${text}`);
  }

  const data = await res.json();
  const transitions = data.transitions || [];
  console.log('Available transitions:', transitions.map((t) => `${t.id}: ${t.name}`));

  const targetTransition = transitions.find(
    (t) =>
      t.name.toLowerCase().includes(targetState.toLowerCase()) ||
      (t.to && t.to.name.toLowerCase().includes(targetState.toLowerCase()))
  );

  if (!targetTransition) {
    throw new Error(`Could not find a transition matching "${targetState}".`);
  }

  console.log(`Applying transition "${targetTransition.name}" (ID: ${targetTransition.id})...`);
  const transRes = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transition: { id: targetTransition.id },
    }),
  });

  if (!transRes.ok) {
    const errText = await transRes.text();
    throw new Error(`Failed to transition issue ${issueKey}: ${transRes.status} ${errText}`);
  }

  console.log(`🎉 Successfully transitioned ${issueKey} to "${targetTransition.name}"!`);
}

const issueKey = process.argv[2] || 'ZC-5';
const targetState = process.argv[3] || 'in progress';

transitionIssue(issueKey, targetState).catch((err) => {
  console.error(err);
  process.exit(1);
});

