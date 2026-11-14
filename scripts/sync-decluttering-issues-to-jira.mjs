import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const JIRA_DOMAIN = (process.env.JIRA_DOMAIN || 'krishjaiswal2182003.atlassian.net').trim();
const JIRA_EMAIL = (process.env.JIRA_EMAIL || 'krish.jaiswal2182003@gmail.com').trim();
const JIRA_TOKEN = (process.env.JIRA_TOKEN || '').trim();
const PROJECT_ID = process.env.JIRA_PROJECT_ID || '10033'; // ZC project ID
const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

/**
 * Converts a structured Markdown string into valid Atlassian Document Format (ADF) v1
 */
export function markdownToAdf(markdown) {
  const blocks = (markdown || '').split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  const content = [];

  function processUnit(unit) {
    const trimmed = unit.trim();
    if (!trimmed) return;

    // 1. Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const listItems = trimmed
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
      return;
    }

    // 2. Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const listItems = trimmed
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
      return;
    }

    // 3. Code block
    if (trimmed.startsWith('```')) {
      const lines = trimmed.split(/\r?\n/);
      const codeLines = lines.slice(1, lines[lines.length - 1].startsWith('```') ? -1 : undefined);
      content.push({
        type: 'codeBlock',
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      return;
    }

    // 4. Normal paragraph with linebreaks
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const pContent = [];
    lines.forEach((line, idx) => {
      if (idx > 0) pContent.push({ type: 'hardBreak' });
      pContent.push({ type: 'text', text: line });
    });

    content.push({
      type: 'paragraph',
      content: pContent.length > 0 ? pContent : [{ type: 'text', text: trimmed }],
    });
  }

  function processContentBlock(text) {
    if (!text.trim()) return;
    if (text.includes('```')) {
      const parts = text.split(/(```[\s\S]*?```)/g);
      for (const part of parts) {
        processUnit(part);
      }
    } else {
      processUnit(text);
    }
  }

  for (const block of blocks) {
    let currentBlock = block;

    // Heading (## or ###)
    if (currentBlock.startsWith('#')) {
      const lines = currentBlock.split(/\r?\n/);
      const headingLine = lines[0];
      const levelMatch = headingLine.match(/^(#+)\s*(.*)/);
      const level = levelMatch ? Math.min(levelMatch[1].length, 6) : 2;
      const headingText = levelMatch ? levelMatch[2].trim() : headingLine.replace(/^#+\s*/, '').trim();

      content.push({
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text: headingText }],
      });

      currentBlock = lines.slice(1).join('\n').trim();
      if (!currentBlock) {
        continue;
      }
    }

    processContentBlock(currentBlock);
  }

  return {
    type: 'doc',
    version: 1,
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [{ type: 'text', text: 'Task Details' }] }],
  };
}

