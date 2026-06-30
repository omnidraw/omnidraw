import { ZVibecanvasJson as Z_VIBECANVAS_JSON } from "./vibecanvasjson.zod";

import type { TVibecanvasJson } from "./types";
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
} | {
    vibecanvasJsonPath: string,
    error: null
    vibecanvasJson: TVibecanvasJson
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
            vibecanvasJson: null
        }
    }

    const parsedVibecanvasJson = Z_VIBECANVAS_JSON.safeParse(parsedJson)
    if(!parsedVibecanvasJson.success) {
        return {
            vibecanvasJsonPath,
            error: parsedVibecanvasJson.error.issues.map(formatZodIssue).join('; '),
            vibecanvasJson: null
        }
    }

    return {
        vibecanvasJsonPath,
        error: null,
        vibecanvasJson: parsedVibecanvasJson.data as TVibecanvasJson
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