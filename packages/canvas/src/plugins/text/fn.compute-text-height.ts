export type TArgsComputeTextHeight = {
  fontSize: number;
  lineHeight: number;
  padding: number;
  text: string;
};

export function fnComputeTextHeight(args: TArgsComputeTextHeight) {
  const lineCount = (args.text.match(/\n/g)?.length ?? 0) + 1;

  return Math.ceil(lineCount * args.fontSize * args.lineHeight) + args.padding * 2;
}
