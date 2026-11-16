// Script invoked by GitHub Actions when a new issue is created
import fs from 'fs';

const eventPayload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

if (!eventPayload.issue) {
  console.log('No issue found in event payload.');
  process.exit(0);
}

const issue = eventPayload.issue;
const issueTitle = issue.title;
const issueBody = issue.body || '';
const issueUrl = issue.html_url;

// Skip if already created from Jira (starts with [ZC-)
if (issueTitle.startsWith('[ZC-')) {
  console.log('Issue already linked to Jira. Skipping.');
  process.exit(0);
}

const JIRA_DOMAIN = process.env.JIRA_DOMAIN || 'krishjaiswal2182003.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_TOKEN;
const PROJECT_ID = process.env.JIRA_PROJECT_ID || '10033';
const ISSUE_TYPE_ID = process.env.JIRA_ISSUE_TYPE_ID || '10071';

if (!JIRA_EMAIL || !JIRA_TOKEN) {
  console.error('Missing JIRA_EMAIL or JIRA_TOKEN environment variables.');
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

async function main() {
  console.log(`Creating Jira issue for GitHub issue: "${issueTitle}"...`);

  // 1. Create Jira Issue
  const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { id: PROJECT_ID },
        summary: issueTitle,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: issueBody || 'Created from GitHub Issue' }],
            },
          ],
        },
        issuetype: { id: ISSUE_TYPE_ID },
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create Jira issue: ${res.status} ${errorText}`);
  }

  const jiraData = await res.json();
  const jiraKey = jiraData.key;
  const jiraUrl = `https://${JIRA_DOMAIN}/browse/${jiraKey}`;
  console.log(`Created Jira issue: ${jiraKey}`);

  // 2. Add remote link to Jira
  await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue/${jiraKey}/remotelink`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      object: {
        url: issueUrl,
        title: `GitHub Issue: ${issueTitle}`,
        icon: {
          url16x16: 'https://github.githubassets.com/favicons/favicon.png',
          title: 'GitHub',
        },
      },
    }),
  });

  console.log(`Successfully linked GitHub Issue to Jira issue ${jiraKey}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
