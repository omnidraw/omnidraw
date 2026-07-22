process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), 120);
});

export default {
  fn: {},
  fx: {},
  tx: {},
};
