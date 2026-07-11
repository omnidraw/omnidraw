/**
 * @file Patches installed Automerge Repo throttle helpers to clamp negative timeout delays.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const targets = [join(process.cwd(), "node_modules/.bun")];

const patches = [
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/helpers/throttle.js",
    oldText: "        }, wait);\n",
    newText: "        }, Math.max(0, wait));\n",
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/helpers/throttle.ts",
    oldText: "    }, wait)\n",
    newText: "    }, Math.max(0, wait))\n",
  },
];

function patchFile(path, oldText, newText) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(oldText)) {
    if (source.includes(newText)) return false;
    throw new Error(`patch target not found in ${path}`);
  }
  writeFileSync(path, source.replaceAll(oldText, newText));
  return true;
}

let changed = 0;
for (const base of targets) {
  const entries = execSync(`find ${JSON.stringify(base)} -path '*/node_modules/@automerge/automerge-repo/*/helpers/throttle.*'`, {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const entry of entries) {
    for (const patch of patches) {
      if (!entry.endsWith(patch.suffix)) continue;
      if (patchFile(entry, patch.oldText, patch.newText)) changed += 1;
    }
  }
}

console.log(`[patch-automerge-repo-throttle] ${changed > 0 ? `patched ${changed} file(s)` : "already patched"}`);
