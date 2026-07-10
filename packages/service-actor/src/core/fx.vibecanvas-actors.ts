import { ZVibecanvasJson as Z_VIBECANVAS_JSON } from "./vibecanvasjson.zod";
import { fnNormalizeVibecanvasJson } from "./fn.normalize-actor-manifest";

import type { TResolvedVibecanvasJson } from "./types";
import type { readdir, exists } from "node:fs/promises"
import type { join } from "node:path";

type TPortalListVibecanvasJsons = {
    Bun: typeof Bun,
    readdir: typeof readdir,
    join: typeof join,
    exists: typeof exists
}
type TArgsListVibecanvasJsons = {
    widgetDir: string

}

const VIBECANVAS_JSON = 'vibecanvas.json'

function formatZodIssuePath(path: unknown[]): string {
    if(path.length === 0) return '$'

    return path.reduce<string>((acc, part) => {
        if(typeof part === 'number') return `${acc}[${part}]`

        return `${acc}.${String(part)}`
    }, '$')
}

function formatZodIssue(issue: {path: unknown[], message: string}): string {
    return `${formatZodIssuePath(issue.path)}: ${issue.message}`
}

type TWidgetRepoResult = {
    vibecanvasJsonPath: string,
    error: string
    vibecanvasJson: null
    warnings: string[]
} | {
    vibecanvasJsonPath: string,
    error: null
    vibecanvasJson: TResolvedVibecanvasJson
    warnings: string[]
}

async function fxIsVibecanvasWidgetRepo(portal: TPortalListVibecanvasJsons, args: {repoDir: string}): Promise<TWidgetRepoResult | null> {
    const vibecanvasJsonPath = portal.join(args.repoDir, VIBECANVAS_JSON)
    if(!await portal.exists(vibecanvasJsonPath)) return null

    const file = portal.Bun.file(vibecanvasJsonPath)
    let parsedJson: unknown

    try {
        parsedJson = await file.json()
    } catch {
        return {
            vibecanvasJsonPath,
            error: `Could not parse json`,
            vibecanvasJson: null,
            warnings: [],
        }
    }

    const parsedVibecanvasJson = Z_VIBECANVAS_JSON.safeParse(parsedJson)
    if(!parsedVibecanvasJson.success) {
        return {
            vibecanvasJsonPath,
            error: parsedVibecanvasJson.error.issues.map(formatZodIssue).join('; '),
            vibecanvasJson: null,
            warnings: [],
        }
    }

    const normalized = fnNormalizeVibecanvasJson(parsedVibecanvasJson.data)
    return {
        vibecanvasJsonPath,
        error: null,
        vibecanvasJson: normalized.manifest,
        warnings: normalized.warnings,
    }
}

export async function fxListVibecanvasJsons(portal: TPortalListVibecanvasJsons, args: TArgsListVibecanvasJsons): Promise<TWidgetRepoResult[]> {
    const dirs = await portal.readdir(args.widgetDir, {withFileTypes: true})
    const results = await Promise.all(dirs.map(d => {
        if(!d.isDirectory()) return null

        return fxIsVibecanvasWidgetRepo(portal, {repoDir: portal.join(d.parentPath, d.name)})
    }))

    return results.filter((result): result is TWidgetRepoResult => result !== null)
}
