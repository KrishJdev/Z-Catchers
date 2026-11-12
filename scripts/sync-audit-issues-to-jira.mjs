import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const JIRA_DOMAIN = (process.env.JIRA_DOMAIN || 'krishjaiswal2182003.atlassian.net').trim();
const JIRA_EMAIL = (process.env.JIRA_EMAIL || 'krish.jaiswal2182003@gmail.com').trim();
const JIRA_TOKEN = (process.env.JIRA_TOKEN || '').trim();
const PROJECT_ID = '10033'; // ZC project ID

const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

/**
 * Converts a structured Markdown string into valid Atlassian Document Format (ADF) v1
 */
export function markdownToAdf(markdown) {
  const blocks = markdown.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
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
    if (text.includes('```') && !text.trim().startsWith('```')) {
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

    // 1. Heading (## or ###) - recognize individual line rather than treating entire block as heading
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

      // Preserve and process the text following the heading as section content
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
      issuetype: { id: item.issueTypeId || '10071' },
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

export async function syncAllToJira() {
  const mapFile = path.join(process.cwd(), 'scripts', 'audit-issues-map.json');
  const finalMapFile = path.join(process.cwd(), 'scripts', 'audit-issues-synced.json');

  if (!fs.existsSync(mapFile)) {
    console.error(`Map file not found: ${mapFile}`);
    process.exit(1);
  }

  if (!JIRA_TOKEN) {
    console.error('Missing JIRA_TOKEN. Please ensure JIRA_TOKEN is provided in environment.');
    process.exit(1);
  }

  const issuesList = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

  // Incorporate saved Jira keys from audit-issues-synced.json by stable audit ID before creating issues
  if (fs.existsSync(finalMapFile)) {
    try {
      const syncedData = JSON.parse(fs.readFileSync(finalMapFile, 'utf8'));
      if (Array.isArray(syncedData)) {
        const syncedMap = new Map();
        for (const s of syncedData) {
          if (s && s.id != null) {
            syncedMap.set(s.id, s);
          }
        }
        for (let i = 0; i < issuesList.length; i++) {
          const item = issuesList[i];
          const synced = syncedMap.get(item.id);
          if (synced) {
            issuesList[i] = {
              ...item,
              jiraKey: item.jiraKey || synced.jiraKey,
              jiraUrl: item.jiraUrl || synced.jiraUrl,
              remoteLinked: item.remoteLinked ?? synced.remoteLinked,
              ...(synced.remoteLinkError && !item.remoteLinked ? { remoteLinkError: synced.remoteLinkError } : {}),
            };
          }
        }
      }
    } catch (e) {
      console.warn(`Warning: Could not read ${finalMapFile}:`, e.message);
    }
  }

  console.log(`Syncing ${issuesList.length} issues to Jira (${JIRA_DOMAIN}, Project ID: ${PROJECT_ID})...\n`);

  let hasFailure = false;
  const synchedResults = [];

  for (const item of issuesList) {
    let currentItem = { ...item };

    // 1. Create Jira issue if not already created
    if (!currentItem.jiraKey) {
      console.log(`[Item #${currentItem.id}] Creating Jira issue for: "${currentItem.title}"...`);
      try {
        const jiraResult = await createJiraIssue(currentItem);
        // Checkpoint jiraKey and jiraUrl immediately after successful creation
        currentItem.jiraKey = jiraResult.key;
        currentItem.jiraUrl = `https://${JIRA_DOMAIN}/browse/${jiraResult.key}`;
        delete currentItem.error;
        console.log(`  -> Created Jira issue: ${currentItem.jiraKey} (${currentItem.jiraUrl})`);
      } catch (err) {
        console.error(`  -> Failed for "${currentItem.title}":`, err.message);
        currentItem.error = err.message;
        hasFailure = true;
        synchedResults.push(currentItem);
        continue;
      }
    } else {
      console.log(`[Item #${currentItem.id}] Existing Jira issue: ${currentItem.jiraKey} (${currentItem.title.slice(0, 40)}...)`);
    }

    // 2. Link GitHub to Jira: retries link the existing Jira issue rather than creating a duplicate
    if (currentItem.ghUrl && currentItem.ghNumber) {
      if (currentItem.remoteLinked) {
        console.log(`  -> Remote link to GitHub #${currentItem.ghNumber} already active.`);
      } else {
        console.log(`  -> Linking Jira ${currentItem.jiraKey} to GitHub #${currentItem.ghNumber}...`);
        try {
          const linked = await linkGitHubToJira(currentItem.jiraKey, currentItem.ghUrl, currentItem.ghNumber, currentItem.title);
          if (linked) {
            console.log(`  -> Remote link status: SUCCESS`);
            currentItem.remoteLinked = true;
            delete currentItem.remoteLinkError;
          } else {
            console.error(`  -> Remote link status: FAILED (non-2xx response)`);
            currentItem.remoteLinked = false;
            currentItem.remoteLinkError = 'Failed to create remote link (non-2xx response)';
            hasFailure = true;
          }
        } catch (linkErr) {
          console.error(`  -> Failed for "${currentItem.title}":`, linkErr.message);
          currentItem.remoteLinked = false;
          currentItem.remoteLinkError = linkErr.message;
          hasFailure = true;
        }
      }
    }

    synchedResults.push(currentItem);
  }

  // Use one authoritative mapping for reads and writes, preserving existing mappings and preventing already-synced records from being created again
  fs.writeFileSync(finalMapFile, JSON.stringify(synchedResults, null, 2), 'utf8');
  fs.writeFileSync(mapFile, JSON.stringify(synchedResults, null, 2), 'utf8');

  console.log(`\n============================================================`);
  console.log(`Synchronization Complete! Results saved to ${finalMapFile} and ${mapFile}`);
  console.log(`============================================================`);
  console.table(
    synchedResults.map((r) => ({
      ID: r.id,
      Priority: r.priorityTag,
      GitHub: r.ghNumber ? `#${r.ghNumber}` : 'N/A',
      Jira: r.jiraKey || 'FAILED',
      RemoteLink: r.remoteLinked ? 'LINKED' : (r.remoteLinkError ? 'FAILED' : (r.ghNumber ? 'PENDING' : 'N/A')),
      Title: r.title.slice(0, 50) + '...',
    }))
  );

  if (hasFailure) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  syncAllToJira().catch((err) => {
    console.error('Fatal synchronization failure:', err);
    process.exit(1);
  });
}
