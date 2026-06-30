export type TPortalEmitInvalidOutput = {
  readonly emitMessage: (msg: any) => Promise<unknown>;
};

export type TArgsEmitInvalidOutput = {
  readonly data: { balance: number };
  readonly msg: Record<string, never>;
};

export async function fnEmitInvalidOutput(portal: TPortalEmitInvalidOutput, args: TArgsEmitInvalidOutput) {
  await portal.emitMessage({
    type: "funds-added",
    payload: {
      balance: args.data.balance,
    },
  });

  return args.data;
}
