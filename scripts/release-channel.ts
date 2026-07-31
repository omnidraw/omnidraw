#!/usr/bin/env bun

/**
 * @file Infers release channels and npm dist-tags from package versions.
 */

import path from "path"

export type TReleaseChannel = "stable" | "beta" | "nightly"

export function inferReleaseChannelFromVersion(version: string): TReleaseChannel {
  const prerelease = version.split("-", 2)[1]?.trim().toLowerCase() ?? ""
  if (prerelease.startsWith("beta")) return "beta"
  if (prerelease.startsWith("nightly")) return "nightly"
  return "stable"
}

export function inferNpmTagFromVersion(version: string): string {
  const channel = inferReleaseChannelFromVersion(version)
  return channel === "stable" ? "latest" : channel
}

export async function readWrapperVersion(rootDir: string): Promise<string> {
  const pkg = await Bun.file(path.join(rootDir, "apps/omnidraw/package.json")).json() as { version?: string }
  const version = pkg.version?.trim()
  if (!version) {
    throw new Error("Failed to read apps/omnidraw/package.json version")
  }
  return version
}
