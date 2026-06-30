function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function OpacitySlider(props: {
  value: number | undefined;
  onChange: (opacity: number) => void;
}) {
  const percentValue = () => Math.round((props.value ?? 1) * 100);

  const updateFromPointer = (clientX: number, track: HTMLDivElement) => {
    const rect = track.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
    props.onChange(clamp(Math.round(clamp(ratio, 0, 1) * 100) / 100, 0, 1));
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const track = event.currentTarget as HTMLDivElement | null;
    if (!track) {
      return;
    }

    updateFromPointer(event.clientX, track);
    track.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateFromPointer(moveEvent.clientX, track);
    };
    const onPointerUp = () => {
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", onPointerUp);
      track.removeEventListener("pointercancel", onPointerUp);
    };

    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", onPointerUp);
    track.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "0.75rem" }}>
      <div
        onPointerDown={onPointerDown}
        style={{
          position: "relative",
          flex: 1,
          height: "1.75rem",
          cursor: "ew-resize",
          "user-select": "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: "0.375rem",
            transform: "translateY(-50%)",
            border: "1px solid var(--border)",
            background: "var(--muted)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            height: "0.375rem",
            width: `${percentValue()}%`,
            transform: "translateY(-50%)",
            background: "var(--primary)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${percentValue()}%`,
            top: "50%",
            width: "0.75rem",
            height: "1rem",
            transform: "translate(-50%, -50%)",
            border: "1px solid var(--primary)",
            background: "var(--card)",
          }}
        />
      </div>
      <span style={{ width: "2.75rem", "text-align": "right", "font-size": "10px", color: "var(--muted-foreground)", "font-family": "var(--font-mono)" }}>
        {percentValue()}%
      </span>
    </div>
  );
}
