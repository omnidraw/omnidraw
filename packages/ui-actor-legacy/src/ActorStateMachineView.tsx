import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { TVibecanvasActor, TVibecanvasJson } from "@vibecanvas/service-actor/core/types";
import { fnNormalizeTransition } from "@vibecanvas/service-actor/core/fn.normalize-actor-manifest";
import { fnPlanStateMachineEdges } from "./fn.edge";
import type { TPoint } from "./fn.elbow";
import { fnPlaceLabels } from "./fn.labels";
import { fnLayoutStateMachine } from "./fn.layout";
import "./styles.css";

export type TActorStateMachineViewVariant = "panel" | "embedded";

export type TActorStateMachineViewProps = {
  manifest?: TVibecanvasJson;
  actor?: TVibecanvasActor;
  title?: string;
  variant?: TActorStateMachineViewVariant;
};

type TStateRow = {
  name: string;
  isInitial: boolean;
  transitions: TTransitionRow[];
};

type TTransitionRow = {
  message: string;
  functions: string[];
  targets: string[];
};

type TDiagramNode = TStateRow & {
  x: number;
  y: number;
  centerX: number;
  centerY: number;
};

type TDiagramEdge = {
  key: string;
  message: string;
  functions: string[];
  isImplicit: boolean;
  source: TDiagramNode;
  target: TDiagramNode;
  path: string;
  labelX: number;
  labelY: number;
};

type TDiagramModel = {
  width: number;
  height: number;
  nodes: TDiagramNode[];
  edges: TDiagramEdge[];
};

type TEdgeDescriptor = {
  key: string;
  message: string;
  functions: string[];
  isImplicit: boolean;
  sourceName: string;
  targetName: string;
};

const NODE_WIDTH = 210;
const NODE_HEIGHT = 92;
const DIAGRAM_WIDTH = 820;
const DIAGRAM_HEIGHT = 520;
const DIAGRAM_PADDING = 48;
const ARROWHEAD_CLEARANCE = 9;
const EDGE_LANE_GAP = 28;
const STATE_ORDER = ["booting", "ready", "busy", "waiting", "error"] as const;
const IMPLICIT_STATE_NAMES = ["booting", "error"] as const;

function getActorFromProps(props: TActorStateMachineViewProps): TVibecanvasActor | undefined {
  return props.actor ?? props.manifest?.actor;
}

function getStateRows(actor: TVibecanvasActor | undefined): TStateRow[] {
  if (!actor) {
    return [];
  }

  const rowByName = new Map<string, TStateRow>();

  for (const [name, config] of Object.entries(actor.states)) {
    rowByName.set(name, {
      name,
      isInitial: name === actor.initialState,
      transitions: Object.entries(config?.on ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([message, transition]) => {
          const normalized = transition ? fnNormalizeTransition(transition, name as Parameters<typeof fnNormalizeTransition>[1]) : null;
          return {
            message,
            functions: [...(transition?.func ?? [])],
            targets: normalized ? [normalized.transition.targetState] : [],
          };
        }),
    });
  }

  for (const implicitStateName of IMPLICIT_STATE_NAMES) {
    if (!rowByName.has(implicitStateName)) {
      rowByName.set(implicitStateName, {
        name: implicitStateName,
        isInitial: actor.initialState === implicitStateName,
        transitions: [],
      });
    }
  }

  if (!rowByName.has(actor.initialState)) {
    rowByName.set(actor.initialState, {
      name: actor.initialState,
      isInitial: true,
      transitions: [],
    });
  }

  for (const row of rowByName.values()) {
    for (const transition of row.transitions) {
      for (const targetName of transition.targets) {
        if (!rowByName.has(targetName)) {
          rowByName.set(targetName, {
            name: targetName,
            isInitial: actor.initialState === targetName,
            transitions: [],
          });
        }
      }
    }
  }

  return [...rowByName.values()].sort((left, right) => {
    const leftOrder = getStateSortOrder(left.name);
    const rightOrder = getStateSortOrder(right.name);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.name.localeCompare(right.name);
  });
}

