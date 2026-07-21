export function fnDraftPreviewElementId(draftId: string, instanceId?: string): string {
  let encodedIdentity = ""
  const identity = instanceId === undefined ? draftId : `${draftId}\u0000${instanceId}`
  for (let index = 0; index < identity.length; index += 1) {
    encodedIdentity += identity.charCodeAt(index).toString(16).padStart(4, "0")
  }
  return `draft-preview-v1-${encodedIdentity}`
}
