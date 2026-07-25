import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNewCanvasHarness } from "../../new-test-setup";
import { ensureDom } from "../../test-setup";

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

type TDecodeController = {
  resolve(width?: number, height?: number): void;
  reject(): void;
  restore(): void;
};

function installDecodeController(): TDecodeController {
  const createElement = document.createElement.bind(document);
  let pendingImage: HTMLImageElement | null = null;
  const spy = vi.spyOn(document, "createElement").mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const element = createElement(tagName, options);
    if (tagName.toLowerCase() === "img") {
      pendingImage = element as HTMLImageElement;
      Object.defineProperty(pendingImage, "src", {
        configurable: true,
        set: () => undefined,
      });
    }
    return element;
  }) as typeof document.createElement);

  const takeImage = () => {
    if (pendingImage === null) {
      throw new Error("Image decode has not started.");
    }
    return pendingImage;
  };

  return {
    resolve(width = 1200, height = 600) {
      const image = takeImage();
      image.width = width;
      image.height = height;
      image.onload?.call(image, new Event("load"));
    },
    reject() {
      const image = takeImage();
      image.onerror?.call(image, new Event("error"));
    },
    restore: () => spy.mockRestore(),
  };
}

function imageFile(): File {
  return {
    type: "image/png",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as File;
}

function dispatchImagePaste(file = imageFile()): ClipboardEvent {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: { files: [file] },
  });
  document.dispatchEvent(event);
  return event;
}