function getTransitionCount(rows: TStateRow[]): number {
  return rows.reduce((count, row) => count + row.transitions.length, 0);
}

function getStateBaseName(stateName: string): string {
  return stateName.split(".")[0] ?? stateName;
}

function getStateSortOrder(stateName: string): number {
  const baseName = getStateBaseName(stateName);
  const index = STATE_ORDER.indexOf(baseName as typeof STATE_ORDER[number]);

  return index === -1 ? STATE_ORDER.length : index;
}

function getSvgPath(points: TPoint[]): string {
  const [firstPoint, ...restPoints] = points;

  if (!firstPoint) {
    return "";
  }

  return `M ${firstPoint.x} ${firstPoint.y} ${restPoints.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function getLabelPoint(points: TPoint[], edgeIndex: number) {
  let longestSegment = {
    from: points[0] ?? { x: 0, y: 0 },
    to: points[1] ?? points[0] ?? { x: 0, y: 0 },
    length: 0,
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];

    if (!from || !to) {
      continue;
    }

    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);

    if (length > longestSegment.length) {
      longestSegment = { from, to, length };
    }
  }

  const dx = longestSegment.to.x - longestSegment.from.x;
  const dy = longestSegment.to.y - longestSegment.from.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const offset = (edgeIndex % 2 === 0 ? -1 : 1) * (12 + Math.floor(edgeIndex / 2) * 12);

  return {
    x: longestSegment.from.x + dx * 0.5 + (-dy / length) * offset,
    y: longestSegment.from.y + dy * 0.5 + (dx / length) * offset,
  };
}

function getNodeRect(node: TDiagramNode) {
  return {
    x: node.x,
    y: node.y,
    w: NODE_WIDTH,
    h: NODE_HEIGHT,
  };
}

function getSelfLoopPath(node: TDiagramNode) {
  const startX = node.centerX + NODE_WIDTH / 2 - 22;
  const startY = node.centerY - NODE_HEIGHT / 2 + 18;
  const endX = node.centerX + NODE_WIDTH / 2 - 8;
  const endY = node.centerY + NODE_HEIGHT / 2 - 18;
  const controlX = node.centerX + NODE_WIDTH / 2 + 96;

  return {
    path: `M ${startX} ${startY} C ${controlX} ${startY - 76}, ${controlX} ${endY + 76}, ${endX} ${endY}`,
    labelX: controlX + 10,
    labelY: node.centerY,
    points: [
      { x: startX, y: startY },
      { x: controlX, y: node.centerY },
      { x: endX, y: endY },
    ],
  };
}

function getDiagramModel(rows: TStateRow[]): TDiagramModel {
  const layoutTransitions = rows.flatMap((source) => source.transitions.flatMap((transition) => transition.targets.map((target) => ({
    source: source.name,
    target,
  }))));
  const positions = new Map(fnLayoutStateMachine({
    states: rows.map((row) => ({ name: row.name })),
    transitions: layoutTransitions,
    space: {
      w: DIAGRAM_WIDTH,
      h: DIAGRAM_HEIGHT,
    },
    box: {
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
    },
  }).map((position) => [position.name, position]));
  const nodes = rows.map((row) => {
    const position = positions.get(row.name) ?? { x: 0, y: 0 };
    const x = position.x * DIAGRAM_WIDTH;
    const y = position.y * DIAGRAM_HEIGHT;

    return {
      ...row,
      x,
      y,
      centerX: x + NODE_WIDTH / 2,
      centerY: y + NODE_HEIGHT / 2,
    };
  });
  const nodeByName = new Map(nodes.map((node) => [node.name, node]));
  const edgeSlots = new Map<string, number>();
  const edgeDescriptors: TEdgeDescriptor[] = [];

  for (const source of nodes) {
    for (const transition of source.transitions) {
      for (const targetName of transition.targets) {
        const target = nodeByName.get(targetName);

        if (!target) {
          continue;
        }

        const edgeKey = [source.name, target.name].sort().join("<->");
        const edgeIndex = edgeSlots.get(edgeKey) ?? 0;
        edgeSlots.set(edgeKey, edgeIndex + 1);
        edgeDescriptors.push({
          key: `${source.name}:${transition.message}:${target.name}:${edgeIndex}`,
          message: transition.message,
          functions: transition.functions,
          isImplicit: false,
          sourceName: source.name,
          targetName: target.name,
        });
      }
    }
  }

  const initialNode = nodes.find((node) => node.isInitial);
  const bootingNode = nodeByName.get("booting");

  if (initialNode && bootingNode && initialNode.name !== "booting") {
    edgeDescriptors.unshift({
      key: `booting:${initialNode.name}:implicit`,
      message: "",
      functions: [],
      isImplicit: true,
      sourceName: bootingNode.name,
      targetName: initialNode.name,
    });
  }

  const plannedEdges = new Map(fnPlanStateMachineEdges({
    nodes: nodes.map((node) => ({
      name: node.name,
      x: node.x,
      y: node.y,
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
    })),
    transitions: edgeDescriptors
      .filter((descriptor) => descriptor.sourceName !== descriptor.targetName)
      .map((descriptor) => ({
        key: descriptor.key,
        source: descriptor.sourceName,
        target: descriptor.targetName,
      })),
    padding: 28,
    laneGap: EDGE_LANE_GAP,
    arrowheadClearance: ARROWHEAD_CLEARANCE,
    portGap: 44,
  }).map((edge) => [edge.key, edge]));
  const edges = edgeDescriptors.flatMap((descriptor, edgeIndex): TDiagramEdge[] => {
    const source = nodeByName.get(descriptor.sourceName);
    const target = nodeByName.get(descriptor.targetName);

    if (!source || !target) {
      return [];
    }

    const edgeShape = descriptor.sourceName === descriptor.targetName
      ? getSelfLoopPath(source)
      : plannedEdges.get(descriptor.key);

    if (!edgeShape) {
      return [];
    }

    const label = getLabelPoint(edgeShape.points, edgeIndex);

    return [{
      key: descriptor.key,
      message: descriptor.message,
      functions: descriptor.functions,
      isImplicit: descriptor.isImplicit,
      source,
      target,
      path: getSvgPath(edgeShape.points),
      labelX: label.x,
      labelY: label.y,
    }];
  });

  const placedLabels = new Map(fnPlaceLabels({
    labels: edges
      .filter((edge) => edge.message.length > 0)
      .map((edge) => ({
        key: edge.key,
        x: edge.labelX,
        y: edge.labelY,
        w: Math.max(82, Math.min(190, edge.message.length * 9 + 34)),
        h: 34,
      })),
    obstacles: nodes.map(getNodeRect),
    space: {
      w: DIAGRAM_WIDTH,
      h: Math.max(
        520,
        ...nodes.map((node) => node.y + NODE_HEIGHT + DIAGRAM_PADDING),
      ),
    },
  }).map((label) => [label.key, label]));
  const finalEdges = edges.map((edge) => {
    const label = placedLabels.get(edge.key);

    if (!label) {
      return edge;
    }

    return {
      ...edge,
      labelX: label.x,
      labelY: label.y,
    };
  });
  const height = Math.max(
    520,
    ...nodes.map((node) => node.y + NODE_HEIGHT + DIAGRAM_PADDING),
  );

  return {
    width: DIAGRAM_WIDTH,
    height,
    nodes,
    edges: finalEdges,
  };
}

function getPayloadSchemaText(actor: TVibecanvasActor | undefined, message: string): string {
  const schema = actor?.inputMsgSchema?.[message];

  if (schema === undefined) {
    return "No payload schema";
  }

  if (typeof schema === "boolean") {
    return String(schema);
  }

  return JSON.stringify(schema, null, 2);
}

export function ActorStateMachineView(props: TActorStateMachineViewProps) {
  const [selectedEdgeKey, setSelectedEdgeKey] = createSignal<string>();
  const [activeStateName, setActiveStateName] = createSignal<string>();
  const actor = createMemo(() => getActorFromProps(props));
  const rows = createMemo(() => getStateRows(actor()));
  const diagram = createMemo(() => getDiagramModel(rows()));
  const transitionCount = createMemo(() => getTransitionCount(rows()));
  const title = createMemo(() => props.title ?? props.manifest?.name ?? "Actor state machine");
  const selectedEdge = createMemo(() => diagram().edges.find((edge) => edge.key === selectedEdgeKey()));
  const activeState = createMemo(() => activeStateName() ?? actor()?.initialState);

  createEffect(() => {
    setActiveStateName(actor()?.initialState);
    setSelectedEdgeKey(undefined);
  });

  function closePopoverOnClickAway(event: MouseEvent) {
    const target = event.target as null | {
      closest?: (selector: string) => unknown;
    };

    if (target?.closest?.(".vc-actor-ui__popover, .vc-actor-ui__edge-label")) {
      return;
    }

    setSelectedEdgeKey(undefined);
  }

  return (
    <section
      class={`vc-actor-ui vc-actor-ui--${props.variant ?? "panel"}`}
      data-state-count={rows().length}
      data-transition-count={transitionCount()}
      onClick={closePopoverOnClickAway}
    >
      <header class="vc-actor-ui__header">
        <div>
          <p class="vc-actor-ui__eyebrow">State machine</p>
          <h2 class="vc-actor-ui__title">{title()}</h2>
        </div>
        <Show when={actor()}>
          {(loadedActor) => (
            <dl class="vc-actor-ui__meta" aria-label="Actor state machine summary">
              <div>
                <dt>Initial</dt>
                <dd>{loadedActor().initialState}</dd>
              </div>
              <div>
                <dt>States</dt>
                <dd>{rows().length}</dd>
              </div>
              <div>
                <dt>Transitions</dt>
                <dd>{transitionCount()}</dd>
              </div>
            </dl>
          )}
        </Show>
      </header>

      <Show
        when={rows().length > 0}
        fallback={
          <div class="vc-actor-ui__empty" role="status">
            <strong>No state machine data</strong>
            <span>Add actor states and transitions to inspect the machine here.</span>
          </div>
        }
      >
        <div class="vc-actor-ui__diagram-wrap">
          <div
            class="vc-actor-ui__diagram"
            role="img"
            aria-label={`${title()} state machine diagram`}
            style={{ width: `${diagram().width}px`, height: `${diagram().height}px` }}
          >
            <svg
              class="vc-actor-ui__edges"
              viewBox={`0 0 ${diagram().width} ${diagram().height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="vc-actor-ui-arrow"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5.4"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0.8 0.8 L 5.4 3 L 0.8 5.2 z" />
                </marker>
              </defs>
              <For each={diagram().edges}>
                {(edge) => (
                  <path
                    class="vc-actor-ui__edge"
                    classList={{
                      "vc-actor-ui__edge--active": edge.source.name === activeState(),
                      "vc-actor-ui__edge--implicit": edge.isImplicit,
                      "vc-actor-ui__edge--muted": edge.source.name !== activeState(),
                    }}
                    d={edge.path}
                  />
                )}
              </For>
            </svg>

            <For each={diagram().edges}>
              {(edge) => (
                <Show when={edge.message.length > 0}>
                  <button
                    type="button"
                    class="vc-actor-ui__edge-label"
                    classList={{
                      "vc-actor-ui__edge-label--muted": edge.source.name !== activeState(),
                      "vc-actor-ui__edge-label--selected": selectedEdgeKey() === edge.key,
                    }}
                    aria-label={`Open ${edge.message} transition details`}
                    aria-expanded={selectedEdgeKey() === edge.key}
                    onClick={() => setSelectedEdgeKey(selectedEdgeKey() === edge.key ? undefined : edge.key)}
                    style={{
                      left: `${edge.labelX}px`,
                      top: `${edge.labelY}px`,
                    }}
                  >
                    <strong>{edge.message}</strong>
                  </button>
                </Show>
              )}
            </For>

            <Show when={selectedEdge()}>
              {(edge) => (
                <aside
                  class="vc-actor-ui__popover"
                  role="dialog"
                  aria-label={`${edge().message} transition details`}
                  style={{
                    left: `${Math.min(edge().labelX + 18, diagram().width - 276)}px`,
                    top: `${Math.max(18, edge().labelY + 18)}px`,
                  }}
                >
                  <header class="vc-actor-ui__popover-header">
                    <div>
                      <span>Transition</span>
                      <strong>{edge().message}</strong>
                    </div>
                    <button
                      type="button"
                      class="vc-actor-ui__popover-close"
                      aria-label="Close transition details"
                      onClick={() => setSelectedEdgeKey(undefined)}
                    >
                      x
                    </button>
                  </header>
                  <dl class="vc-actor-ui__popover-body">
                    <div>
                      <dt>Path</dt>
                      <dd>{edge().source.name} {"->"} {edge().target.name}</dd>
                    </div>
                    <div>
                      <dt>Funcs</dt>
                      <dd>
                        <Show
                          when={edge().functions.length > 0}
                          fallback={<span>No funcs</span>}
                        >
                          <For each={edge().functions}>
                            {(functionName) => <code>{functionName}</code>}
                          </For>
                        </Show>
                      </dd>
                    </div>
                    <div>
                      <dt>Payload</dt>
                      <dd>
                        <pre>{getPayloadSchemaText(actor(), edge().message)}</pre>
                      </dd>
                    </div>
                  </dl>
                </aside>
              )}
            </Show>

            <For each={diagram().nodes}>
              {(node) => (
                <article
                  class="vc-actor-ui__node"
                  classList={{
                    "vc-actor-ui__node--active": node.name === activeState(),
                    "vc-actor-ui__node--initial": node.isInitial,
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Set active state ${node.name}`}
                  aria-pressed={node.name === activeState()}
                  onClick={() => {
                    setActiveStateName(node.name);
                    setSelectedEdgeKey(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    event.preventDefault();
                    setActiveStateName(node.name);
                    setSelectedEdgeKey(undefined);
                  }}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${NODE_WIDTH}px`,
                    height: `${NODE_HEIGHT}px`,
                  }}
                >
                  <header class="vc-actor-ui__node-title">
                    <h3>{node.name}</h3>
                    <Show when={node.isInitial}>
                      <span class="vc-actor-ui__badge">Initial</span>
                    </Show>
                  </header>
                  <p>
                    {node.transitions.length === 1
                      ? "1 outgoing transition"
                      : `${node.transitions.length} outgoing transitions`}
                  </p>
                </article>
              )}
            </For>
          </div>
          <ul class="vc-actor-ui__transition-list" aria-label="Actor transition details">
            <For each={rows()}>
              {(row) => (
                <li>
                  <strong>{row.name}</strong>
                  <Show
                    when={row.transitions.length > 0}
                    fallback={<span>No outgoing transitions.</span>}
                  >
                    <span>
                      <For each={row.transitions}>
                        {(transition) => (
                          <>
                            {transition.message} to {transition.targets.join(", ") || "no target"}
                            <Show when={transition.functions.length > 0}>
                              {" via "}{transition.functions.join(" -> ")}
                            </Show>
                          </>
                        )}
                      </For>
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}
