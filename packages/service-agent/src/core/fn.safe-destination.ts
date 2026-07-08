export function fnAssertSafeFinalDestination(args: { finalWidgetsDir: string; slug: string; basename: (path: string) => string; resolve: (...paths: string[]) => string }) {
  const root = args.resolve(args.finalWidgetsDir);
  const destination = args.resolve(root, args.basename(args.slug));
  if (destination !== root && destination.startsWith(`${root}/`)) {
    return destination;
  }

  throw new Error('Unsafe widget destination');
}