describe("Image plugin insertion lifecycle", () => {
  let originalCreateObjectUrl: PropertyDescriptor | undefined;
  let originalRevokeObjectUrl: PropertyDescriptor | undefined;
  let createObjectUrl: ReturnType<typeof vi.fn>;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ensureDom();
    originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      window.URL,
      "createObjectURL",
    );
    originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      window.URL,
      "revokeObjectURL",
    );
    createObjectUrl = vi.fn(() => "blob:image-preview");
    revokeObjectUrl = vi.fn();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
  });

  afterEach(() => {
    if (originalCreateObjectUrl === undefined) {
      Reflect.deleteProperty(window.URL, "createObjectURL");
    } else {
      Object.defineProperty(
        window.URL,
        "createObjectURL",
        originalCreateObjectUrl,
      );
    }
    if (originalRevokeObjectUrl === undefined) {
      Reflect.deleteProperty(window.URL, "revokeObjectURL");
    } else {
      Object.defineProperty(
        window.URL,
        "revokeObjectURL",
        originalRevokeObjectUrl,
      );
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("shows an engine transient immediately and retains it until the durable image projects", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 1,
      height: 1,
      close: vi.fn(),
    } as unknown as ImageBitmap)));
    const upload = deferred<{ url: string }>();
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const harness = await createNewCanvasHarness({
      image: {
        uploadImage: vi.fn(() => upload.promise),
        cloneImage: vi.fn(async ({ url }) => ({ url })),
        deleteImage,
      },
    });
    const decode = installDecodeController();
    try {
      const paste = dispatchImagePaste();

      expect(paste.defaultPrevented).toBe(true);
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 2,
        transientNodeCount: 1,
      });
      expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);

      decode.resolve();
      await Promise.resolve();
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 2,
        transientNodeCount: 1,
      });

      upload.resolve({ url: ONE_PIXEL_PNG });
      await vi.waitFor(() => {
        expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(1);
      });
      await harness.flush();

      const inserted = Object.values(harness.docHandle.doc().elements)[0];
      expect(inserted).toMatchObject({
        data: {
          type: "image",
          url: ONE_PIXEL_PNG,
          w: 300,
          h: 150,
        },
      });
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 1,
        transientNodeCount: 0,
      });
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:image-preview");
      expect(deleteImage).not.toHaveBeenCalled();
    } finally {
      decode.restore();
      await harness.destroy();
    }
  });

  test("Escape cancels a pending insert and deletes a late upload", async () => {
    const upload = deferred<{ url: string }>();
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const harness = await createNewCanvasHarness({
      image: {
        uploadImage: vi.fn(() => upload.promise),
        cloneImage: vi.fn(async ({ url }) => ({ url })),
        deleteImage,
      },
    });
    const decode = installDecodeController();
    try {
      dispatchImagePaste();
      decode.resolve();
      await Promise.resolve();

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(escape);

      expect(escape.defaultPrevented).toBe(true);
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 1,
        transientNodeCount: 0,
      });

      upload.resolve({ url: "https://cdn.test/cancelled.png" });
      await vi.waitFor(() => {
        expect(deleteImage).toHaveBeenCalledWith({
          url: "https://cdn.test/cancelled.png",
        });
      });
      expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);
    } finally {
      decode.restore();
      await harness.destroy();
    }
  });

  test("decode failure removes the preview and cleans up a successful upload", async () => {
    const upload = deferred<{ url: string }>();
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const notification = {
      showError: vi.fn(),
      showInfo: vi.fn(),
      showSuccess: vi.fn(),
    };
    const harness = await createNewCanvasHarness({
      image: {
        uploadImage: vi.fn(() => upload.promise),
        cloneImage: vi.fn(async ({ url }) => ({ url })),
        deleteImage,
      },
      notification,
    });
    const decode = installDecodeController();
    try {
      dispatchImagePaste();
      decode.reject();
      await vi.waitFor(() => {
        expect(notification.showError).toHaveBeenCalledWith(
          "Failed to insert image",
          "Failed to decode image",
        );
      });
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 1,
        transientNodeCount: 0,
      });

      upload.resolve({ url: "https://cdn.test/orphan.png" });
      await vi.waitFor(() => {
        expect(deleteImage).toHaveBeenCalledWith({
          url: "https://cdn.test/orphan.png",
        });
      });
      expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);
    } finally {
      decode.restore();
      await harness.destroy();
    }
  });

  test("commit failure removes the preview and cleans up the upload", async () => {
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const notification = {
      showError: vi.fn(),
      showInfo: vi.fn(),
      showSuccess: vi.fn(),
    };
    const harness = await createNewCanvasHarness({
      image: {
        uploadImage: vi.fn(async () => ({
          url: "https://cdn.test/uncommitted.png",
        })),
        cloneImage: vi.fn(async ({ url }) => ({ url })),
        deleteImage,
      },
      notification,
    });
    const decode = installDecodeController();
    const crdt = harness.runtime.services.require("crdt");
    vi.spyOn(crdt, "build").mockImplementation(() => {
      const builder = {
        patchElement: () => builder,
        commit: () => {
          throw new Error("commit rejected");
        },
      };
      return builder as never;
    });
    try {
      dispatchImagePaste();
      decode.resolve();

      await vi.waitFor(() => {
        expect(deleteImage).toHaveBeenCalledWith({
          url: "https://cdn.test/uncommitted.png",
        });
      });
      expect(notification.showError).toHaveBeenCalledWith(
        "Failed to insert image",
        "commit rejected",
      );
      expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 1,
        transientNodeCount: 0,
      });
    } finally {
      decode.restore();
      await harness.destroy();
    }
  });

  test("pending projection failure cleans up an upload before durable commit", async () => {
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const notification = {
      showError: vi.fn(),
      showInfo: vi.fn(),
      showSuccess: vi.fn(),
    };
    const harness = await createNewCanvasHarness({
      image: {
        uploadImage: vi.fn(async () => ({
          url: "https://cdn.test/unprojected.png",
        })),
        cloneImage: vi.fn(async ({ url }) => ({ url })),
        deleteImage,
      },
      notification,
    });
    const decode = installDecodeController();
    const transients = harness.scene.product.transients;
    const createOwner = transients.createOwner.bind(transients);
    vi.spyOn(transients, "createOwner").mockImplementation((options) => {
      const owner = createOwner(options);
      let replacementCount = 0;
      return {
        id: owner.id,
        clear: () => owner.clear(),
        destroy: () => owner.destroy(),
        replace: (projection) => {
          replacementCount += 1;
          if (replacementCount > 1) {
            throw new Error("preview projection rejected");
          }
          owner.replace(projection);
        },
      };
    });
    try {
      dispatchImagePaste();
      decode.resolve();

      await vi.waitFor(() => {
        expect(deleteImage).toHaveBeenCalledWith({
          url: "https://cdn.test/unprojected.png",
        });
      });
      expect(notification.showError).toHaveBeenCalledWith(
        "Failed to insert image",
        "preview projection rejected",
      );
      expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 1,
        transientNodeCount: 0,
      });
    } finally {
      decode.restore();
      await harness.destroy();
    }
  });

  test("teardown cancels the session and prevents a late durable commit", async () => {
    const upload = deferred<{ url: string }>();
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const harness = await createNewCanvasHarness({
      image: {
        uploadImage: vi.fn(() => upload.promise),
        cloneImage: vi.fn(async ({ url }) => ({ url })),
        deleteImage,
      },
    });
    const decode = installDecodeController();
    try {
      dispatchImagePaste();
      expect(harness.metrics()).toMatchObject({
        transientOwnerCount: 2,
        transientNodeCount: 1,
      });

      await harness.destroy();
      upload.resolve({ url: "https://cdn.test/late-after-destroy.png" });
      await vi.waitFor(() => {
        expect(deleteImage).toHaveBeenCalledWith({
          url: "https://cdn.test/late-after-destroy.png",
        });
      });
      expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);
    } finally {
      decode.restore();
    }
  });
});
