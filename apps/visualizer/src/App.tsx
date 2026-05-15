import React, { useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
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
  readonly displayMessageName: (row: any) => string;
};

type TTimelineEvent = {
  readonly id: string;
  readonly time: string;
  readonly type: 'input' | 'output' | 'system' | 'error';
  readonly actorId: string;
  readonly actorName: string;
  readonly direction: 'in' | 'out' | 'system';
  readonly message: string;
  readonly correlationId: string;
  readonly seq: number;
  readonly payload: unknown;
  readonly status?: string;
};

const ACTOR_NODE_WIDTH = 310;
const ACTOR_NODE_HEIGHT = 250;
const nodeTypes = { actor: ActorNode };

function getDefaultEventName(snapshot: any) {
  if (snapshot?.scenario?.id === 'counter-chain') return 'msg.in.increment';
  return 'msg.in.ping';
}

function getDefaultPayload(snapshot: any) {
  return '{"by":1}';
}

function formatTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function shortJson(value: unknown) {
  const text = JSON.stringify(value ?? {});
  return text.length > 86 ? `${text.slice(0, 83)}…` : text;
}

function JsonBlock(props: { readonly value: unknown }) {
  return <pre className="json">{JSON.stringify(props.value, null, 2)}</pre>;
}

function statusClass(status: string | undefined) {
  if (status === 'running' || status === 'processed' || status === 'completed' || status === 'succeeded') return 'good';
  if (status === 'queued' || status === 'claimed' || status === 'starting' || status === 'pending') return 'warn';
  if (status === 'failed' || status === 'error' || status === 'rejected' || status === 'deadLettered') return 'bad';
  return 'muted';
}

function asEntries(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [] as [string, unknown][];
  return Object.entries(value as Record<string, unknown>).slice(0, 4);
}

function MessageRow(props: { readonly name: string; readonly seq: number; readonly tone: 'in' | 'out'; readonly status?: string }) {
  return <div className={`messageRow ${props.tone}`} title={props.status}>
    <span>{props.name}</span>
    <b>{props.seq}</b>
  </div>;
}

