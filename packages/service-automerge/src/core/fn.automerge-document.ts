export function fnAutomergeScopedKey(namespace: string, parts: readonly string[]): string {
  return [namespace, ...parts]
    .map((part) => `${part.length}:${part}`)
    .join('|');
}

export function fnAutomergeDocumentKeyFromUrl(automergeUrl: string): string {
  return automergeUrl.startsWith('automerge:')
    ? automergeUrl.slice('automerge:'.length)
    : automergeUrl;
}

export function fnAutomergeUrlFromDocumentKey(documentKey: string): string {
  return documentKey.startsWith('automerge:')
    ? documentKey
    : `automerge:${documentKey}`;
}

export function fnAutomergeDocumentScopeKey(orgId: string, automergeUrl: string): string {
  return fnAutomergeScopedKey('automerge-document', [orgId, fnAutomergeDocumentKeyFromUrl(automergeUrl)]);
}

export function fnAutomergeOrganizationScopeKey(orgId: string): string {
  return fnAutomergeScopedKey('automerge-organization', [orgId]);
}

export function fnAutomergePeerScopeKey(orgId: string, peerId: string): string {
  return fnAutomergeScopedKey('automerge-peer', [orgId, peerId]);
}

export function fnAutomergeConnectionScopeKey(orgId: string, connectionId: string): string {
  return fnAutomergeScopedKey('automerge-connection', [orgId, connectionId]);
}
