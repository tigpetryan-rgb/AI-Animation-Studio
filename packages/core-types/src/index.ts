export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ProjectId = Brand<string, "ProjectId">;
export type MovieId = Brand<string, "MovieId">;
export type SceneId = Brand<string, "SceneId">;
export type ShotId = Brand<string, "ShotId">;
export type CharacterId = Brand<string, "CharacterId">;
export type PropId = Brand<string, "PropId">;
export type LocationId = Brand<string, "LocationId">;
export type EventId = Brand<string, "EventId">;
export type ChangeSetId = Brand<string, "ChangeSetId">;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Transform3D {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export type LockOwner = "human" | "system";

export interface LockState {
  readonly locked: boolean;
  readonly owner: LockOwner;
  readonly reason?: string;
}

export interface EntityHeader<Id extends string = string> {
  readonly id: Id;
  readonly entityType: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly tags?: readonly string[];
  readonly lock?: LockState;
}

export const IDENTITY_TRANSFORM: Transform3D = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

export function asProjectId(value: string): ProjectId {
  return value as ProjectId;
}

export function asMovieId(value: string): MovieId {
  return value as MovieId;
}

export function asSceneId(value: string): SceneId {
  return value as SceneId;
}

export function asShotId(value: string): ShotId {
  return value as ShotId;
}

export function asCharacterId(value: string): CharacterId {
  return value as CharacterId;
}

export function asPropId(value: string): PropId {
  return value as PropId;
}

export function asEventId(value: string): EventId {
  return value as EventId;
}
