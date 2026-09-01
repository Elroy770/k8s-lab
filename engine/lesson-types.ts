import type { ExpectedCommand } from "./kubectl-parser";
import type { AccessMode, Labels, PodTemplate, Taint } from "./types";

/**
 * Lesson content is data, not code. The UI renders whatever it is given and
 * knows nothing about Pods, Services or any specific lesson.
 */

export type StepType = "observation" | "challenge" | "explanation" | "transition";

/** Things the world can do to the learner when a step is reached. */
export interface StepEffect {
  addNode?: { name: string; labels?: Labels };
  removeNode?: string;
  nodeNotReady?: string;
  killPod?: string;
}

export interface LessonStep {
  type: StepType;
  text?: string;
  prompt?: string;
  hint?: string;
  expected?: ExpectedCommand;
  reveal?: string;
  effect?: StepEffect;
  /** The step is satisfied even when the command fails - failure is the lesson. */
  allowError?: boolean;
}

export interface SeedNode {
  name: string;
  labels?: Labels;
  taints?: Taint[];
}

export interface SeedPod {
  name: string;
  template: PodTemplate;
}

export interface SeedWorkload {
  name: string;
  replicas?: number;
  template: PodTemplate;
  selector?: Labels;
}

export interface SeedDeployment extends SeedWorkload {
  /** Earlier images, replayed for real so revision history exists. */
  previousImages?: string[];
  /** Applied after the cluster settles, e.g. to hand over a stuck rollout. */
  pendingImage?: string;
}

export interface SeedStatefulSet extends SeedWorkload {
  serviceName?: string;
  volumeClaimTemplate?: { name: string; requestGi: number; storageClass?: string };
}

export interface SeedService {
  name: string;
  type?: "ClusterIP" | "NodePort" | "LoadBalancer";
  selector: Labels;
  port: number;
  targetPort?: number;
  nodePort?: number;
  headless?: boolean;
}

export interface SeedIngress {
  name: string;
  className?: string;
  rules: { host?: string; path: string; service: string; port: number }[];
}

export interface SeedJob {
  name: string;
  template: PodTemplate;
  completions?: number;
  parallelism?: number;
  backoffLimit?: number;
}

export interface SeedCronJob {
  name: string;
  schedule: string;
  template: PodTemplate;
  suspend?: boolean;
}

export interface SeedPersistentVolume {
  name: string;
  capacityGi: number;
  accessModes: AccessMode[];
  storageClass: string;
}

export interface SeedPersistentVolumeClaim {
  name: string;
  requestGi: number;
  accessModes: AccessMode[];
  storageClass?: string;
  /** Files that already exist on the volume. */
  data?: Record<string, string>;
}

export interface LessonInitialState {
  nodes?: SeedNode[];
  pods?: SeedPod[];
  replicaSets?: SeedWorkload[];
  deployments?: SeedDeployment[];
  daemonSets?: SeedWorkload[];
  statefulSets?: SeedStatefulSet[];
  jobs?: SeedJob[];
  cronJobs?: SeedCronJob[];
  services?: SeedService[];
  ingresses?: SeedIngress[];
  configMaps?: { name: string; data: Record<string, string> }[];
  secrets?: { name: string; type?: string; data: Record<string, string> }[];
  storageClasses?: { name: string; provisioner: string; isDefault?: boolean }[];
  persistentVolumes?: SeedPersistentVolume[];
  persistentVolumeClaims?: SeedPersistentVolumeClaim[];
}

export interface LessonFile {
  raw: string;
  doc: Record<string, unknown>;
}

export interface Lesson {
  id: string;
  order: number;
  chapter: string;
  title: string;
  concept: string;
  intro: string;
  initialState?: LessonInitialState;
  /** Manifests the learner can `kubectl apply -f` (and `cat`) during the lesson. */
  files?: Record<string, LessonFile>;
  steps: LessonStep[];
}
