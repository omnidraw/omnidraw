/**
 * Used to inject for actor code run in new process to communicate with parent
 */

import { parseArgs } from 'util';
if(!process.send) {
    console.error(`Must run as icp client via Bun.spawn`)
    process.exit(1)
}

process.on('message', message => {
    console.log(message)
})


const { values, positionals } = parseArgs({
    args: Bun.argv,
    strict: true,
    allowPositionals: true,
    options: {
        debug: { type: 'boolean', short: 'd', default: false },
        functionPath: { type: 'string' }

    }
})

process.send({
    error: false,
    message: `hello`
})

if (!values.functionPath) {
    process.send({
        error: true,
        message: `functionPath not set`
    })
    process.exit(1)
}

console.log('start icp client', values, positionals);
