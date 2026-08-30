#!/usr/bin/env bash

read_env_value() {
  local env_file="$1" key="$2"
  node - "$env_file" "$key" <<'NODE'
const fs = require('fs');
const [envFile, key] = process.argv.slice(2);
const line = fs.readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((candidate) => candidate.startsWith(`${key}=`));
if (!line) process.exit(2);
let value = line.slice(key.length + 1).trim();
if (value.startsWith('"') && value.endsWith('"')) {
  value = value.slice(1, -1).replace(/\\([\\"$`])/g, '$1');
}
process.stdout.write(value);
NODE
}

migration_response_ok() {
  node -e '
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const summary = parsed && parsed.summary;
        process.exit(summary && Number(summary.errors) === 0 ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  '
}

activate_release() {
  local release_dir="$1" current_link="$2"
  local next_link="${current_link}.next"
  node - "$release_dir" "$current_link" "$next_link" <<'NODE'
const fs = require('fs');
const [releaseDir, currentLink, nextLink] = process.argv.slice(2);
try { fs.unlinkSync(nextLink); } catch (err) { if (err.code !== 'ENOENT') throw err; }
fs.symlinkSync(releaseDir, nextLink);
fs.renameSync(nextLink, currentLink);
NODE
}
