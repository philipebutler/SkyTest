const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./app/renderer/index.tsx",
  // Use "web" instead of "electron-renderer" because nodeIntegration is disabled.
  // "electron-renderer" emits code that references `global`, `process`, etc.
  // which don't exist in a renderer with contextIsolation: true / nodeIntegration: false.
  target: "web",
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "renderer.js",
    path: path.resolve(__dirname, "dist/renderer"),
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./app/renderer/index.html",
      filename: "index.html",
    }),
  ],
  devServer: {
    port: 3000,
    hot: true,
    static: path.resolve(__dirname, "dist/renderer"),
  },
};
