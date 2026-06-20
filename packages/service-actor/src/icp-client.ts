/**
 * Used to inject for actor code run in new process to communicate with parent
 */

import { parseArgs } from 'util';

export type TFnPortal = {
  next: () => Promise<void>,
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

function buildError(msg: string) {
    return {
        error: true,
        msg
    }
}

function buildMsg(msg: string) {
    return {
        error: false,
        msg
    }
}

if (!values.functionPath) {
    process.send(buildError(`functionPath not set`))
    process.exit(1)
}

const functions = require(values.functionPath)
console.log(functions, await functions.default.fn["fn.checkFunds"]())
const funcMap: {
    fn: { [key: string]: TFnFunc },
    fx: { [key: string]: TFxFunc },
    tx: { [key: string]: TTxFunc },
} = functions.default

function getFn(name: string): TFnFunc | null {
    return funcMap.fn[name] ?? null
}

function getFx(name: string): TFxFunc | null {
    return funcMap.fx[name] ?? null
}

function getTx(name: string): TTxFunc | null {
    return funcMap.tx[name] ?? null
}

function validateIncomingMessage(message: string | number | boolean | object | null): {func: string[], payload: Object, data: any} | null {
    if(typeof message !== 'object' || message === null) {
        process.send!(buildError('message must be object { name, payload }'))
        return null;
    }
    if(!('func' in message)) {
        process.send!(buildError('message.func is missing'))
        return null;
    }
    if(!Array.isArray(message.func)) {
        process.send!(buildError('message.func must be string[]'))
        return null;
    }
    if(!('payload' in message)) {
        process.send!(buildError('message.payload is missing'))
        return null;
    }
    if(typeof message.payload !== 'object') {
        process.send!(buildError('message.object must be object'))
        return null;
    }
    if(!('data' in message)) {
        process.send!(buildError('message.data is missing'))
        return null;
    }

    return message as {func: string[], payload: object, data: any};
}

function buildFunctions(func: string[]): ({type: 'fn', func: TFnFunc} | {type: 'fx', func: TFxFunc} | {type: 'tx', func: TTxFunc})[] | string{
    const functions: ({type: 'fn', func: TFnFunc} | {type: 'fx', func: TFxFunc} | {type: 'tx', func: TTxFunc})[] = []
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
        const tx = getFx(fName)
        if(tx) {
            functions.push({type: 'tx', func: tx})
            return
        }
        error = `${fName} not registered as function`
    })
    return error || functions;
}

async function emitMessage(msg: string) {
    console.log(msg)
}

process.stdin.resume()

process.on('message', message => {
    console.log(message)
    const valid = validateIncomingMessage(message);
    if(valid === null) return;

    const {func, payload, data} = valid;
    const functions = buildFunctions(func)
    if(typeof functions === 'string') {
        process.send!(buildError(functions))
        return
    }

    functions.forEach(async f => {
        if(f.type === 'fn') {
            f.func({
            emitMessage,
            next: async () => {}
            }, {msg: payload, data})
        }
    })







})



console.log('start icp client', values, positionals);
