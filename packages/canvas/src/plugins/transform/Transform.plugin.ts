import type { IPlugin } from "@vibecanvas/runtime";
import type { TCanvasProductTransformEvent } from "../../engine/product-runtime/typed";
import { fnCanvasActiveSessionDependencies } from "../../services/active-session/fn.dependencies";
import { fnCollectDescendantElementIds } from "../../services/group/fn.product-groups";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import {
  fnPlanProductSubtreeClone,
  fnProductCloneIdentity,
  type TProductClonePlan,
} from "./fn.clone-plan";
import {
  fnPersistElementThroughGroupTransform,
  fnRootProductTransformProposals,
  fnRootProductTransformTargets,
} from "./fn.group-transform";
import { fnPersistProductTransformProposal } from "./fn.persist-proposal";
import { fnMergeProductSelectionTransformPolicy } from "./fn.selection-policy";
import { txCloneImageAssets } from "./tx.clone-image-assets";

const APPEARANCE = {
  outline: {
    color: { r: 0.31, g: 0.27, b: 0.9, a: 1 },
    width: 1.5,
  },
  handleFill: { r: 1, g: 1, b: 1, a: 1 },
  handleStroke: {
    color: { r: 0.31, g: 0.27, b: 0.9, a: 1 },
    width: 1.5,
  },
  handleSize: 8,
  rotateHandleOffset: 24,
  outlinePadding: 6,
};

const TRANSFORM_ELEMENT_DEPENDENCY_FIELDS = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "parentGroupId",
  "data",
  "locked",
] as const;

const TRANSFORM_GROUP_DEPENDENCY_FIELDS = [
  "parentGroupId",
  "locked",
] as const;

