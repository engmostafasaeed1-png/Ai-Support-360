import { describe, it, expect } from 'vitest';
import {
  MAX_CHUNK_CHARS,
  MAX_CHUNKS_PER_FILE,
  MAX_FILE_BYTES,
  docUrl,
  isBranchName,
  isSapDocsRepo,
  parseDoc,
  rawFileUrl,
  selectDocFiles,
  titleFromPath,
  treeApiUrl,
} from '../../supabase/functions/_shared/sapDocs.ts';

const SAMPLE = String.raw`<!-- loiocb9f0ac174a248c4bc7391e5bf5a0b1a -->

# Setting Up Authorization

The methods for assigning authorizations on SAP BTP include manual assignment, federation, and provisioning. In practice, you use all these methods according to the situation.

When your system has many users in widely used production accounts, identity federation or provisioning is the preferred method. We recommend provisioning over federation where possible.

**Methods for Assigning Authorizations**

<table>
<tr>
<th valign="top">

Method

</th>
<th valign="top">

Provisioning

</th>
</tr>
<tr>
<td valign="top">

Description

</td>
<td valign="top">

Provision user data with tools like Identity Provisioning and the SAP Cloud Identity Access Governance service.

Use tools such as the command-line interface \(btp CLI\) or the SAP BTP cockpit

</td>
</tr>
</table>

## Next steps

See [Setting Up Authentication](setting-up-authentication-1dbce9c.md) and ![diagram](images/x.png) the <a name="x"></a>related topics.
`;

describe('isSapDocsRepo / isBranchName', () => {
  it('accepts only repositories of the SAP-docs organisation', () => {
    expect(isSapDocsRepo('SAP-docs/sapui5')).toBe(true);
    expect(isSapDocsRepo('SAP-docs/btp-best-practices-guide')).toBe(true);
    expect(isSapDocsRepo('someone/else')).toBe(false);
    expect(isSapDocsRepo('SAP-docs/../x')).toBe(false);
    expect(isSapDocsRepo('SAP-docs/.hidden')).toBe(false);
    expect(isSapDocsRepo('SAP-docs/')).toBe(false);
    expect(isSapDocsRepo(42)).toBe(false);
    expect(isSapDocsRepo(null)).toBe(false);
  });

  it('accepts plain branch names only', () => {
    expect(isBranchName('main')).toBe(true);
    expect(isBranchName('release/1.2')).toBe(true);
    expect(isBranchName('a/../b')).toBe(false);
    expect(isBranchName('')).toBe(false);
    expect(isBranchName('-x')).toBe(false);
    expect(isBranchName(undefined)).toBe(false);
  });
});

describe('links', () => {
  it('builds the tree, raw and page addresses and encodes the path', () => {
    expect(treeApiUrl('SAP-docs/sapui5', 'main')).toBe('https://api.github.com/repos/SAP-docs/sapui5/git/trees/main?recursive=1');
    expect(rawFileUrl('SAP-docs/sapui5', 'main', 'docs/a b/c#d.md')).toBe('https://raw.githubusercontent.com/SAP-docs/sapui5/main/docs/a%20b/c%23d.md');
    expect(docUrl('SAP-docs/sapui5', 'main', 'docs/a b/c#d.md')).toBe('https://github.com/SAP-docs/sapui5/blob/main/docs/a%20b/c%23d.md');
  });
});

