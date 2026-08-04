/**
 * @file Narrow public capabilities for widget build, publication, artifact access, and GC.
 */

import type {
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetCapsuleArtifactInspectionRequest,
  TWidgetCapsuleArtifactInspectionResult,
  TWidgetCapsuleArtifactSignRequest,
  TWidgetCapsuleArtifactSignResult,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleRuntimeDescriptorCreateRequest,
  TWidgetCapsuleUiArtifact,
  TWidgetCapsuleUiBuildRequest,
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorExtractionRequest,
} from './types';

export interface IWidgetCapsuleHostConfigurationReader {
  read(): Promise<TWidgetCapsuleHostConfiguration>;
}

export interface IWidgetArtifactBuilder {
  build(request: TWidgetBuildRequest): Promise<TWidgetBuildResult>;
}

/** Builds exact unsigned UI/source/server outputs without selecting signing authority. */
export interface IWidgetArtifactConstructor {
  construct(
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult>;
  closeWorkspace?(
    request: Readonly<{ workspaceKey: string }>,
  ): Promise<void>;
  close?(): Promise<void>;
}

/** Applies Preview or release signing to one already-built immutable construction. */
export interface IWidgetArtifactConstructionSigner {
  signConstruction(
    request: TWidgetArtifactConstructionSignRequest,
  ): Promise<TWidgetBuildResult>;
}

/** Exact construction and signing seam for one filesystem publication. */
export interface IWidgetArtifactConstructionBuilder
  extends IWidgetArtifactBuilder, IWidgetArtifactConstructor, IWidgetArtifactConstructionSigner {}

/** Trusted build port; implementations map Omnidraw inputs to public Capsule build APIs. */
export interface IWidgetCapsuleUiArtifactBuilder {
  buildCapsuleUiArtifact(
    request: TWidgetCapsuleUiBuildRequest,
  ): Promise<TWidgetCapsuleUiArtifact>;
}

/** Trusted bytes-in/bytes-out signing port. Private signing material is never part of this contract. */
export interface IWidgetCapsuleArtifactSigner {
  signCapsuleArtifact(
    request: TWidgetCapsuleArtifactSignRequest,
  ): Promise<TWidgetCapsuleArtifactSignResult>;
}

/** Verifies exact signed bytes and returns only serializable Capsule runtime metadata. */
export interface IWidgetCapsuleArtifactInspector {
  inspectCapsuleArtifact(
    request: TWidgetCapsuleArtifactInspectionRequest,
  ): Promise<TWidgetCapsuleArtifactInspectionResult>;
}

export interface IWidgetCapsuleRuntimeDescriptorFactory {
  createCapsuleRuntimeDescriptor(
    request: TWidgetCapsuleRuntimeDescriptorCreateRequest,
  ): TWidgetCapsuleRuntimeDescriptor;
}

/**
 * Loads an already-built server artifact only inside a bounded registration
 * sandbox and returns its generated, serializable named-export descriptors.
 */
export interface IWidgetServerFunctionDescriptorExtractor {
  extractServerFunctionDescriptors(
    request: TWidgetServerFunctionDescriptorExtractionRequest,
  ): Promise<readonly TWidgetServerFunctionDescriptor[]>;
}
