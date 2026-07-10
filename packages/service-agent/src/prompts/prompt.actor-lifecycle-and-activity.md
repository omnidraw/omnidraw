# Building widgets with actor lifecycle and activities

Use the actor as the widget's backend state machine. The widget UI sends declared input messages and renders actor state/context; it must not implement backend loops or duplicate actor business state in the browser.

## State and transition design

- New transitions use `{ func: ["tx.name"], targetState: "ready" }`. Never generate the deprecated `allowedTargetStates` field; it is accepted only so existing widgets keep working.
- A transition to a different state runs source `onExit`, then the transition pipeline, applies `targetState`, runs target `onEnter`, and only then acknowledges the message.
- A transition whose target equals its source is internal: it does not rerun `onExit`, `onEnter`, timeout scheduling, or the state activity.
- Keep hooks and transition functions short. Each function pipeline advances only when a function calls `await portal.next()`.

## Lifecycle hooks

- Declare `onEnter: [TFunctionName, ...]` for short setup that must run every time a state becomes active, including startup/restore.
- Declare `onExit: [TFunctionName, ...]` for short cleanup before a normal state-changing transition.
- Hooks may use `portal.setData` and `portal.emitMessage` just like transition functions.
- Lifecycle payloads arrive in `args.msg` with `kind: "lifecycle.enter"` or `kind: "lifecycle.exit"`. Read fields such as `state`, `fromState`, `toState`, and `cause` only when needed.
- Startup hooks can run again after a server restart. Make externally visible work idempotent.

## One activity per state

Use an activity for repeated backend work while one state remains active:

```json
{
  "busy.counting": {
    "onEnter": ["tx.prepareCounting"],
    "activity": {
      "everyMs": 1000,
      "runImmediately": true,
      "func": ["tx.countOnce"],
      "onError": {
        "func": ["tx.recordCountError"],
        "recover": "stay"
      }
    },
    "on": {
      "in.stop": {
        "func": ["tx.finishCounting"],
        "targetState": "ready"
      }
    }
  }
}
```

- `everyMs` must be an integer of at least 1000.
- An activity function performs exactly one short unit of work. Never write a loop or sleep/retry cycle inside it; the runtime owns repetition and prevents overlapping ticks.
- `runImmediately: true` queues one tick after successful `onEnter`; otherwise the first tick waits for `everyMs`.
- Activity payloads use `args.msg.kind === "activity.tick"` and include `state`, `generation`, `tick`, and `scheduledAt`.
- Leaving the state, stopping the actor, or entering implicit error cancels future ticks. A currently running short tick is allowed to finish before a queued stop message runs.
- Do not use an activity for elapsed-time display. Store a timestamp and derive elapsed time in the UI. Use activities only for real recurring backend work.

## Error handling and recovery

Error handlers have `func` plus a required recovery policy:

- `recover: "stay"` handles the failure and keeps/reactivates the current state.
- `recover: { targetState: "ready" }` handles the failure and enters a declared non-error state.
- Activity failures try `activity.onError` then state `onError`.
- Transition/exit failures try transition `onError` then source-state `onError`.
- Enter failures try transition `onError` then target-state `onError`.
- If no handler exists, or the selected handler fails, the actor enters implicit `error`.
- Error-handler payloads use `args.msg.kind === "actor.error"` and include `phase`, job metadata, source/current/target states, and serialized error details.

`portal.setData` and emitted messages take effect immediately and are not rolled back if a later function fails. Write functions so partial progress is safe, and use idempotency keys for external writes when appropriate.

## Choosing the correct primitive

- User command: input transition.
- Short setup/cleanup around a state: `onEnter` / `onExit`.
- Repeated backend work while a state is active: state `activity`.
- One delayed automatic transition: `timeout:xxxxms` message transition.
- Derived clocks/progress displays: stored timestamp plus UI derivation, not activity writes every second.
