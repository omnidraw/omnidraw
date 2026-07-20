export function fnDraftPreviewElementId(draftId: string): string {
  let encodedDraftId = ""
  for (let index = 0; index < draftId.length; index += 1) {
    encodedDraftId += draftId.charCodeAt(index).toString(16).padStart(4, "0")
  }
  return `draft-preview-v1-${encodedDraftId}`
}
