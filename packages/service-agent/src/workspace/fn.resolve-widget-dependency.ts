type TArgs = Readonly<{
  dependency: string;
  specifier: string;
  catalog: Readonly<Record<string, string>>;
}>;

const LOCAL_PROTOCOL_PATTERN = /^(?:catalog|file|link|workspace):/;

export function fnResolveWidgetDependency(args: TArgs): string {
  const resolved = args.specifier === 'catalog:'
    ? args.catalog[args.dependency]
    : args.specifier;

  if (resolved === undefined) {
    throw new Error(`${args.dependency} is absent from the root package catalog.`);
  }
  if (LOCAL_PROTOCOL_PATTERN.test(resolved)) {
    throw new Error(
      `${args.dependency} uses local-only dependency specifier ${resolved}; standalone widgets require a registry-compatible specifier.`,
    );
  }
  return resolved;
}
