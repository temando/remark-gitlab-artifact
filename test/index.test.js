// This puts fetch in the global scope, which allows fetch-mock to work.
import 'isomorphic-fetch';
import fetchMock from 'fetch-mock';
import fs from 'fs';
import toVFile from 'to-vfile';
import path from 'path';
import unified from 'unified';
import parse from 'remark-parse';
import stringify from 'remark-stringify';
import gitlab from './../src/';

const fixturesDir = path.join(__dirname, '/fixtures');
const runtimeDir = path.join(__dirname, '/runtime');
const remark = unified().use(parse).use(stringify).freeze();

// Utility function to add metdata to a vFile.
function addMetadata(vFile, destinationFilePath) {
  vFile.data = {
    destinationFilePath,
    destinationDir: path.dirname(destinationFilePath),
  };
}

describe('remark-gitlab-artifact', () => {
  beforeEach(() => {
    fetchMock.restore();
  });

  it('ignores markdown that does not have artifact references', async () => {
    const originalContents = '# This is a demo';

    const result = await remark().use(gitlab, {
      apiBase: 'https://src.temando.io',
      gitlabApiToken: 'skip',
    }).process(originalContents);

    expect(fetchMock.called()).toBeFalsy();
    expect(result.contents.trim()).toEqual(originalContents);
    expect(result.messages).toHaveLength(0);
  });

  it('can handle errors when retrieving artifacts from Gitlab', async () => {
    const srcFile = `${fixturesDir}/link.md`;
    const destFile = `${runtimeDir}/link.md`;
    const vfile = toVFile.readSync(srcFile);
    addMetadata(vfile, destFile);

    // Set fetch mock to fail.
    const response = new Response(
      { message: '404 Not found' },
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    fetchMock.get('*', response, { headers: { 'PRIVATE-TOKEN': 'fail' } });

    const result = await remark().use(gitlab, {
      apiBase: 'https://src.temando.io',
      gitlabApiToken: 'fail',
    }).process(vfile);

    expect(fetchMock.called()).toBeTruthy();
    expect(result.toString()).not.toMatch(/\(docs\/index.html\)/);
    expect(vfile.messages[0].message).toContain('Not Found');
  });

  it('can handle retrieving artifacts from Gitlab for links', async () => {
    const srcFile = `${fixturesDir}/link.md`;
    const destFile = `${runtimeDir}/link.md`;
    const vfile = toVFile.readSync(srcFile);
    addMetadata(vfile, destFile);

    // Set fetch mock to pass!
    const response = new Response(
      fs.createReadStream(`${fixturesDir}/artifact.zip`),
      {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      },
    );
    fetchMock.get('*', response, { headers: { 'PRIVATE-TOKEN': 'success' } });

    const result = await remark().use(gitlab, {
      apiBase: 'https://src.temando.io',
      gitlabApiToken: 'success',
    }).process(vfile);

    expect(fetchMock.called()).toBeTruthy();
    expect(result.toString()).toMatch(/\(docs\/index.html\)/);
    expect(fs.existsSync(`${runtimeDir}/index.html`)).toBeTruthy();
    expect(vfile.messages[0].message).toBe('artifacts fetched from 1095 build:docs');
  });
});
