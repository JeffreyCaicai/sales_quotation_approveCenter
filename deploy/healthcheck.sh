#!/bin/sh
set -eu

node -e '
const request = require("node:http").get("http://127.0.0.1:3000/api/health", (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { body += chunk; });
  response.on("end", () => {
    if (response.statusCode !== 200 || body !== "{\"status\":\"ok\"}") process.exit(1);
  });
});
request.setTimeout(4000, () => request.destroy(new Error("health check timed out")));
request.on("error", () => process.exit(1));
'
