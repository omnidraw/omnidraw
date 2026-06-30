export type TPortalSyncHandLayer = {
  handLayer: HTMLDivElement;
};

export type TArgsSyncHandLayer = {
  display: string;
  pointerEvents: string;
  cursor: string;
};

export function txSyncHandLayer(portal: TPortalSyncHandLayer, args: TArgsSyncHandLayer) {
  portal.handLayer.style.display = args.display;
  portal.handLayer.style.pointerEvents = args.pointerEvents;
  portal.handLayer.style.cursor = args.cursor;
}
