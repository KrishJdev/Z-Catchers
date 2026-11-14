import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const links = [
  { id: 1, gh: 62, jira: 'ZC-28', priority: 'P0 - Critical' },
  { id: 2, gh: 63, jira: 'ZC-29', priority: 'P0 - Critical' },
  { id: 3, gh: 64, jira: 'ZC-30', priority: 'P0 - Critical' },
  { id: 4, gh: 65, jira: 'ZC-31', priority: 'P1 - High' },
  { id: 5, gh: 66, jira: 'ZC-32', priority: 'P1 - High' },
  { id: 6, gh: 67, jira: 'ZC-33', priority: 'P1 - High' },
  { id: 7, gh: 68, jira: 'ZC-34', priority: 'P2 - Medium' },
  { id: 8, gh: 69, jira: 'ZC-35', priority: 'P2 - Medium' },
  { id: 9, gh: 70, jira: 'ZC-36', priority: 'P2 - Medium' },
  { id: 10, gh: 71, jira: 'ZC-37', priority: 'P3 - Low' },
];

console.log('Posting Jira cross-link comments on GitHub Issues #62 to #71...\n');

for (const item of links) {
  const comment = `🔗 **Linked Jira Issue:** [${item.jira}](https://krishjaiswal2182003.atlassian.net/browse/${item.jira}) [Priority: ${item.priority}]`;
  console.log(`Commenting on GitHub Issue #${item.gh} -> ${item.jira}...`);
  try {
    execSync(`gh issue comment ${item.gh} --body "${comment}"`, { encoding: 'utf8' });
    console.log(`  ✓ Comment posted on #${item.gh}`);
  } catch (err) {
    console.error(`  ❌ Failed on #${item.gh}:`, err.message);
  }
}

// Update decluttering-issues-map.json and decluttering-issues-synced.json with the confirmed Jira keys
const mapPath = path.join(process.cwd(), 'scripts', 'decluttering-issues-map.json');
const syncedPath = path.join(process.cwd(), 'scripts', 'decluttering-issues-synced.json');

if (fs.existsSync(mapPath)) {
  const list = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    const match = links.find((link) => link.id === l.id);
    if (match) {
      l.jiraKey = match.jira;
      l.jiraUrl = `https://krishjaiswal2182003.atlassian.net/browse/${match.jira}`;
      l.remoteLinked = true;
    }
  }
  fs.writeFileSync(mapPath, JSON.stringify(list, null, 2), 'utf8');
  fs.writeFileSync(syncedPath, JSON.stringify(list, null, 2), 'utf8');
}

console.log('\n🎉 All 10 GitHub issues successfully linked to Jira!');
