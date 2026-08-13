type TShutdownHandler = () => Promise<void> | void;

function setupSignals(shutdown: TShutdownHandler) {
  const onSignal = () => {
    void shutdown();
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

export { setupSignals };
