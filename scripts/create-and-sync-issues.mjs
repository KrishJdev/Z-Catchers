import { execSync } from 'child_process';

const JIRA_DOMAIN = process.env.JIRA_DOMAIN || 'krishjaiswal2182003.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL || 'krish.jaiswal2182003@gmail.com';
const JIRA_TOKEN = process.env.JIRA_TOKEN;
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'ZC';

const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

async function createJiraIssue(summary, description, issueType = 'Task', parentKey = null) {
  const body = {
    fields: {
      project: { key: PROJECT_KEY },
      summary,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }],
          },
        ],
      },
      issuetype: { name: issueType },
    },
  };

  if (parentKey) {
    body.fields.parent = { key: parentKey };
  }

  const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create Jira issue "${summary}": ${res.status} ${errorText}`);
  }

  return await res.json();
}

async function linkGitHubToJira(jiraKey, ghUrl, ghTitle) {
  const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue/${jiraKey}/remotelink`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      object: {
        url: ghUrl,
        title: ghTitle,
        icon: {
          url16x16: 'https://github.githubassets.com/favicons/favicon.png',
          title: 'GitHub',
        },
      },
    }),
  });
  return res.ok;
}

function createGitHubIssue(title, body) {
  // Use powershell-safe formatting
  const sanitizedTitle = title.replace(/"/g, '\\"');
  const tempFile = 'scripts/_temp_issue.md';
  import('fs').then(fs => fs.writeFileSync(tempFile, body, 'utf8'));
  const cmd = `gh issue create --title "${sanitizedTitle}" --body-file "${tempFile}"`;
  const output = execSync(cmd, { encoding: 'utf8' }).trim();
  return output; // GitHub issue URL
}

const tasks = [
  {
    summary: 'Phase 1.1: Database Schema & Supabase Configuration',
    type: 'Task',
    parent: 'ZC-1',
    description: 'Set up members, push_subscriptions, and notification_logs tables in Supabase with RLS policies, timezone indexes, and seed members.',
    status: 'DONE',
  },
  {
    summary: 'Phase 1.2: Luxon Sleep Engine & Cross-Timezone Calculations',
    type: 'Task',
    parent: 'ZC-1',
    description: 'Implement pure functions in src/lib/sleepEngine.ts to calculate diffMinutes, handle midnight boundary wraps, and compute member status buckets relative to viewer timezone.',
    status: 'DONE',
  },
  {
    summary: 'Phase 1.3: Warm Dark Mobile Dashboard UI & Status Buckets',
    type: 'Task',
    parent: 'ZC-1',
    description: 'Build mobile-first Dashboard with 4 distinct status buckets (Nag Now, Winding Down, Awake, Sleeping) and dual-time MemberCards styled with Warm Dark tokens.',
    status: 'DONE',
  },
  {
    summary: 'Phase 1.4: Self-Service Schedule Edit Modal & 48-Hour Cooldown',
    type: 'Task',
    parent: 'ZC-1',
    description: 'Implement MyScheduleModal.tsx with 4-digit PIN verification, Discord journal validation regex, and 48-hour pending cooldown queue to prevent last-minute schedule dodging.',
    status: 'TODO',
  },
  {
    summary: 'Phase 1.5: Web Push Notification Engine & Service Worker',
    type: 'Task',
    parent: 'ZC-1',
    description: 'Set up public/sw.js service worker, VAPID key pairing, push subscription API (/api/push), and Discord journal deep-link click handling.',
    status: 'TODO',
  },
  {
    summary: 'Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail',
    type: 'Task',
    parent: 'ZC-1',
    description: 'Build /api/cron endpoint evaluating bedtimes every minute. Enforce Sleep Shield guarantee: never dispatch nag notifications to users in their own 8-hour sleep window.',
    status: 'TODO',
  },
  {
    summary: 'Phase 2: Moderation & Anti-Dodge Controls',
    type: 'Epic',
    description: 'Epic tracking moderator tools, PIN resets, instant cooldown approvals, and roster management.',
    status: 'TODO',
  },
  {
    summary: 'Phase 2.1: Passcode-Protected Moderator Drawer (ModDrawer.tsx)',
    type: 'Task',
    description: 'Implement moderator bottom sheet drawer with secure passcode unlock to view full roster and pending schedule queue.',
    status: 'TODO',
  },
  {
    summary: 'Phase 2.2: Instant Cooldown Override & Roster Admin API',
    type: 'Task',
    description: 'Create /api/mod endpoint to immediately approve/override pending bedtimes, add new members, and toggle member active status.',
    status: 'TODO',
  },
  {
    summary: 'Phase 3: Sleep Streaks, Badges & Discord Webhooks',
    type: 'Epic',
    description: 'Epic tracking engagement features, bedtime compliance streaks, and automated Discord channel announcements.',
    status: 'TODO',
  },
  {
    summary: 'Phase 3.1: Bedtime Compliance Scoring & Streak Tracking',
    type: 'Task',
    description: 'Track consecutive on-time bedtimes and display badge indicators on member cards for streak milestones.',
    status: 'TODO',
  },
  {
    summary: 'Phase 3.2: Automated Discord Channel Webhooks & Polish',
    type: 'Task',
    description: 'Broadcast community bedtime notifications and morning wake-up digests into the general Discord channel via incoming webhook.',
    status: 'TODO',
  },
];

async function run() {
  console.log('🚀 Starting Jira & GitHub Two-Way Issue Creation & Linking...');
  const fs = await import('fs');

  let currentEpicKey = 'ZC-1';

  for (const item of tasks) {
    console.log(`\n⏳ Creating Jira item: "${item.summary}"...`);
    const parent = item.type === 'Task' ? (item.parent || currentEpicKey) : null;
    const jiraIssue = await createJiraIssue(item.summary, item.description, item.type, parent);
    const jiraKey = jiraIssue.key;
    console.log(`   ✓ Jira created: ${jiraKey}`);

    if (item.type === 'Epic') {
      currentEpicKey = jiraKey;
    }

    const jiraUrl = `https://${JIRA_DOMAIN}/browse/${jiraKey}`;
    const ghTitle = `[${jiraKey}] ${item.summary}`;
    const ghBody = `## Description\n${item.description}\n\n---\n🔗 **Jira Issue:** [${jiraKey}](${jiraUrl})\n🏷️ **Type:** ${item.type}\n📌 **Status:** ${item.status}`;

    console.log(`   ⏳ Creating GitHub issue: "${ghTitle}"...`);
    fs.writeFileSync('scripts/_temp_issue.md', ghBody, 'utf8');
    const ghCmd = `gh issue create --title "${ghTitle.replace(/"/g, '\\"')}" --body-file "scripts/_temp_issue.md"`;
    const ghUrl = execSync(ghCmd, { encoding: 'utf8' }).trim();
    console.log(`   ✓ GitHub created: ${ghUrl}`);

    // Link GitHub URL in Jira Remote Link
    console.log(`   🔗 Linking GitHub issue into Jira ${jiraKey}...`);
    await linkGitHubToJira(jiraKey, ghUrl, `GitHub Issue: ${ghTitle}`);
    console.log(`   ✓ Remote link established.`);

    // If item is already done, close GitHub issue with a note
    if (item.status === 'DONE') {
      const issueNumber = ghUrl.split('/').pop();
      execSync(`gh issue close ${issueNumber} --comment "Completed as part of initial architecture scaffold & Supabase setup."`);
      console.log(`   ✓ Closed GitHub issue #${issueNumber} as completed.`);
    }
  }

  // Clean up temp file
  if (fs.existsSync('scripts/_temp_issue.md')) {
    fs.unlinkSync('scripts/_temp_issue.md');
  }

  console.log('\n🎉 ALL ISSUES CREATED AND CROSS-LINKED BETWEEN JIRA AND GITHUB!');
}

run().catch((err) => {
  console.error('Error during sync:', err);
  process.exit(1);
});
