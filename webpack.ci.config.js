/**
 * Webpack config for the CI runner (Issue #24).
 *
 * Produces a standalone Node.js bundle at dist/ci/ci-runner.js that can be
 * executed with `node dist/ci/ci-runner.js` without the Electron UI.
 */

const path = require("path");

module.exports = {
  entry: "./app/main/runner/CIRunner.ts",
  target: "node",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "ci-runner.js",
    path: path.resolve(__dirname, "dist/ci"),
    libraryTarget: "commonjs2",
  },
  node: {
    __dirname: false,
    __filename: false,
  },
  externals: {
    // Exclude Playwright from the bundle – it is resolved at runtime from node_modules
    playwright: "commonjs playwright",
  },
};
