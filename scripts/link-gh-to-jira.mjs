import { execSync } from 'child_process';

const links = [
  { gh: 30, jira: 'ZC-16' },
  { gh: 31, jira: 'ZC-17' },
  { gh: 32, jira: 'ZC-18' },
  { gh: 33, jira: 'ZC-19' },
  { gh: 34, jira: 'ZC-20' },
  { gh: 35, jira: 'ZC-21' },
  { gh: 36, jira: 'ZC-22' },
  { gh: 37, jira: 'ZC-23' },
  { gh: 38, jira: 'ZC-24' },
  { gh: 39, jira: 'ZC-25' },
  { gh: 40, jira: 'ZC-26' },
  { gh: 41, jira: 'ZC-27' },
  { gh: 42, jira: 'ZC-14' },
  { gh: 43, jira: 'ZC-15' },
];

for (const item of links) {
  const comment = `🔗 **Linked Jira Issue:** [${item.jira}](https://krishjaiswal2182003.atlassian.net/browse/${item.jira})`;
  console.log(`Commenting on GitHub Issue #${item.gh} -> ${item.jira}...`);
  try {
    execSync(`gh issue comment ${item.gh} --body "${comment}"`, { encoding: 'utf8' });
  } catch (err) {
    console.error(`Failed on #${item.gh}:`, err.message);
  }
}

console.log('Done! All GitHub issues linked to Jira!');
