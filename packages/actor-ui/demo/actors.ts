import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types";

export const DEMO_ACTORS = [
  {
    slug: "repo-health",
    name: "Repo Health Analyst",
    description: "Tracks repository health and routes checks through ready, busy, waiting, and error states.",
    actor: {
      relFunctionPath: "actors/repo-health",
      initialState: "ready",
      initialData: { inspected: 0 },
      inputMsgSchema: {
        inspect: {
          type: "object",
          properties: {
            repoPath: { type: "string" },
            includeTests: { type: "boolean" },
          },
          required: ["repoPath"],
        },
        complete: {
          type: "object",
          properties: {
            reportId: { type: "string" },
          },
        },
        needsInput: {
          type: "object",
          properties: {
            question: { type: "string" },
          },
          required: ["question"],
        },
        scopeProvided: {
          type: "object",
          properties: {
            scope: { type: "array", items: { type: "string" } },
          },
        },
        validationFailed: {
          type: "object",
          properties: {
            reason: { type: "string" },
          },
          required: ["reason"],
        },
      },
      states: {
        ready: {
          on: {
            inspect: {
              func: ["fx.loadRepo", "fn.planChecks"],
              allowedTargetStates: ["busy.inspecting"],
            },
          },
        },
        "busy.inspecting": {
          on: {
            complete: {
              func: ["tx.saveReport"],
              allowedTargetStates: ["ready"],
            },
            needsInput: {
              func: ["fx.requestScope"],
              allowedTargetStates: ["waiting.scope"],
            },
            validationFailed: {
              func: ["fn.describeValidationError"],
              allowedTargetStates: ["error.validation"],
            },
          },
        },
        "waiting.scope": {
          on: {
            scopeProvided: {
              func: ["fn.mergeScope"],
              allowedTargetStates: ["busy.inspecting"],
            },
          },
        },
        "error.validation": {
          on: {},
        },
      },
    },
    widget: {
      relWidgetDir: "widgets/repo-health",
      tool: {
        label: "Repo Health",
        behavior: { type: "modal" },
      },
    },
  },
  {
    slug: "draft-writer",
    name: "Draft Writer",
    description: "Small authoring loop with approval and revision transitions.",
    actor: {
      relFunctionPath: "actors/draft-writer",
      initialState: "booting",
      initialData: { draftId: null },
      states: {
        booting: {
          on: {
            load: {
              func: ["fx.loadDraft"],
              allowedTargetStates: ["ready.idle"],
            },
          },
        },
        "ready.idle": {
          on: {
            write: {
              func: ["fn.createOutline", "tx.persistDraft"],
              allowedTargetStates: ["busy.writing"],
            },
          },
        },
        "busy.writing": {
          on: {
            review: {
              func: ["fx.scoreDraft"],
              allowedTargetStates: ["waiting.review"],
            },
          },
        },
        "waiting.review": {
          on: {
            approve: {
              func: ["tx.publishDraft"],
              allowedTargetStates: ["ready.idle"],
            },
            revise: {
              func: ["fn.applyNotes"],
              allowedTargetStates: ["busy.writing"],
            },
          },
        },
      },
    },
    widget: {
      relWidgetDir: "widgets/draft-writer",
      tool: {
        label: "Draft Writer",
        behavior: { type: "modal" },
      },
    },
  },
  {
    slug: "empty-machine",
    name: "Empty Actor",
    description: "Shows the empty state for actors with no declared states yet.",
    actor: {
      relFunctionPath: "actors/empty",
      initialState: "ready",
      initialData: null,
      states: {},
    },
    widget: {
      relWidgetDir: "widgets/empty",
      tool: {
        label: "Empty Actor",
        behavior: { type: "modal" },
      },
    },
  },
] satisfies TVibecanvasJson[];
