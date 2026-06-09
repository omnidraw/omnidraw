import type { TVibecanvasJson } from "./types";
import type { readdir } from "node:fs/promises"

type TPortalListVibecanvasJsons = {
    Bun: typeof Bun,
    readdir: typeof readdir
}
type TArgsListVibecanvasJsons = {
    configPath: string

}

export async function fxListVibecanvasJsons(portal: TPortalListVibecanvasJsons, args: TArgsListVibecanvasJsons): Promise<TVibecanvasJson[]> {
    const dirs = await portal.readdir(args.configPath)
    console.log(dirs)

    return []
}