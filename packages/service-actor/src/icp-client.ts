/**
 * Used to inject for actor code run in new process to communicate with parent
 */

import { parseArgs } from 'util';

export type TFnPortal = {
  next: () => Promise<any>,
  emitMessage: (msg: any) => Promise<any>
}
export type TFnArgs<D = any, M = any> = {
  data: D;
  msg: M;
}
export type TFnFunc<D = any, M = any> = (portal: TFnPortal, args: TFnArgs<D, M>) => Promise<any>

export type TFxPortal = TFnPortal & {
  setData: (data: any) => Promise<any>,
}
export type TFxArgs<D = any, M = any> = TFnArgs<D, M>
export type TFxFunc<D = any, M = any> = (portal: TFxPortal, args: TFxArgs<D, M>) => Promise<any>

export type TTxPortal = TFxPortal & {}
export type TTxArgs<D = any, M = any> = TFnArgs<D, M>
export type TTxFunc<D = any, M = any> = (portal: TTxPortal, args: TTxArgs<D, M>) => Promise<any>

type TFunctionEntry =
    | { type: 'fn', func: TFnFunc }
    | { type: 'fx', func: TFxFunc }
    | { type: 'tx', func: TTxFunc };

type TParentRunMessage = {
    type: 'run';
    id: number;
    func: string[];
    payload: object;
    data: any;
}

type TParentAckMessage = {
    type: 'ack';
    id: number;
    action: 'next' | 'setData' | 'emitMessage';
}

if(!process.send) {
    console.error(`Must run as icp client via Bun.spawn`)
    process.exit(1)
}

const { values, positionals } = parseArgs({
    args: Bun.argv,
    strict: true,
    allowPositionals: true,
    options: {
        debug: { type: 'boolean', short: 'd', default: false },
        functionPath: { type: 'string' }

    }
})

function buildError(msg: any, id?: number) {
    return {
        type: 'error',
        error: true,
        id,
        msg
    }
}

if (!values.functionPath) {
    process.send(buildError(`functionPath not set`))
    process.exit(1)
}

const functions = require(values.functionPath)
const funcMap: {
    fn: { [key: string]: TFnFunc },
    fx: { [key: string]: TFxFunc },
    tx: { [key: string]: TTxFunc },
} = functions.default

const pendingAck = new Map<string, () => void>();

function getFn(name: string): TFnFunc | null {
    return funcMap.fn[name] ?? null
}

function getFx(name: string): TFxFunc | null {
    return funcMap.fx[name] ?? null
}

function getTx(name: string): TTxFunc | null {
    return funcMap.tx[name] ?? null
}

function validateIncomingMessage(message: unknown): TParentRunMessage | null {
    if(typeof message !== 'object' || message === null) {
        process.send!(buildError('message must be object'))
        return null;
    }
    if(!('type' in message) || message.type !== 'run') {
        return null;
    }
    if(!('id' in message) || typeof message.id !== 'number') {
        process.send!(buildError('message.id is missing'))
        return null;
    }
    if(!('func' in message)) {
        process.send!(buildError('message.func is missing', message.id))
        return null;
    }
    if(!Array.isArray(message.func)) {
        process.send!(buildError('message.func must be string[]', message.id))
        return null;
    }
    if(!('payload' in message)) {
        process.send!(buildError('message.payload is missing', message.id))
        return null;
    }
    if(typeof message.payload !== 'object' || message.payload === null) {
        process.send!(buildError('message.payload must be object', message.id))
        return null;
    }
    if(!('data' in message)) {
        process.send!(buildError('message.data is missing', message.id))
        return null;
    }

    return message as TParentRunMessage;
}

function buildFunctions(func: string[]): TFunctionEntry[] | string{
    const functions: TFunctionEntry[] = []
    let error: string | null = null;
    func.forEach(fName => {
        const fn = getFn(fName)
        if(fn) {
            functions.push({type: 'fn', func: fn})
            return
        }
        const fx = getFx(fName)
        if(fx) {
            functions.push({type: 'fx', func: fx})
            return
        }
        const tx = getTx(fName)
        if(tx) {
            functions.push({type: 'tx', func: tx})
            return
        }
        error = `${fName} not registered as function`
    })
    return error || functions;
}

function waitForAck(id: number, action: TParentAckMessage['action']) {
    return new Promise<void>((resolve) => {
        pendingAck.set(`${id}:${action}`, resolve)
    })
}

async function sendAndWaitForAck(id: number, action: TParentAckMessage['action'], message: Record<string, any>) {
    process.send!(message)
    await waitForAck(id, action)
}

function buildPortal(id: number, dataRef: { current: any }): TTxPortal {
    return {
        emitMessage: async (msg: any) => {
            await sendAndWaitForAck(id, 'emitMessage', { type: 'emitMessage', id, msg })
        },
        next: async () => {
            await sendAndWaitForAck(id, 'next', { type: 'next', id })
        },
        setData: async (data: any) => {
            dataRef.current = data;
            await sendAndWaitForAck(id, 'setData', { type: 'setData', id, data })
        },
    }
}

async function runMessage(message: TParentRunMessage) {
    const functions = buildFunctions(message.func)
    if(typeof functions === 'string') {
        process.send!(buildError(functions, message.id))
        return
    }

    const functionEntries = functions;
    const dataRef = { current: message.data };
    const portal = buildPortal(message.id, dataRef);

    async function runFunctionAt(index: number): Promise<any> {
        const entry = functionEntries[index];
        if (!entry) return undefined;

        let didCallNext = false;
        const stepPortal = {
            ...portal,
            next: async () => {
                didCallNext = true;
                await portal.next();
                return runFunctionAt(index + 1);
            },
        }

        const result = await entry.func(stepPortal, {msg: message.payload, data: dataRef.current})
        return didCallNext ? result : result;
    }

    try {
        await runFunctionAt(0)
        process.send!({ type: 'done', id: message.id })
    } catch (error) {
        process.send!(buildError(error, message.id))
    }
}

process.stdin.resume()

process.on('message', message => {
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'ack') {
        const ack = message as TParentAckMessage;
        const key = `${ack.id}:${ack.action}`;
        const resolve = pendingAck.get(key);
        if (resolve) {
            pendingAck.delete(key);
            resolve();
        }
        return;
    }

    const valid = validateIncomingMessage(message);
    if(valid === null) return;
    runMessage(valid)
})

if (values.debug) {
    console.log('start icp client', values, positionals);
}
