export type TWidgetRuntimeLoadAdmissionCounts = Readonly<{
  activeGlobal: number;
  activeOrganization: number;
}>;

export type TWidgetRuntimeLoadAdmissionLimits = Readonly<{
  maxGlobal: number;
  maxPerOrganization: number;
}>;

export function fnWidgetRuntimeLoadCanAdmit(
  counts: TWidgetRuntimeLoadAdmissionCounts,
  limits: TWidgetRuntimeLoadAdmissionLimits,
): boolean {
  return counts.activeGlobal < limits.maxGlobal
    && counts.activeOrganization < limits.maxPerOrganization;
}
