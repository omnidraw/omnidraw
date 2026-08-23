/**
 * @file Narrow public capabilities for widget build, publication, artifact access, and GC.
 */

import type {
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetArtifactInspectionRequest,
  TWidgetArtifactInspectionResult,
  TWidgetArtifactSignRequest,
  TWidgetArtifactSignResult,
  TWidgetHostConfiguration,
  TWidgetRuntimeDescriptor,
  TWidgetRuntimeDescriptorCreateRequest,
  TWidgetUiArtifact,
  TWidgetUiBuildRequest,
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorExtractionRequest,
} from '@omnidraw/sdk/contract';

export interface IWidgetCapsuleHostConfigurationReader {
  read(): Promise<TWidgetHostConfiguration>;
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
    request: TWidgetUiBuildRequest,
  ): Promise<TWidgetUiArtifact>;
}

/** Trusted bytes-in/bytes-out signing port. Private signing material is never part of this contract. */
export interface IWidgetCapsuleArtifactSigner {
  signCapsuleArtifact(
    request: TWidgetArtifactSignRequest,
  ): Promise<TWidgetArtifactSignResult>;
}

/** Verifies exact signed bytes and returns only serializable Capsule runtime metadata. */
export interface IWidgetCapsuleArtifactInspector {
  inspectCapsuleArtifact(
    request: TWidgetArtifactInspectionRequest,
  ): Promise<TWidgetArtifactInspectionResult>;
}

export interface IWidgetCapsuleRuntimeDescriptorFactory {
  createCapsuleRuntimeDescriptor(
    request: TWidgetRuntimeDescriptorCreateRequest,
  ): TWidgetRuntimeDescriptor;
}

/**
 * Loads an already-built server artifact only inside a bounded descriptor-
 * extraction guest and returns its generated, serializable named-export descriptors.
 */
export interface IWidgetServerFunctionDescriptorExtractor {
  extractServerFunctionDescriptors(
    request: TWidgetServerFunctionDescriptorExtractionRequest,
  ): Promise<readonly TWidgetServerFunctionDescriptor[]>;
}
