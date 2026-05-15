import React, { useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';

type TAppProps = { readonly initialSnapshot: any };

type TActorNodeData = {
  readonly actor: any;
  readonly selected: boolean;
};

const ACTOR_NODE_WIDTH = 286;
const ACTOR_NODE_HEIGHT = 172;
const FLOW_WIDTH = 1200;
const FLOW_HEIGHT = 720;

const nodeTypes = {
  actor: ActorNode,
};

function getDefaultEventName(snapshot: any) {
  if (snapshot?.scenario?.id === 'counter-chain') return 'msg.in.increment';
  return 'msg.in.ping';
}

function getDefaultPayload(snapshot: any) {
  if (snapshot?.scenario?.id === 'counter-chain') return '{"by":1}';
  return '{"by":1}';
}

function JsonBlock(props: { readonly value: unknown }) {
  return <pre className="json">{JSON.stringify(props.value, null, 2)}</pre>;
}

function statusClass(status: string | undefined) {
  if (status === 'running' || status === 'processed' || status === 'completed' || status === 'succeeded') return 'good';
  if (status === 'queued' || status === 'claimed' || status === 'starting') return 'warn';
  if (status === 'failed' || status === 'error' || status === 'rejected' || status === 'deadLettered') return 'bad';
  return 'muted';
}

function statusLabel(status: string | undefined) {
  return status ?? 'unknown';
}

function ActorNode(props: NodeProps<Node<TActorNodeData, 'actor'>>) {
  const actor = props.data.actor;
  const queued = actor.inbox.filter((row: any) => row.status === 'queued').length;
  const latestStep = actor.workflowSteps?.at?.(-1);

  return <article className={`actorNode ${props.data.selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="flowHandle target" />
    <header className="actorNodeHeader">
      <div>
        <strong>{actor.display_name}</strong>
        <span>{actor.id}</span>
      </div>
      <em className={statusClass(actor.status)}>{statusLabel(actor.status)}</em>
    </header>
    <section className="actorState">
      <span>machine state</span>
      <b>{actor.machine_state}</b>
    </section>
    <div className="actorMetrics">
      <span><b>{queued}</b> queued</span>
      <span><b>{actor.outputs.length}</b> outputs</span>
      <span><b>{actor.workflowSteps?.length ?? 0}</b> steps</span>
    </div>
    <footer className="actorStep">
      {latestStep
        ? <i className={statusClass(latestStep.status)}>{latestStep.function_kind}:{latestStep.function_name}</i>
        : <i className="muted">waiting for workflow</i>}
    </footer>
    <Handle type="source" position={Position.Right} className="flowHandle source" />
  </article>;
}

function MetricCard(props: { readonly label: string; readonly value: number | string }) {
  return <div className="metricCard">
    <span>{props.label}</span>
    <b>{props.value}</b>
  </div>;
}

export function App({ initialSnapshot }: TAppProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedActorId, setSelectedActorId] = useState(initialSnapshot?.actors?.[0]?.id ?? '');
  const [eventName, setEventName] = useState(getDefaultEventName(initialSnapshot));
  const [payload, setPayload] = useState(getDefaultPayload(initialSnapshot));
  const actors = snapshot?.actors ?? [];
  const selectedActor = actors.find((actor: any) => actor.id === selectedActorId) ?? actors[0];

  React.useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => setSnapshot(JSON.parse(event.data));
    return () => events.close();
  }, []);

  React.useEffect(() => {
    if (!selectedActor && actors[0]) setSelectedActorId(actors[0].id);
  }, [actors, selectedActor]);

  React.useEffect(() => {
    setEventName(getDefaultEventName(snapshot));
    setPayload(getDefaultPayload(snapshot));
  }, [snapshot?.scenario?.id]);

  const nodes = useMemo<Node<TActorNodeData, 'actor'>[]>(() => actors.map((actor: any) => ({
    id: actor.id,
    type: 'actor',
    position: { x: actor.x, y: actor.y },
    data: {
      actor,
      selected: actor.id === selectedActor?.id,
    },
    width: ACTOR_NODE_WIDTH,
    height: ACTOR_NODE_HEIGHT,
    handles: [
      { type: 'target', position: Position.Left, x: 0, y: ACTOR_NODE_HEIGHT / 2 },
      { type: 'source', position: Position.Right, x: ACTOR_NODE_WIDTH, y: ACTOR_NODE_HEIGHT / 2 },
    ],
  })), [actors, selectedActor?.id]);

  const edges = useMemo<Edge[]>(() => (snapshot?.connections ?? []).map((connection: any) => ({
    id: connection.id,
    source: connection.source_actor_instance_id,
    target: connection.target_actor_instance_id,
    label: connection.label ?? connection.id,
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    className: 'actorEdge',
    labelClassName: 'actorEdgeLabel',
  })), [snapshot]);

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await response.json();
    if (json.snapshot) setSnapshot(json.snapshot);
  }

  async function sendMessage() {
    let parsedPayload = {};
    try { parsedPayload = JSON.parse(payload); }
    catch { alert('Payload must be JSON'); return; }
    await post('/api/send', { actorInstanceId: selectedActor?.id, eventName, payload: parsedPayload });
  }

  return <main className="shell">
    <aside className="sidebar panel">
      <div className="brandBlock">
        <div className="brandMark">VC</div>
        <div>
          <div className="brand">Actor Visualizer</div>
          <p>Workflow-backed actor runtime map</p>
        </div>
      </div>
      <label>Scenario</label>
      <select value={snapshot.scenario.id} onChange={(event) => post('/api/scenario', { scenarioId: event.currentTarget.value })}>
        {(snapshot.scenarioOptions ?? []).map((scenario: any) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
      </select>
      <p className="description">{snapshot.scenario.description}</p>
      <div className="toolbar">
        <button onClick={() => post('/api/tick')}>Run one tick</button>
        <button className="primary" onClick={() => post('/api/drain')}>Drain queue</button>
      </div>
      <section className="dbStack">
        <h3>Runtime rows</h3>
        <div className="metricGrid">
          <MetricCard label="runs" value={snapshot.global.workflowRuns.length} />
          <MetricCard label="steps" value={snapshot.global.workflowSteps.length} />
          <MetricCard label="inbox" value={snapshot.global.inbox.length} />
          <MetricCard label="outputs" value={snapshot.global.outputs.length} />
        </div>
        <details><summary>global rows</summary><JsonBlock value={snapshot.global} /></details>
      </section>
    </aside>

    <section className="flowPanel">
      <div className="flowHeader">
        <div>
          <span className="eyebrow">Live topology</span>
          <h1>{snapshot.scenario.name}</h1>
        </div>
        <div className="statusPills">
          <span>{actors.length} actors</span>
          <span>{edges.length} connections</span>
        </div>
      </div>
      <div className="flowCanvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.26 }}
          minZoom={0.35}
          maxZoom={1.6}
          width={FLOW_WIDTH}
          height={FLOW_HEIGHT}
          onNodeClick={(_event, node) => setSelectedActorId(node.id)}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>

    <aside className="inspector panel">
      <span className="eyebrow">Inspector</span>
      <h2>{selectedActor?.display_name ?? 'No actor selected'}</h2>
      {selectedActor && <>
        <div className="sendBox">
          <label>Send message</label>
          <input value={eventName} onChange={(event) => setEventName(event.currentTarget.value)} placeholder="msg.in.ping" />
          <textarea value={payload} onChange={(event) => setPayload(event.currentTarget.value)} rows={4} />
          <button className="primary" onClick={sendMessage}>Send to actor</button>
        </div>
        <details open><summary>local state</summary><JsonBlock value={{ state: selectedActor.machine_state, context: selectedActor.machine_context }} /></details>
        <details open><summary>message queue</summary><JsonBlock value={selectedActor.inbox} /></details>
        <details><summary>fn/fx/tx execution</summary><JsonBlock value={selectedActor.workflowSteps} /></details>
        <details><summary>outputs</summary><JsonBlock value={selectedActor.outputs} /></details>
      </>}
    </aside>
  </main>;
}
