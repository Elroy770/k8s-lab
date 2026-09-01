export type Labels = Record<string, string>;

export type PodPhase =
  | "Pending"
  | "ContainerCreating"
  | "Running"
  | "Completed"
  | "Failed"
  | "CrashLoopBackOff"
  | "ImagePullBackOff"
  | "Terminating";

export type TaintEffect = "NoSchedule" | "NoExecute";

export interface Taint {
  key: string;
  value: string;
  effect: TaintEffect;
}

export interface Toleration {
  key: string;
  value?: string;
  operator?: "Equal" | "Exists";
  effect?: TaintEffect;
}

export interface ClusterNode {
  name: string;
  role: "control-plane" | "worker";
  labels: Labels;
  taints: Taint[];
  ready: boolean;
}

export type ProbeKind = "liveness" | "readiness" | "startup";

export interface Probe {
  kind: ProbeKind;
  path: string;
  failureThreshold: number;
}

export type VolumeKind = "emptyDir" | "persistentVolumeClaim" | "configMap" | "secret";

export interface PodVolume {
  name: string;
  kind: VolumeKind;
  /** PVC, ConfigMap or Secret name, depending on kind. */
  source?: string;
}

export interface VolumeMount {
  name: string;
  mountPath: string;
}

export interface EnvFromRef {
  kind: "configMap" | "secret";
  name: string;
}

export interface NodeAffinityRule {
  key: string;
  operator: "In" | "NotIn" | "Exists";
  values?: string[];
  /** Preferred rules influence placement but never block scheduling. */
  preferred?: boolean;
}

/** Everything a controller needs in order to stamp out identical Pods. */
export interface PodTemplate {
  image: string;
  labels: Labels;
  nodeSelector?: Labels;
  affinity?: NodeAffinityRule[];
  tolerations?: Toleration[];
  volumes?: PodVolume[];
  mounts?: VolumeMount[];
  env?: Record<string, string>;
  envFrom?: EnvFromRef[];
  probes?: Probe[];
  restartPolicy?: "Always" | "OnFailure" | "Never";
  /** Ticks the container runs before completing. Used by Jobs. */
  runFor?: number;
  /** Marks a workload that exits non-zero, for failure lessons. */
  failing?: boolean;
}

export interface Pod {
  uid: string;
  name: string;
  template: PodTemplate;
  image: string;
  labels: Labels;
  phase: PodPhase;
  ready: boolean;
  node: string | null;
  ip: string;
  restarts: number;
  age: number;
  reason?: string;
  /** Files written through `kubectl exec`, keyed by absolute path. */
  files: Record<string, string>;
  /** Environment resolved when the container started; ConfigMap edits do not change it. */
  envSnapshot?: Record<string, string>;
  logs: string[];
  ownerKind?: "ReplicaSet" | "DaemonSet" | "StatefulSet" | "Job";
  ownerName?: string;
  ordinal?: number;
  runtime: number;
}

export interface RevisionRecord {
  revision: number;
  image: string;
  changeCause: string;
  template: PodTemplate;
}

export interface ReplicaSet {
  uid: string;
  name: string;
  replicas: number;
  template: PodTemplate;
  /** Hash of the template this ReplicaSet was created for. */
  podTemplateHash: string;
  selector: Labels;
  revision: number;
  age: number;
  ownerKind?: "Deployment";
  ownerName?: string;
}

export interface Deployment {
  uid: string;
  name: string;
  replicas: number;
  template: PodTemplate;
  selector: Labels;
  revision: number;
  history: RevisionRecord[];
  age: number;
}

export interface DaemonSet {
  uid: string;
  name: string;
  template: PodTemplate;
  selector: Labels;
  age: number;
}

export interface StatefulSet {
  uid: string;
  name: string;
  replicas: number;
  template: PodTemplate;
  selector: Labels;
  serviceName: string;
  volumeClaimTemplate?: { name: string; requestGi: number; storageClass?: string };
  age: number;
}

export interface Job {
  uid: string;
  name: string;
  template: PodTemplate;
  completions: number;
  parallelism: number;
  backoffLimit: number;
  succeeded: number;
  failed: number;
  age: number;
  ownerKind?: "CronJob";
  ownerName?: string;
}

export interface CronJob {
  uid: string;
  name: string;
  schedule: string;
  /** Ticks between runs, derived from the schedule string. */
  intervalTicks: number;
  suspend: boolean;
  template: PodTemplate;
  lastScheduleAt?: number;
  age: number;
}

export type ServiceType = "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";

export interface Service {
  uid: string;
  name: string;
  type: ServiceType;
  selector: Labels;
  port: number;
  targetPort: number;
  nodePort?: number;
  clusterIP: string;
  externalIP?: string;
  externalName?: string;
  headless: boolean;
  age: number;
}

export interface IngressRule {
  host?: string;
  path: string;
  service: string;
  port: number;
}

export interface Ingress {
  uid: string;
  name: string;
  className?: string;
  rules: IngressRule[];
  address?: string;
  age: number;
}

export interface ConfigMap {
  uid: string;
  name: string;
  data: Record<string, string>;
  age: number;
}

export interface Secret {
  uid: string;
  name: string;
  type: string;
  data: Record<string, string>;
  age: number;
}

export interface StorageClass {
  uid: string;
  name: string;
  provisioner: string;
  isDefault: boolean;
  age: number;
}

export type AccessMode = "ReadWriteOnce" | "ReadOnlyMany" | "ReadWriteMany";

export interface PersistentVolume {
  uid: string;
  name: string;
  capacityGi: number;
  accessModes: AccessMode[];
  storageClass: string;
  status: "Available" | "Bound" | "Released";
  claim?: string;
  age: number;
}

export interface PersistentVolumeClaim {
  uid: string;
  name: string;
  requestGi: number;
  accessModes: AccessMode[];
  storageClass?: string;
  status: "Pending" | "Bound" | "Lost";
  volumeName?: string;
  reason?: string;
  /** Contents that survive Pod deletion. */
  data: Record<string, string>;
  age: number;
}

export interface ClusterEvent {
  id: number;
  at: number;
  type: "Normal" | "Warning";
  reason: string;
  object: string;
  message: string;
}

export interface ClusterState {
  nodes: ClusterNode[];
  pods: Pod[];
  replicaSets: ReplicaSet[];
  deployments: Deployment[];
  daemonSets: DaemonSet[];
  statefulSets: StatefulSet[];
  jobs: Job[];
  cronJobs: CronJob[];
  services: Service[];
  ingresses: Ingress[];
  configMaps: ConfigMap[];
  secrets: Secret[];
  storageClasses: StorageClass[];
  persistentVolumes: PersistentVolume[];
  persistentVolumeClaims: PersistentVolumeClaim[];
  events: ClusterEvent[];
  seq: number;
  clock: number;
}

export interface ParsedCommand {
  raw: string;
  ok: boolean;
  error?: string;
  verb: string;
  subcommand?: string;
  resource?: string;
  names: string[];
  /** Arguments after `--`, used by `kubectl exec`. */
  execArgs: string[];
  flags: Record<string, string | boolean>;
  /** Repeatable flags such as --from-literal. */
  repeated: Record<string, string[]>;
}

export interface CommandResult {
  output: string[];
  isError: boolean;
}
