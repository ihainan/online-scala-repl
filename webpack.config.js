const path = require("path");

module.exports = {
  entry: "./client/client.ts",
  devtool: "inline-source-map",
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "client-bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
};