describe('selectDocFiles', () => {
  it('keeps documentation pages and drops everything else', () => {
    const tree = [
      { path: 'README.md', type: 'blob', size: 500 },
      { path: 'docs', type: 'tree' },
      { path: 'docs/a.md', type: 'blob', size: 1200 },
      { path: 'docs/security-concepts-951d36c.md', type: 'blob', size: 900 },
      { path: 'docs/SECURITY.md', type: 'blob', size: 900 },
      { path: 'docs/01_Whats-New/what-s-new-1-100.md', type: 'blob', size: 900 },
      { path: 'docs/change-log-a6a78b7.md', type: 'blob', size: 900 },
      { path: '.github/pull_request_template.md', type: 'blob', size: 900 },
      { path: 'docs/images/pic.png', type: 'blob', size: 900 },
      { path: 'docs/empty.md', type: 'blob', size: 0 },
      { path: 'docs/huge.md', type: 'blob', size: MAX_FILE_BYTES + 1 },
      { path: 'docs/sub/B.MD', type: 'blob', size: 300 },
      null,
      { path: 7, type: 'blob', size: 5 },
    ];
    expect(selectDocFiles(tree)).toEqual([
      { path: 'docs/a.md', bytes: 1200 },
      { path: 'docs/security-concepts-951d36c.md', bytes: 900 },
      { path: 'docs/sub/B.MD', bytes: 300 },
    ]);
  });

  it('gives nothing for something that is not a list', () => {
    expect(selectDocFiles('nope')).toEqual([]);
    expect(selectDocFiles(undefined)).toEqual([]);
  });
});

describe('titleFromPath', () => {
  it('makes a readable title from the file name', () => {
    expect(titleFromPath('docs/set-up-and-plan/setting-up-authorization-cb9f0ac.md')).toBe('Setting up authorization');
    expect(titleFromPath('docs/index.md')).toBe('Index');
    expect(titleFromPath('docs/a_b-c.md')).toBe('A b c');
  });
});