export function createTransformPlugin():
IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "transform",
    apply(ctx) {
      const activeSession = ctx.services.require("activeSession");
      const crdt = ctx.services.require("crdt");
      const elementService = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const cleanups: Array<() => void> = [];
      const clonePlans = new Map<string, TProductClonePlan>();
      const createId = () => {
        return scene.container.ownerDocument.defaultView?.crypto.randomUUID()
          ?? `clone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      };

      const waitForProjection = (expectedRevision: number) => {
        const cleanup = {
          value: null as (() => void) | null,
        };
        const promise = new Promise<void>((resolve, reject) => {
          cleanup.value = scene.hooks.projection.tap((result) => {
            if (result.revision < expectedRevision) {
              return;
            }
            cleanup.value?.();
            cleanup.value = null;
            if (
              result.revision === expectedRevision
              && (result.status === "applied" || result.status === "noop")
            ) {
              resolve();
            } else {
              reject(
                result.status === "failed"
                  ? result.error
                  : new Error("Authoritative transform projection was rejected."),
              );
            }
          });
        });
        return { promise, cancel: () => cleanup.value?.() };
      };

      const syncSelection = () => {
        const snapshot = selection.snapshot;
        if (snapshot.selection.length === 0) {
          scene.product.transforms.setSelection(null);
          return;
        }
        const document = crdt.doc();
        const targets = fnRootProductTransformTargets({
          document,
          targets: snapshot.selection,
        });
        if (targets.length === 0) {
          scene.product.transforms.setSelection(null);
          return;
        }
        const selectedElements = targets.flatMap((target) => {
          if (target.kind === "group") {
            return fnCollectDescendantElementIds({
              document,
              groupIds: [target.id],
            }).flatMap((id) => {
              const candidate = document.elements[id];
              return candidate === undefined ? [] : [candidate];
            });
          }
          const candidate = document.elements[target.id];
          return candidate === undefined ? [] : [candidate];
        });
        const uniqueElements = [...new Map(selectedElements.map((element) => {
          return [element.id, element];
        })).values()];
        const policy = fnMergeProductSelectionTransformPolicy({
          baseline: scene.product.transforms.resolveStandardPolicy(targets),
          policies: uniqueElements.map((element) => {
            return elementService.getTransformPolicy({
              element,
              selection: uniqueElements,
            });
          }),
          includeSizeConstraints: targets.length === 1
            && targets[0]?.kind === "element",
          // Aggregate non-uniform scaling can introduce affine skew, which is
          // intentionally absent from the persisted canvas element contract.
          forceLockedAspectRatio: targets.length > 1
            || targets.some((target) => {
              return target.kind === "group";
            }),
        });
        const focused = snapshot.focused !== null
          && targets.some((target) => {
            return target.kind === snapshot.focused?.kind
              && target.id === snapshot.focused.id;
          })
          ? snapshot.focused
          : targets[0];
        scene.product.transforms.setSelection({
          targets,
          ...(focused === undefined ? {} : { focused }),
          appearance: APPEARANCE,
          policy,
        });
      };

      const onTransform = (event: TCanvasProductTransformEvent) => {
        if (event.type === "transform-begin") {
          activeSession.register({
            id: event.gestureId,
            kind: event.modifiers.alt ? "clone-drag" : "transform",
            startedAtRevision: crdt.revision,
            dependencies: fnCanvasActiveSessionDependencies({
              document: crdt.doc(),
              targets: event.proposals.map((proposal) => proposal.target),
              elementFields: TRANSFORM_ELEMENT_DEPENDENCY_FIELDS,
              groupFields: TRANSFORM_GROUP_DEPENDENCY_FIELDS,
              includeGroupDescendants: true,
            }),
            cancel: () => {
              scene.product.transforms.cancelForRemoteChange();
            },
          });
          return;
        }
        if (event.type === "transform-cancel") {
          activeSession.complete(event.gestureId);
          return;
        }
        if (event.type === "transform-update") {
          return;
        }
        if (event.type !== "transform-commit") {
          return;
        }
        activeSession.complete(event.gestureId);
        const document = crdt.doc();
        if (event.modifiers.alt && event.clone !== undefined) {
          const plan = clonePlans.get(event.gestureId);
          clonePlans.delete(event.gestureId);
          if (plan === undefined) {
            event.handoff.fail(new Error(
              "Clone plan was not prepared before the transform preview.",
            ));
            return;
          }
          const cloneOperation = (async () => {
            const now = Date.now();
            const rootProposals = fnRootProductTransformProposals({
              document,
              proposals: event.proposals,
            });
            const proposalByTarget = new Map(rootProposals.map((proposal) => [
              `${proposal.target.kind}:${proposal.target.id}`,
              proposal,
            ]));
            let clonedAssetUrls: string[] = [];
            let commitResult: ReturnType<
              ReturnType<typeof crdt.build>["commit"]
            > | null = null;
            try {
              for (const entry of plan.elements) {
                const direct = proposalByTarget.get(`element:${entry.sourceId}`);
                if (direct !== undefined) {
                  const transformed = fnPersistProductTransformProposal(
                    entry.clone,
                    {
                      ...direct,
                      target: { kind: "element", id: entry.clone.id },
                    },
                    now,
                  );
                  if (transformed !== null) {
                    entry.clone = transformed;
                  }
                } else {
                  let parentId = document.elements[entry.sourceId]?.parentGroupId
                    ?? null;
                  while (parentId !== null) {
                    const groupProposal = proposalByTarget.get(
                      `group:${parentId}`,
                    );
                    if (groupProposal !== undefined) {
                      entry.clone = fnPersistElementThroughGroupTransform({
                        element: entry.clone,
                        proposal: groupProposal,
                        updatedAt: now,
                      }) ?? entry.clone;
                      break;
                    }
                    parentId = document.groups[parentId]?.parentGroupId ?? null;
                  }
                }
              }
              const assets = await txCloneImageAssets({
                cloneImage: ctx.config.image.cloneImage,
                deleteImage: ctx.config.image.deleteImage,
              }, {
                elements: plan.elements.map((entry) => entry.clone),
              });
              clonedAssetUrls = assets.clonedUrls;
              for (const entry of plan.elements) {
                const url = assets.urlByElementId.get(entry.clone.id);
                if (url !== undefined && entry.clone.data.type === "image") {
                  entry.clone = {
                    ...entry.clone,
                    data: { ...entry.clone.data, url },
                  };
                }
              }
              plan.selection.forEach((target, index) => {
                const zIndex = `z${String(
                  Object.keys(document.elements).length
                    + Object.keys(document.groups).length
                    + index,
                ).padStart(8, "0")}`;
                const element = plan.elements.find((entry) => {
                  return target.kind === "element"
                    && entry.clone.id === target.id;
                });
                if (element !== undefined) {
                  element.clone.zIndex = zIndex;
                }
                const group = plan.groups.find((entry) => {
                  return target.kind === "group"
                    && entry.clone.id === target.id;
                });
                if (group !== undefined) {
                  group.clone.zIndex = zIndex;
                }
              });
              const projection = waitForProjection(crdt.revision + 1);
              const builder = crdt.build();
              for (const entry of plan.groups) {
                builder.patchGroup(entry.clone.id, entry.clone);
              }
              for (const entry of plan.elements) {
                builder.patchElement(entry.clone.id, entry.clone);
              }
              const committed = builder.commit();
              commitResult = committed;
              await projection.promise;
              history.record({
                label: "Clone selection",
                undo: () => crdt.applyOps({ ops: committed.undoOps }),
                redo: () => crdt.applyOps({ ops: committed.redoOps }),
              });
              selection.setSelection(plan.selection);
            } catch (error) {
              commitResult?.rollback();
              await Promise.allSettled(clonedAssetUrls.map((url) => {
                return ctx.config.image.deleteImage({ url });
              }));
              throw error;
            }
          })();
          event.handoff.waitFor(cloneOperation);
          return;
        }
        const builder = crdt.build();
        const timestamp = Date.now();
        let changed = false;
        for (
          const proposal of fnRootProductTransformProposals({
            document,
            proposals: event.proposals,
          })
        ) {
          if (proposal.target.kind === "element") {
            const current = document.elements[proposal.target.id];
            if (current === undefined) {
              continue;
            }
            const next = fnPersistProductTransformProposal(
              current,
              proposal,
              timestamp,
            );
            if (next !== null) {
              builder.patchElement(next.id, next);
              changed = true;
            }
            continue;
          }
          for (const id of fnCollectDescendantElementIds({
            document,
            groupIds: [proposal.target.id],
          })) {
            const current = document.elements[id];
            if (current === undefined) {
              continue;
            }
            const next = fnPersistElementThroughGroupTransform({
              element: current,
              proposal,
              updatedAt: timestamp,
            });
            if (next === null) {
              continue;
            }
            builder.patchElement(id, next);
            changed = true;
          }
        }
        if (!changed) {
          event.handoff.complete();
          return;
        }

        const projection = waitForProjection(crdt.revision + 1);
        try {
          const result = builder.commit();
          event.handoff.waitFor((async () => {
            try {
              await projection.promise;
              history.record({
                label: "Transform selection",
                undo: () => crdt.applyOps({ ops: result.undoOps }),
                redo: () => crdt.applyOps({ ops: result.redoOps }),
              });
            } catch (error) {
              result.rollback();
              throw error;
            }
          })());
        } catch (error) {
          projection.cancel();
          event.handoff.fail(error);
        }
      };

      cleanups.push(ctx.hooks.init.tap(() => {
        cleanups.push(scene.product.transforms.setClonePlanProvider({
          prepare: ({ gestureId, targets }) => {
            const document = crdt.doc();
            const plan = fnPlanProductSubtreeClone({
              document,
              targets,
              createId,
              now: Date.now(),
            });
            for (const entry of plan.elements) {
              const source = document.elements[entry.sourceId];
              if (source === undefined) {
                return null;
              }
              const clone = elementService.prepareClone({
                source,
                clone: entry.clone,
                createId,
              });
              if (clone === null) {
                return null;
              }
              entry.clone = clone;
            }
            if (plan.elements.length === 0 && plan.groups.length === 0) {
              return null;
            }
            clonePlans.set(gestureId, plan);
            return fnProductCloneIdentity(plan);
          },
          discard: ({ gestureId }) => {
            clonePlans.delete(gestureId);
          },
        }));
        cleanups.push(selection.hooks.change.tap(syncSelection));
        cleanups.push(scene.hooks.projection.tap(syncSelection));
        cleanups.push(elementService.hooks.elementsChange.tap(syncSelection));
        cleanups.push(scene.product.transforms.subscribe(onTransform));
        syncSelection();
      }));
      ctx.hooks.destroy.tap(() => {
        clonePlans.clear();
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
