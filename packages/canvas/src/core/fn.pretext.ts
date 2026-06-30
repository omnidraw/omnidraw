export function fnBuildPretextFont(args: {
  fontStyle?: string;
  fontSize: number;
  fontFamily: string;
}) {
  const fontFamily = args.fontFamily.includes(" ") && !args.fontFamily.startsWith('"')
    ? `"${args.fontFamily}"`
    : args.fontFamily;
  const style = args.fontStyle && args.fontStyle !== "normal"
    ? `${args.fontStyle} `
    : "";

  return `${style}${args.fontSize}px ${fontFamily}`;
}
