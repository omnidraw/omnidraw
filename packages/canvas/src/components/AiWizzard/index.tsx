import { createStore, SetStoreFunction } from "solid-js/store"

interface IProps {
}

export function AiWizzard(props: IProps) {
    const store = createStore({
        state: 'unauthenticated'
    })
    return <div>
    </div>
}