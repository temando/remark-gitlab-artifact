import Promise from 'bluebird';
import 'isomorphic-fetch';
import visit from 'unist-util-visit';
import unzipper from 'unzipper';

const PLUGIN_NAME = 'remark-gitlab-artifact';

/**
 * Returns the destination for the SVG to be rendered at, explicity defined
 * using `vFile.data.destinationDir`, or falling back to the file's current
 * directory.
 *
 * @param {vFile} vFile
 * @return {string}
 */
function getDestinationDir(vFile) {
  if (vFile.data.destinationDir) {
    return vFile.data.destinationDir;
  }

  return vFile.dirname;
}

/**
 * Downloads an artifact from the Gitlab API using the `projectId` and `jobName`.
 *
 * @link https://docs.gitlab.com/ce/api/jobs.html#download-the-artifacts-file
 * @throws Error when download failed.
 * @param {string} apiBase
 * @param {string} token
 * @param {string|number} projectId
 * @param {string} jobName
 * @return {Promise<ReadableStream>}
 */
async function getArtifact(apiBase, token, projectId, jobName) {
  const url = `${apiBase}/api/v4/projects/${projectId}/jobs/artifacts/master/download?job=${jobName}`;
  const response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': token,
    },
  });

  if (response.status !== 200) {
    throw new Error(`${response.statusText} from ${url}.`);
  }

  return response.body;
}

/**
 * Extract's the `artifact` contents to the `destinationDir`.
 *
 * @param {string} destinationDir
 * @param {ReadableStream} artifact
 * @return {Promise}
 */
function extractArtifact(destinationDir, artifact) {
  return new Promise((resolve, reject) => {
    const unzip = unzipper.Extract({ path: destinationDir })
      .on('finish', resolve)
      .on('error', reject);

    artifact.pipe(unzip)
      .on('error', reject);
  });
}

/**
 * If links have a title attribute `gitlab-artifact:<project_id>:<job_name>`,
 * then download the build artifact to sit alongside this markdown (`vFile`).
 *
 * @param {object} ast
 * @param {object} vFile
 * @param {object} options
 * @return {Promise}
 */
function visitLink(ast, vFile, options) {
  const { apiBase, gitlabApiToken: token } = options;
  const nodes = [];

  // Get all nodes that have an `gitlab-artifact` title.
  visit(ast, 'link', (node) => {
    const { title } = node;

    if (!title || title.indexOf('gitlab-artifact|') === -1) {
      return node;
    }

    nodes.push(node);

    return node;
  });

  if (!nodes.length) {
    return Promise.resolve(ast);
  }

  return Promise.all(nodes.map(async (node) => {
    const { title, position } = node;
    const [, projectId, jobName] = title.split('|');

    try {
      const artifact = await getArtifact(apiBase, token, projectId, jobName);
      const destinationDir = getDestinationDir(vFile);
      await extractArtifact(destinationDir, artifact);

      // eslint-disable-next-line no-param-reassign
      node.title = '';

      vFile.info(`artifacts fetched from ${projectId} ${jobName}`, position, PLUGIN_NAME);
    } catch (error) {
      vFile.message(error, position, PLUGIN_NAME);
    }

    return node;
  }));
}

/**
 * Export the attacher which accepts options and returns the transformer to
 * act on the MDAST tree, given a VFile. Expects that `options.token` to
 * be set or this plugin will fail when calling the Gitlab API.
 *
 * @link https://github.com/unifiedjs/unified#function-attacheroptions
 * @param {object} options
 * @return {Promise<function>}
 */
export default function gitlabArtifact(options = {}) {
  /**
   * @link https://github.com/unifiedjs/unified#function-transformernode-file-next
   * @link https://github.com/syntax-tree/mdast
   * @link https://github.com/vfile/vfile
   * @param {object} ast MDAST
   * @param {object} vFile
   * @param {function} next
   * @return {object}
   */
  return async function transformer(ast, vFile, next) {
    try {
      await visitLink(ast, vFile, options);
    } catch (err) {
      // no-op, vFile will have the error message.
    }

    if (typeof next === 'function') {
      return next(null, ast, vFile);
    }

    return ast;
  };
}