async function createJiraIssue(item) {
  const adfDescription = markdownToAdf(item.body);

  const payload = {
    fields: {
      project: { id: PROJECT_ID },
      summary: item.title,
      description: adfDescription,
      issuetype: { id: item.issueTypeId || '10071' },
      priority: { name: item.jiraPriority || 'Medium' },
    },
  };

  let res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // If 'Highest' priority is rejected by Jira project configuration, retry with 'High'
  if (!res.ok && item.jiraPriority === 'Highest') {
    console.warn(`  ⚠️ Jira rejected 'Highest' priority for "${item.title}". Retrying with 'High'...`);
    payload.fields.priority = { name: 'High' };
    res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

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
      globalId: ghUrl,
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

export async function syncAllToJira() {
  const mapFile = path.join(process.cwd(), 'scripts', 'decluttering-issues-map.json');
  const finalMapFile = path.join(process.cwd(), 'scripts', 'decluttering-issues-synced.json');

  if (!fs.existsSync(mapFile)) {
    console.error(`Map file not found: ${mapFile}. Run create-and-sync-decluttering-issues.mjs first.`);
    process.exit(1);
  }

  if (!JIRA_TOKEN) {
    console.error('Missing JIRA_TOKEN. Please ensure JIRA_TOKEN is provided in environment.');
    process.exit(1);
  }

  const issuesList = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

  // Incorporate existing synced entries if any
  if (fs.existsSync(finalMapFile)) {
    try {
      const syncedData = JSON.parse(fs.readFileSync(finalMapFile, 'utf8'));
      if (Array.isArray(syncedData)) {
        const syncedMap = new Map();
        for (const s of syncedData) {
          if (s && s.id != null) syncedMap.set(s.id, s);
        }
        for (let i = 0; i < issuesList.length; i++) {
          const item = issuesList[i];
          const synced = syncedMap.get(item.id);
          if (synced && synced.jiraKey) {
            issuesList[i] = {
              ...item,
              jiraKey: item.jiraKey || synced.jiraKey,
              jiraUrl: item.jiraUrl || synced.jiraUrl,
              remoteLinked: item.remoteLinked ?? synced.remoteLinked,
            };
          }
        }
      }
    } catch (e) {
      console.warn(`Could not read ${finalMapFile}:`, e.message);
    }
  }

  console.log(`Syncing ${issuesList.length} decluttering issues to Jira (${JIRA_DOMAIN}, Project ID: ${PROJECT_ID})...\n`);

  const synchedResults = [];

  for (let i = 0; i < issuesList.length; i++) {
    const item = { ...issuesList[i] };

    // 1. Create Jira issue if not already created
    if (!item.jiraKey) {
      console.log(`[Item #${item.id}] Creating Jira issue for: "${item.title}"...`);
      try {
        const jiraResult = await createJiraIssue(item);
        item.jiraKey = jiraResult.key;
        item.jiraUrl = `https://${JIRA_DOMAIN}/browse/${jiraResult.key}`;
        console.log(`   ✓ Created Jira issue: ${item.jiraKey} (${item.jiraUrl})`);
      } catch (err) {
        console.error(`   ❌ Failed to create Jira issue for "${item.title}":`, err.message);
        synchedResults.push({ ...item, error: err.message });
        continue;
      }
    } else {
      console.log(`[Item #${item.id}] Reusing existing Jira issue ${item.jiraKey}`);
    }

    // 2. Add remote link from Jira to GitHub
    if (item.jiraKey && item.ghUrl && !item.remoteLinked) {
      console.log(`   🔗 Linking Jira ${item.jiraKey} to GitHub #${item.ghNumber}...`);
      try {
        const linked = await linkGitHubToJira(item.jiraKey, item.ghUrl, item.ghNumber, item.title);
        item.remoteLinked = linked;
        console.log(`   ✓ Remote link status: ${linked ? 'SUCCESS' : 'FAILED'}`);
      } catch (linkErr) {
        console.warn(`   ⚠️ Remote link failed for ${item.jiraKey}:`, linkErr.message);
      }
    }

    // 3. Post a comment on the GitHub issue linking back to Jira
    if (item.jiraKey && item.ghNumber) {
      try {
        const comment = `🔗 **Linked Jira Issue:** [${item.jiraKey}](https://${JIRA_DOMAIN}/browse/${item.jiraKey}) [Priority: ${item.priorityTag}]`;
        console.log(`   💬 Posting Jira cross-link comment to GitHub #${item.ghNumber}...`);
        execSync(`gh issue comment ${item.ghNumber} --body "${comment}"`, { encoding: 'utf8' });
        console.log(`   ✓ GitHub comment posted successfully.`);
      } catch (commentErr) {
        console.warn(`   ⚠️ Could not comment on GitHub #${item.ghNumber}:`, commentErr.message);
      }
    }

    synchedResults.push(item);
    issuesList[i] = item;

    // Checkpoint
    fs.writeFileSync(mapFile, JSON.stringify(issuesList, null, 2), 'utf8');
    fs.writeFileSync(finalMapFile, JSON.stringify(synchedResults, null, 2), 'utf8');
  }

  console.log(`\n============================================================`);
  console.log(`Synchronization Complete! Results saved to ${finalMapFile}`);
  console.log(`============================================================`);
  console.table(
    synchedResults.map((r) => ({
      ID: r.id,
      Priority: r.priorityTag,
      GitHub: r.ghNumber ? `#${r.ghNumber}` : 'N/A',
      Jira: r.jiraKey || 'FAILED',
      Title: r.title.slice(0, 45) + '...',
    }))
  );

  return synchedResults;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  syncAllToJira().catch((err) => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  });
}
