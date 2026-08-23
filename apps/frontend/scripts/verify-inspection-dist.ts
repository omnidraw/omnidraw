#!/usr/bin/env bun

import { resolve } from "node:path";
import { verifyAndSealInspectionDist } from "./inspection-dist";

const shellRoot = resolve(import.meta.dir, "..", "dist", "inspection");
const receipt = await verifyAndSealInspectionDist(shellRoot);
console.log(`[inspection-dist] verified and sealed ${receipt.buildId} (${receipt.files.length} files)`);
