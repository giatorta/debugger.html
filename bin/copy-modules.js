/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

const babel = require("@babel/core");
const glob = require("glob");
const fs = require("fs");
const path = require("path");
var shell = require("shelljs");
const minimist = require("minimist");

const feature = require("devtools-config");
const getConfig = require("./getConfig");

// Path to the mozilla-central clone is either passed via the --mc argument
// or read from the configuration.
const envConfig = getConfig();
feature.setConfig(envConfig);

const args = minimist(process.argv.slice(1), {
  string: ["mc"]
});

function getFiles() {
  return glob.sync("./src/**/*.js", {}).filter(file => {
    return !file.match(/(\/fixtures|\/tests|vendors\.js|types\.js|types\/)/);
  });
}

function transformSingleFile(filePath) {
  const doc = fs.readFileSync(filePath, "utf8");
  const out = babel.transformSync(doc, {
    plugins: [
      "transform-flow-strip-types",
      "syntax-trailing-function-commas",
      "transform-class-properties",
      "transform-es2015-modules-commonjs",
      "@babel/plugin-proposal-object-rest-spread",
      "transform-react-jsx",
      ["./.babel/transform-mc", { filePath }]
    ]
  });

  return out.code;
}

function transpileFiles() {
  getFiles().forEach(file => {
    const filePath = path.join(__dirname, "..", file);
    const code = transformSingleFile(filePath);
    shell.mkdir("-p", path.join(__dirname, "../out", path.dirname(file)));
    fs.writeFileSync(path.join(__dirname, "../out", file), code);
  });
}

const MOZ_BUILD_TEMPLATE = `# vim: set filetype=python:
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

DIRS += [
__DIRS__
]

DevToolsModules(
__FILES__
)
`;

/**
 * Create the mandatory manifest file that should exist in each folder to
 * list files and subfolders that should be packaged in Firefox.
 */
function createMozBuildFiles() {
  const builds = {};

  getFiles().forEach(file => {
    let dir = path.dirname(file);
    builds[dir] = builds[dir] || { files: [], dirs: [] };

    // Add the current file to its parent dir moz.build
    builds[dir].files.push(path.basename(file));

    // There should be a moz.build in every folder between the root and this
    // file. Climb up the folder hierarchy and make sure a each folder of the
    // chain is listing in its parent dir moz.build.
    while (path.dirname(dir) != ".") {
      const parentDir = path.dirname(dir);
      const dirName = path.basename(dir);

      builds[parentDir] = builds[parentDir] || { files: [], dirs: [] };
      if (!builds[parentDir].dirs.includes(dirName)) {
        builds[parentDir].dirs.push(dirName);
      }
      dir = parentDir;
    }
  });

  Object.keys(builds).forEach(build => {
    const { files, dirs } = builds[build];

    const buildPath = path.join(__dirname, "../out", build);
    shell.mkdir("-p", buildPath);

    // Files and folders should be alphabetically sorted in moz.build
    const fileStr = files
      .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
      .map(file => `    '${file}',`)
      .join("\n");

    const dirStr = dirs
      .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
      .map(dir => `    '${dir}',`)
      .join("\n");

    const src = MOZ_BUILD_TEMPLATE
      .replace("__DIRS__", dirStr)
      .replace("__FILES__", fileStr);

    fs.writeFileSync(path.join(buildPath, "moz.build"), src);
  });
}

function start() {
  console.log("[copy-modules] start");

  console.log("[copy-modules] cleanup temporary directory");
  shell.rm("-rf", "./out");
  shell.mkdir("./out");

  console.log("[copy-modules] transpiling debugger modules");
  transpileFiles();

  console.log("[copy-modules] creating moz.build files");
  createMozBuildFiles();

  const projectPath = path.resolve(__dirname, "..");
  const mcPath = args.mc ? args.mc : feature.getValue("firefox.mcPath");
  const mcDebuggerPath = path.join(mcPath, "devtools/client/debugger/new");

  console.log("[copy-modules] copying files to: " + mcDebuggerPath);
  shell.cp("-r", "./out/src", mcDebuggerPath);
  shell.rm("-r", "./out")

  console.log("[copy-modules] done");
}

start();