describe('parseDoc', () => {
  it('turns a real SAP page into clean text chunks', () => {
    const doc = parseDoc('docs/set-up-and-plan/setting-up-authorization-cb9f0ac.md', SAMPLE);
    expect(doc.title).toBe('Setting Up Authorization');
    const all = doc.chunks.map((c) => c.body).join('\n');
    expect(all).not.toMatch(/loio/);
    expect(all).not.toMatch(/<t[dhr]|<table|<a /);
    expect(all).not.toMatch(/\]\(|!\[/);
    expect(all).not.toMatch(/\.md/);
    expect(all).toContain('command-line interface (btp CLI)');
    expect(all).toContain('Setting Up Authentication');
    expect(all).toContain('related topics');
    expect(all).toContain('Provision user data with tools like Identity Provisioning');
    expect(doc.chunks).toHaveLength(2);
    expect(doc.chunks[0].heading).toBeNull();
    expect(doc.chunks[1].heading).toBe('Next steps');
    expect(doc.chunks.map((c) => c.chunkNo)).toEqual([0, 1]);
    for (const c of doc.chunks) expect(c.body.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    expect(doc.textBytes).toBeGreaterThan(300);
  });

  it('keeps code but not the fence lines', () => {
    const md = '# Command\n\nRun the following command in the terminal to push the application to the Cloud Foundry space of your subaccount and check the result.\n\n```bash\ncf push my-app -f manifest.yml\n```\n\nThen open the application URL in the browser and check that the start page appears as expected.\n';
    const doc = parseDoc('docs/command.md', md);
    const all = doc.chunks.map((c) => c.body).join('\n');
    expect(all).toContain('cf push my-app -f manifest.yml');
    expect(all).not.toContain('```');
  });

  it('gives no chunks for a page that is only a list of links', () => {
    const md = '<!-- loio1 -->\n\n# Configuring External Navigation\n\n-   [Navigation from an App \\(Outbound Navigation\\)](a.md)\n\n-   [Navigation to an App](b.md)\n';
    const doc = parseDoc('docs/x-1234567.md', md);
    expect(doc.title).toBe('Configuring External Navigation');
    expect(doc.chunks).toEqual([]);
    expect(doc.textBytes).toBe(0);
  });

  it('cuts a long paragraph at sentence ends and loses nothing', () => {
    const sentence = 'This sentence is one of many in a very long paragraph without any break. ';
    const doc = parseDoc('docs/long.md', `# Long\n\n${sentence.repeat(120)}\n`);
    expect(doc.chunks.length).toBeGreaterThan(3);
    for (const c of doc.chunks) expect(c.body.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    const joined = doc.chunks.map((c) => c.body).join(' ').replace(/\s+/g, ' ');
    expect(joined).toBe(sentence.repeat(120).trim());
  });

  it('cuts a text without any space or full stop', () => {
    const doc = parseDoc('docs/blob.md', `# Blob\n\n${'x'.repeat(5000)}\n`);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of doc.chunks) expect(c.body.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    expect(doc.chunks.map((c) => c.body).join('').length).toBe(5000);
  });

  it('starts a new chunk at a heading of level 1 to 3 and keeps smaller headings inside', () => {
    const md = `# Title\n\n${'Intro text. '.repeat(20)}\n\n## First part\n\n${'First text. '.repeat(20)}\n\n### Sub part\n\n${'Sub text. '.repeat(20)}\n\n#### Small\n\nshort\n`;
    const doc = parseDoc('docs/parts.md', md);
    expect(doc.chunks.map((c) => c.heading)).toEqual([null, 'First part', 'Sub part']);
    expect(doc.chunks[2].body).toContain('Small');
    expect(doc.chunks[2].body).toContain('short');
  });

  it('keeps at most 40 chunks of a file', () => {
    const md = Array.from({ length: 100 }, (_, i) => `## Section ${i}\n\n${'Word '.repeat(30)}`).join('\n\n');
    const doc = parseDoc('docs/many.md', md);
    expect(doc.chunks).toHaveLength(MAX_CHUNKS_PER_FILE);
  });

  it('resolves escapes, entities and emphasis', () => {
    const md = `# Escapes\n\n${'Use \\(brackets\\) and *italic* and **bold** and A &amp; B and 1 &lt; 2 with a `code` word, repeated. '.repeat(3)}\n`;
    const doc = parseDoc('docs/e.md', md);
    expect(doc.chunks[0].body).toContain('Use (brackets) and italic and bold and A & B and 1 < 2 with a `code` word, repeated.');
  });

  it('drops front matter, block quote marks and the line under a table header', () => {
    const md = `---\ntitle: x\n---\n# Real title\n\n> ### Note:\n> Remember to save the file and restart the application after you have changed the configuration option.\n\n| a | b |\n|:---|:---|\n| c | d |\n\n${'More text to reach the minimum size. '.repeat(5)}\n`;
    const doc = parseDoc('docs/f.md', md);
    expect(doc.title).toBe('Real title');
    const all = doc.chunks.map((c) => c.body).join('\n');
    expect(all).not.toMatch(/title: x/);
    expect(all).not.toMatch(/> /);
    expect(all).not.toContain(':---');
    expect(all).toContain('| c | d |');
    expect(all).toContain('Remember to save the file');
  });

  it('removes an image whose caption runs over two lines', () => {
    const md = `# Step 3: Controls\n\n${'Now it is time to build our first little UI by replacing the text. '.repeat(4)}\n\n![Hello World](images/step_03.png "The "Hello World" text is now displayed by a SAPUI5\n\t\t\tcontrol")\n\nThe next paragraph stays.\n`;
    const doc = parseDoc('docs/step-3.md', md);
    const all = doc.chunks.map((c) => c.body).join('\n');
    expect(all).not.toContain('![');
    expect(all).not.toContain('step_03.png');
    expect(all).not.toContain('control"');
    expect(all).toContain('The next paragraph stays.');
  });

  it('drops a byte order mark and control characters', () => {
    const md = `${String.fromCharCode(0xfeff)}# Title\n\n${'Some text with a control character \u0000 in it and more words to reach the minimum size. '.repeat(4)}\n`;
    const doc = parseDoc('docs/bom.md', md);
    expect(doc.title).toBe('Title');
    const all = doc.chunks.map((c) => c.body).join('\n');
    expect(all).not.toContain('\u0000');
    expect(all).toContain('control character');
  });

  it('takes the title from the file name when the page has no first-level heading', () => {
    const doc = parseDoc('docs/guides/setting-up-things-1234567.md', `Some text about things. ${'More words here. '.repeat(20)}\n`);
    expect(doc.title).toBe('Setting up things');
    expect(doc.chunks.length).toBeGreaterThan(0);
  });
});
