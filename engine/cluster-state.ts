export interface Pod {
  name: string;
  image: string;
  status: "Running" | "Pending" | "Terminating" | "CrashLoopBackOff";
  node?: string;
  ip?: string;
  labels?: Record<string, string>;
  ownerRef?: {
    kind: "ReplicaSet" | "Deployment";
    name: string;
  };
  restarts: number;
  age: string;
}

export interface ReplicaSet {
  name: string;
  desiredReplicas: number;
  currentReplicas: number;
  readyReplicas: number;
  image: string;
  labels?: Record<string, string>;
  matchLabels?: Record<string, string>;
  ownerRef?: {
    kind: "Deployment";
    name: string;
  };
  age: string;
}

export interface Deployment {
  name: string;
  replicas: number;
  upToDate: number;
  available: number;
  image: string;
  labels?: Record<string, string>;
  matchLabels?: Record<string, string>;
  revision: number;
  oldRevisions?: { revision: number; image: string; rsName: string }[];
  age: string;
}

export interface DaemonSet {
  name: string;
  desiredNodes: number;
  currentPods: number;
  readyPods: number;
  image: string;
  age: string;
}

export interface StatefulSet {
  name: string;
  replicas: number;
  readyReplicas: number;
  image: string;
  serviceName: string;
  age: string;
}

export interface Job {
  name: string;
  completions: number;
  succeeded: number;
  failed: number;
  image: string;
  status: 'Running' | 'Complete' | 'Failed';
  age: string;
}

export interface CronJob {
  name: string;
  schedule: string;
  lastSchedule: string;
  active: number;
  age: string;
}

export interface Service {
  name: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'Headless';
  clusterIP: string;
  externalIP?: string;
  ports: string;
  selector: Record<string, string>;
  age: string;
}

export interface Namespace {
  name: string;
  status: 'Active' | 'Terminating';
  age: string;
}

export interface ConfigMapResource {
  name: string;
  data: Record<string, string>;
  age: string;
}

export interface SecretResource {
  name: string;
  type: string;
  dataKeys: string[];
  age: string;
}

export interface ClusterState {
  pods: Pod[];
  replicaSets: ReplicaSet[];
  deployments: Deployment[];
  daemonSets: DaemonSet[];
  statefulSets: StatefulSet[];
  jobs: Job[];
  cronJobs: CronJob[];
  services: Service[];
  namespaces: Namespace[];
  configMaps: ConfigMapResource[];
  secrets: SecretResource[];
}

export interface StepExpected {
  verb: string;
  resource?: string;
  name?: string;
  target?: string;
  replicas?: number;
}

export interface LessonStep {
  type: "challenge" | "observation" | "explanation" | "transition";
  title?: string;
  description?: string;
  prompt?: string;
  text?: string;
  hint?: string;
  behindTheScenes?: string;
  expected?: StepExpected;
  initialState?: Partial<ClusterState>;
}

export interface Lesson {
  id: string;
  title: string;
  intro: string;
  steps: LessonStep[];
  initialState?: Partial<ClusterState>;
}
