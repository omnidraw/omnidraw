/**
 * Used to inject for actor code run in new process to communicate with parent
 */

process.on('message', message => {
    console.log(message)
})
