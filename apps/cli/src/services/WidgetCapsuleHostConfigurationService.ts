import type {
  IWidgetCapsuleHostConfigurationReader,
  TWidgetCapsuleHostConfiguration,
} from '@vibecanvas/widget-contract';
import {
  VIBECANVAS_CAPSULE_ALLOWED_APIS,
  VIBECANVAS_CAPSULE_HOST_LIMITS,
} from '@vibecanvas/capsule-vibecanvas/builder';
import { createHash } from 'node:crypto';
import {
  WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from './CONSTANTS';
import { WidgetCapsuleSigningKeyStore } from './WidgetCapsuleSigningKeyStore';

/**
 * Trusted deployment policy projected into public browser-safe host config.
 * The signer owns private keys; this service can return public material only.
 */
export class WidgetCapsuleHostConfigurationService
implements IWidgetCapsuleHostConfigurationReader {
  readonly name = 'widget-capsule-host-configuration';
  #configuration: Promise<TWidgetCapsuleHostConfiguration> | undefined;

  constructor(readonly signingKeys: WidgetCapsuleSigningKeyStore) {}

  read(): Promise<TWidgetCapsuleHostConfiguration> {
    this.#configuration ??= this.#read();
    return this.#configuration;
  }

  async #read(): Promise<TWidgetCapsuleHostConfiguration> {
    const signingKeys = Object.freeze([
      ...await this.signingKeys.publicSigningKeys(),
    ].sort((left, right) => left.keyId.localeCompare(right.keyId)));
    const allowedApis = Object.freeze([...VIBECANVAS_CAPSULE_ALLOWED_APIS]);
    const limits = Object.freeze({ ...VIBECANVAS_CAPSULE_HOST_LIMITS });
    const canonical = JSON.stringify({
      allowedApis,
      limits,
      previewSigningKeyId: WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID,
      releaseSigningKeyId: WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
      signingKeys,
    });
    return Object.freeze({
      generation: createHash('sha256').update(canonical).digest('hex'),
      allowedApis,
      limits,
      previewSigningKeyId: WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID,
      releaseSigningKeyId: WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
      signingKeys,
    });
  }
}
