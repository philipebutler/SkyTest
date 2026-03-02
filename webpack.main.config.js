const path = require("path");

module.exports = {
  entry: {
    index: "./app/main/index.ts",
    preload: "./app/main/preload.ts",
  },
  target: "electron-main",
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
    filename: "[name].js",
    path: path.resolve(__dirname, "dist/main"),
  },
  externals: {
    playwright: "commonjs playwright",
    "playwright-core": "commonjs playwright-core",
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};
