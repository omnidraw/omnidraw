// The legacy `file` procedures are the current media compatibility API.
// Their public route key stays `file` throughout M2.
export { fileContract as mediaContract } from '../file/contract';
export { fileHandlers as mediaHandlers } from '../file/handlers';
export type { TFileApiContext as TMediaApiContext } from '../file/types';
