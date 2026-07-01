import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { createStore, SetStoreFunction } from "solid-js/store"

interface IProps {
    apiService: TOrpcSafeClient
}

export function AiWizzard(props: IProps) {
    props.apiService.api.actors.definitions.list({}).then(console.log)
    const store = createStore({
        state: 'unauthenticated'
    })
    return <div>
    </div>
}