// Media procedures remain private behind the application-owned API boundary.
export { fileContract as mediaContract } from '../file/contract';
export { fileHandlers as mediaHandlers } from '../file/handlers';
export type { TFileApiContext as TMediaApiContext } from '../file/types';
