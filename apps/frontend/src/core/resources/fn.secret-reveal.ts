export type TSecretRowMetadata = {
  name: string;
  revision: number;
};

export type TSecretPageMetadata = {
  kind: "secretStore";
  entries: readonly TSecretRowMetadata[];
};

export type TSecretRevealRequestIdentity = {
  generation: number;
  resourceId: string;
  name: string;
  revision: number;
};

export type TSecretRevealResponseIdentity = {
  kind: "secretStore";
  name: string;
  revision: number;
};

export const fnSecretRevealIdentityIsCurrent = (
  identity: Pick<TSecretRevealRequestIdentity, "resourceId" | "name" | "revision">,
  currentResourceId: string,
  activeTab: string,
  page: TSecretPageMetadata | null,
): boolean =>
  activeTab === "data"
  && identity.resourceId === currentResourceId
  && page?.entries.some((entry) => entry.name === identity.name && entry.revision === identity.revision) === true;

export const fnCanApplySecretReveal = (
  request: TSecretRevealRequestIdentity,
  currentGeneration: number,
  currentResourceId: string,
  activeTab: string,
  documentIsVisible: boolean,
  page: TSecretPageMetadata | null,
  response: TSecretRevealResponseIdentity,
): boolean =>
  request.generation === currentGeneration
  && documentIsVisible
  && response.kind === "secretStore"
  && response.name === request.name
  && response.revision === request.revision
  && fnSecretRevealIdentityIsCurrent(request, currentResourceId, activeTab, page);
