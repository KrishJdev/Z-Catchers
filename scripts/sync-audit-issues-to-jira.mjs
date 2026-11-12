import fs from 'fs';
import path from 'path';

const JIRA_DOMAIN = (process.env.JIRA_DOMAIN || 'krishjaiswal2182003.atlassian.net').trim();
const JIRA_EMAIL = (process.env.JIRA_EMAIL || 'krish.jaiswal2182003@gmail.com').trim();
const JIRA_TOKEN = (process.env.JIRA_TOKEN || '').trim();
const PROJECT_ID = '10033'; // ZC project ID

if (!JIRA_TOKEN) {
  console.error('Missing JIRA_TOKEN. Please ensure JIRA_TOKEN is provided in environment.');
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

/**
 * Converts a structured Markdown string into valid Atlassian Document Format (ADF) v1
 */
function markdownToAdf(markdown) {
  const blocks = markdown.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  const content = [];

  for (const block of blocks) {
    // 1. Heading (## or ###)
    if (block.startsWith('#')) {
      const levelMatch = block.match(/^(#+)\s*(.*)/);
      const level = levelMatch ? Math.min(levelMatch[1].length, 6) : 2;
      const headingText = levelMatch ? levelMatch[2] : block.replace(/^#+\s*/, '');
      content.push({
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text: headingText }],
      });
      continue;
    }

    // 2. Bullet list
    if (block.startsWith('- ') || block.startsWith('* ')) {
      const listItems = block
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);

      content.push({
        type: 'bulletList',
        content: listItems.map((item) => ({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: item }],
            },
          ],
        })),
      });
      continue;
    }

    // 3. Numbered list
    if (/^\d+\.\s/.test(block)) {
      const listItems = block
        .split(/\r?\n/)
        .map((line) => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);

      content.push({
        type: 'orderedList',
        content: listItems.map((item) => ({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: item }],
            },
          ],
        })),
      });
      continue;
    }

    // 4. Code block
    if (block.startsWith('```')) {
      const lines = block.split(/\r?\n/);
      const codeLines = lines.slice(1, lines[lines.length - 1].startsWith('```') ? -1 : undefined);
      content.push({
        type: 'codeBlock',
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // 5. Normal paragraph with linebreaks
    const lines = block.split(/\r?\n/).filter(Boolean);
    const pContent = [];
    lines.forEach((line, idx) => {
      if (idx > 0) pContent.push({ type: 'hardBreak' });
      pContent.push({ type: 'text', text: line });
    });

    content.push({
      type: 'paragraph',
      content: pContent.length > 0 ? pContent : [{ type: 'text', text: block }],
    });
  }

  return {
    type: 'doc',
    version: 1,
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [{ type: 'text', text: 'Audit Finding' }] }],
  };
}

async function createJiraIssue(item) {
  const adfDescription = markdownToAdf(item.body);

  const payload = {
    fields: {
      project: { id: PROJECT_ID },
      summary: item.title,
      description: adfDescription,
      issuetype: { id: item.issueTypeId || '10067' },
      priority: { name: item.jiraPriority || 'Medium' },
    },
  };

  const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create Jira issue for "${item.title}": ${res.status} ${errorText}`);
  }

  return await res.json();
}

async function linkGitHubToJira(jiraKey, ghUrl, ghNumber, title) {
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
        title: `GitHub Issue #${ghNumber}: ${title}`,
        icon: {
          url16x16: 'https://github.githubassets.com/favicons/favicon.png',
          title: 'GitHub',
        },
      },
    }),
  });

  return res.ok;
}

async function syncAllToJira() {
  const mapFile = path.join(process.cwd(), 'scripts', 'audit-issues-map.json');
  if (!fs.existsSync(mapFile)) {
    console.error(`Map file not found: ${mapFile}`);
    process.exit(1);
  }

  const issuesList = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  console.log(`Syncing ${issuesList.length} issues to Jira (${JIRA_DOMAIN}, Project ID: ${PROJECT_ID})...\n`);

  const synchedResults = [];

  for (const item of issuesList) {
    console.log(`[Item #${item.id}] Creating Jira issue for: "${item.title}"...`);
    try {
      const jiraResult = await createJiraIssue(item);
      const jiraKey = jiraResult.key;
      const jiraUrl = `https://${JIRA_DOMAIN}/browse/${jiraKey}`;
      console.log(`  -> Created Jira issue: ${jiraKey} (${jiraUrl})`);

      // Add remote link to GitHub issue
      if (item.ghUrl && item.ghNumber) {
        console.log(`  -> Linking Jira ${jiraKey} to GitHub #${item.ghNumber}...`);
        const linked = await linkGitHubToJira(jiraKey, item.ghUrl, item.ghNumber, item.title);
        console.log(`  -> Remote link status: ${linked ? 'SUCCESS' : 'FAILED'}`);
      }

      synchedResults.push({
        ...item,
        jiraKey,
        jiraUrl,
      });
    } catch (err) {
      console.error(`  -> Failed for "${item.title}":`, err.message);
      synchedResults.push({
        ...item,
        error: err.message,
      });
    }
  }

  const finalMapFile = path.join(process.cwd(), 'scripts', 'audit-issues-synced.json');
  fs.writeFileSync(finalMapFile, JSON.stringify(synchedResults, null, 2), 'utf8');
  console.log(`\n============================================================`);
  console.log(`Synchronization Complete! Results saved to ${finalMapFile}`);
  console.log(`============================================================`);
  console.table(
    synchedResults.map((r) => ({
      ID: r.id,
      Priority: r.priorityTag,
      GitHub: r.ghNumber ? `#${r.ghNumber}` : 'N/A',
      Jira: r.jiraKey || 'FAILED',
      Title: r.title.slice(0, 50) + '...',
    }))
  );
}

syncAllToJira().catch(console.error);
