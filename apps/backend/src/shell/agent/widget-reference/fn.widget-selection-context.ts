import type { TWidgetPromptSelectionContext } from './typed';

export function fnWidgetPromptSelectionMessage(
  context: TWidgetPromptSelectionContext,
): string {
  return JSON.stringify({
    format: 'omnidraw.widget-selection.v1',
    canvas: { id: context.canvasId, verified: true },
    explicitlyMentioned: context.explicitlyMentioned.map((reference) => ({
      widgetKey: reference.widgetKey,
      requestedVariant: reference.requestedVariant,
      displayName: reference.displayName,
      health: reference.health,
      draftAvailable: reference.draftAvailable,
      publicationAvailable: reference.publicationAvailable,
      editableVariant: reference.editableDraft === null ? null : 'draft',
      build: reference.editableDraft === null ? null : {
        phase: reference.editableDraft.buildPhase,
        acceptedGeneration: reference.editableDraft.acceptedGeneration,
        acceptedCurrent: reference.editableDraft.acceptedCurrent,
      },
      requirements: reference.requirements.map((requirement) => ({
        slot: requirement.slot,
        kind: requirement.kind,
        effect: requirement.effect,
        required: requirement.required,
      })),
    })),
    activeEditableTarget: context.activeEditableTarget,
    instructions: [
      'This host selection is authoritative over display labels in user prose.',
      'Published widget files are immutable; edits apply only to the mounted draft.',
      'After source or manifest edits, run npm run check and npm run build before claiming Preview changed.',
      'Only a user-controlled Publish action changes the published runtime.',
      'A widget mention does not select or bind a resource.',
    ],
  });
}
