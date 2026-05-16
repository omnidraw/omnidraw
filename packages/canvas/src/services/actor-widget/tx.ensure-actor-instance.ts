import type { TActorInstance } from "@vibecanvas/api-actors/contract";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { CrdtService } from "../crdt/CrdtService";

type TPortalEnsureActorInstance = {
  apiService: TOrpcSafeClient;
  crdt: CrdtService;
};

type TArgsEnsureActorInstance = {
  canvasId: string;
  element: TElement;
};

export async function txEnsureActorInstance(portal: TPortalEnsureActorInstance, args: TArgsEnsureActorInstance): Promise<TActorInstance | null> {
  if (args.element.data.type !== "widget") return null;
  if (args.element.data.actorInstanceId) return null;

  const [error, instance] = await portal.apiService.api.actors.instances.create({
    canvasId: args.canvasId,
    elementId: args.element.id,
    actorDefinitionId: args.element.data.actorDefinitionId,
  });
  if (error || !instance) return null;

  const currentElement = portal.crdt.doc()?.elements[args.element.id];
  if (!currentElement || currentElement.data.type !== "widget") return instance;
  if (currentElement.data.actorInstanceId) return instance;

  portal.crdt.build()
    .patchElement(args.element.id, "data", {
      ...currentElement.data,
      actorInstanceId: instance.id,
    })
    .commit();

  return instance;
}