function ActorNode(props: NodeProps<Node<TActorNodeData, 'actor'>>) {
  const actor = props.data.actor;
  const queued = actor.inbox.filter((row: any) => row.status === 'queued').length;
  const contextEntries = asEntries(actor.machine_context);
  const latestInputs = [...actor.inbox].slice(-2).reverse();
  const latestOutputs = [...actor.outputs].slice(-2).reverse();

  return <article className={`actorNode ${props.data.selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="flowHandle target" />
    <header className="actorNodeHeader">
      <div>
        <strong>{actor.display_name}</strong>
        <span>{actor.id}</span>
      </div>
      <em className={statusClass(actor.status)}>{actor.status}</em>
    </header>

    <div className="contextChips" title={JSON.stringify(actor.machine_context)}>
      <small>ctx</small>
      {contextEntries.length === 0 ? <i>empty</i> : contextEntries.map(([key, value]) => <i key={key}>{key} <b>{String(value)}</b></i>)}
    </div>

    <section className="nodeMessages">
      <div>
        <h4>IN ({actor.inbox.length})</h4>
        {latestInputs.length ? latestInputs.map((row: any) => <MessageRow key={row.id} tone="in" name={props.data.displayMessageName(row)} seq={row.seq} status={row.status} />) : <p>—</p>}
      </div>
      <div>
        <h4>OUT ({actor.outputs.length})</h4>
        {latestOutputs.length ? latestOutputs.map((row: any) => <MessageRow key={row.id} tone="out" name={row.output_name} seq={row.seq} status={row.commit_status} />) : <p>—</p>}
      </div>
    </section>

    <footer className="actorMetrics">
      <span><b>{actor.workflowRuns?.length ?? 0}</b> runs</span>
      <span><b>{actor.workflowSteps?.length ?? 0}</b> steps</span>
      <span><b>{queued}</b> queued</span>
      <span><b>{actor.outputs.length}</b> outputs</span>
    </footer>
    <Handle type="source" position={Position.Right} className="flowHandle source" />
  </article>;
}

function MetricCard(props: { readonly label: string; readonly value: number | string }) {
  return <div className="metricCard"><span>{props.label}</span><b>{props.value}</b></div>;
}

function buildTimeline(snapshot: any, displayMessageName: (row: any) => string): TTimelineEvent[] {
  const actorsById = new Map((snapshot?.actors ?? []).map((actor: any) => [actor.id, actor]));
  const inboxEvents = (snapshot?.global?.inbox ?? []).map((row: any) => {
    const actor: any = actorsById.get(row.actor_instance_id);
    return {
      id: `in:${row.id}`,
      time: formatTime(row.created_at),
      type: row.status === 'rejected' || row.status === 'deadLettered' ? 'error' : 'input',
      actorId: row.actor_instance_id,
      actorName: actor?.display_name ?? row.actor_instance_id,
      direction: 'in',
      message: displayMessageName(row),
      correlationId: row.correlation_id,
      seq: row.seq,
      payload: row.params,
      status: row.status,
    } satisfies TTimelineEvent;
  });
  const outputEvents = (snapshot?.global?.outputs ?? []).map((row: any) => {
    const actor: any = actorsById.get(row.actor_instance_id);
    return {
      id: `out:${row.id}`,
      time: formatTime(row.created_at),
      type: 'output',
      actorId: row.actor_instance_id,
      actorName: actor?.display_name ?? row.actor_instance_id,
      direction: 'out',
      message: row.output_name,
      correlationId: row.correlation_id,
      seq: row.seq,
      payload: row.payload,
      status: row.commit_status,
    } satisfies TTimelineEvent;
  });
  return [...inboxEvents, ...outputEvents].sort((a, b) => a.time.localeCompare(b.time) || a.seq - b.seq).slice(-50).reverse();
}

export function App({ initialSnapshot }: TAppProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedActorId, setSelectedActorId] = useState(initialSnapshot?.actors?.[0]?.id ?? '');
  const [eventName, setEventName] = useState(getDefaultEventName(initialSnapshot));
  const [payload, setPayload] = useState(getDefaultPayload(initialSnapshot));
  const [selectedTab, setSelectedTab] = useState<'state' | 'ctx' | 'queue' | 'events' | 'send'>('state');
  const actors = snapshot?.actors ?? [];
  const selectedActor = actors.find((actor: any) => actor.id === selectedActorId) ?? actors[0];

  const outputsById = useMemo(() => new Map((snapshot?.global?.outputs ?? []).map((row: any) => [row.id, row])), [snapshot]);
  const displayMessageName = React.useCallback((row: any) => {
    const sourceOutput = row.source_output_id ? outputsById.get(row.source_output_id) as any : null;
    if (!sourceOutput) return row.event_name;
    return `${row.event_name} ← ${sourceOutput.output_name}`;
  }, [outputsById]);

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
    data: { actor, selected: actor.id === selectedActor?.id, displayMessageName },
  })), [actors, selectedActor?.id, displayMessageName]);

  const edges = useMemo<Edge[]>(() => (snapshot?.connections ?? []).map((connection: any) => ({
    id: connection.id,
    source: connection.source_actor_instance_id,
    target: connection.target_actor_instance_id,
    label: connection.event_name_whitelist?.[0] ?? connection.label ?? connection.id,
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    className: 'actorEdge',
    labelClassName: 'actorEdgeLabel',
  })), [snapshot]);

  const timeline = useMemo(() => buildTimeline(snapshot, displayMessageName), [snapshot, displayMessageName]);

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
    setSelectedTab('queue');
  }

  return <main className="shell">
    <header className="topbar">
      <div className="topBrand"><span>VC</span><b>Actor Visualizer</b><em>{snapshot.scenario.name}</em></div>
      <div className="topMode"><strong>Live topology</strong><i>● Live</i></div>
      <div className="topStats"><span>{actors.length} actors</span><span>{edges.length} connection</span><button onClick={() => post('/api/tick')}>Run one tick</button><button className="primary" onClick={() => post('/api/drain')}>Drain queue</button></div>
    </header>

    <aside className="sidebar panel">
      <label>Scenario</label>
      <select value={snapshot.scenario.id} onChange={(event) => post('/api/scenario', { scenarioId: event.currentTarget.value })}>
        {(snapshot.scenarioOptions ?? []).map((scenario: any) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
      </select>
      <p className="description">{snapshot.scenario.description}</p>
      <section className="dbStack">
        <h3>Runtime</h3>
        <div className="metricGrid">
          <MetricCard label="runs" value={snapshot.global.workflowRuns.length} />
          <MetricCard label="steps" value={snapshot.global.workflowSteps.length} />
          <MetricCard label="queued" value={snapshot.global.inbox.filter((row: any) => row.status === 'queued').length} />
          <MetricCard label="outputs" value={snapshot.global.outputs.length} />
        </div>
      </section>
      <section className="actorList">
        <h3>Actors ({actors.length})</h3>
        {actors.map((actor: any) => <button key={actor.id} className={actor.id === selectedActor?.id ? 'active' : ''} onClick={() => setSelectedActorId(actor.id)}>
          <span><b>{actor.display_name}</b><small>{actor.id}</small></span><em className={statusClass(actor.status)}>{actor.status}</em>
        </button>)}
      </section>
    </aside>

    <section className="flowPanel">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.28 }}
        minZoom={0.35}
        maxZoom={1.6}
        onNodeClick={(_event, node) => setSelectedActorId(node.id)}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>

    <aside className="inspector panel">
      <span className="eyebrow">Inspector</span>
      <div className="inspectorTitle"><h2>{selectedActor?.display_name ?? 'No actor selected'}</h2>{selectedActor && <em className={statusClass(selectedActor.status)}>{selectedActor.status}</em>}</div>
      {selectedActor && <React.Fragment>
        <p className="actorId">{selectedActor.id}</p>
        <nav className="tabs">
          {(['state', 'ctx', 'queue', 'events', 'send'] as const).map((tab) => <button key={tab} className={selectedTab === tab ? 'active' : ''} onClick={() => setSelectedTab(tab)}>{tab}</button>)}
        </nav>
        {(selectedTab === 'state' || selectedTab === 'ctx') && <section className="inspectSection">
          <h3>Local actor context</h3>
          <div className="ctxStrip">{asEntries(selectedActor.machine_context).map(([key, value]) => <span key={key}>{key}<b>{String(value)}</b></span>)}</div>
          <JsonBlock value={{ state: selectedActor.machine_state, context: selectedActor.machine_context }} />
        </section>}
        {selectedTab === 'queue' && <section className="inspectSection">
          <h3>Input queue ({selectedActor.inbox.length})</h3>
          {selectedActor.inbox.map((row: any) => <MessageRow key={row.id} tone="in" name={displayMessageName(row)} seq={row.seq} status={row.status} />)}
          <h3>Output events ({selectedActor.outputs.length})</h3>
          {selectedActor.outputs.map((row: any) => <MessageRow key={row.id} tone="out" name={row.output_name} seq={row.seq} status={row.commit_status} />)}
        </section>}
        {selectedTab === 'events' && <section className="inspectSection"><h3>fn / fx / tx execution</h3><JsonBlock value={selectedActor.workflowSteps} /></section>}
        {selectedTab === 'send' && <section className="sendBox">
          <label>Send message</label>
          <input value={eventName} onChange={(event) => setEventName(event.currentTarget.value)} placeholder="msg.in.increment" />
          <textarea value={payload} onChange={(event) => setPayload(event.currentTarget.value)} rows={4} />
          <button className="primary" onClick={sendMessage}>Send</button>
        </section>}
        <section className="sendBox pinnedSend">
          <label>Quick send</label>
          <div className="quickSend"><input value={eventName} onChange={(event) => setEventName(event.currentTarget.value)} /><button className="primary" onClick={sendMessage}>Send</button></div>
        </section>
      </React.Fragment>}
    </aside>

    <section className="timeline panel">
      <div className="timelineHeader"><h3>Event timeline <small>(last 50 events)</small></h3><input placeholder="Filter" readOnly /></div>
      <table>
        <thead><tr><th>time</th><th>type</th><th>actor</th><th>direction</th><th>message</th><th>correlation id</th><th>seq</th><th>payload preview</th></tr></thead>
        <tbody>{timeline.map((event) => <tr key={event.id} className={event.type} onClick={() => setSelectedActorId(event.actorId)}>
          <td>{event.time}</td><td><span className={`eventPill ${event.type}`}>{event.type}</span></td><td>{event.actorName}</td><td>{event.direction}</td><td className="messageName">{event.message}</td><td className="corr">{event.correlationId}</td><td>{event.seq}</td><td>{shortJson(event.payload)}</td>
        </tr>)}</tbody>
      </table>
    </section>
  </main>;
}
