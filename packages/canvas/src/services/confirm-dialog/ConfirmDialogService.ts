import type { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";

export type TConfirmDialogRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type TPendingConfirmDialogRequest = TConfirmDialogRequest & {
  resolve: (confirmed: boolean) => void;
};

export interface IConfirmDialogServiceHooks {
  stateChange: SyncHook<[]>;
}

export class ConfirmDialogService implements IService<IConfirmDialogServiceHooks> {
  readonly name = "confirmDialog";
  readonly hooks: IConfirmDialogServiceHooks = {
    stateChange: new SyncHook(),
  };

  request: TPendingConfirmDialogRequest | null = null;

  confirm(request: TConfirmDialogRequest): Promise<boolean> {
    this.request?.resolve(false);

    return new Promise((resolve) => {
      this.request = {
        ...request,
        resolve,
      };
      this.hooks.stateChange.call();
    });
  }

  resolve(confirmed: boolean) {
    const request = this.request;
    if (!request) {
      return;
    }

    this.request = null;
    request.resolve(confirmed);
    this.hooks.stateChange.call();
  }
}
