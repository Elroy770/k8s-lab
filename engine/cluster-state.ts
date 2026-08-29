export interface ClusterNode {
  name: string;
  status: "Ready" | "NotReady";
  roles: string[];
  ip: string;
  cpu: string;
  memory: string;
  pods: string[];
}

export interface ActionImpact {
  userAction: string;
  summary: string;
  controlPlaneEvents: string[];
  dataPlaneEvents: string[];
  affectedNodes: string[];
  affectedPods: string[];
  timestamp: number;
}

export interface Pod {
  name: string;
  image: string;
  status: "Pending" | "ContainerCreating" | "Running" | "Terminating" | "CrashLoopBackOff";
  node?: string;
  ip?: string;
  labels?: Record<string, string>;
  ownerRef?: {
    kind: "ReplicaSet" | "Deployment" | "DaemonSet" | "StatefulSet" | "Job";
    name: string;
  };
  restarts: number;
  age: string;
  namespace?: string;
}

export interface ReplicaSet {
  name: string;
  desiredReplicas: number;
  currentReplicas: number;
  readyReplicas: number;
  replicas?: number;
  image: string;
  labels?: Record<string, string>;
  matchLabels?: Record<string, string>;
  ownerRef?: {
    kind: "Deployment";
    name: string;
  };
  age: string;
  namespace?: string;
}

export interface Deployment {
  name: string;
  replicas: number;
  readyReplicas?: number;
  upToDate: number;
  available: number;
  image: string;
  labels?: Record<string, string>;
  matchLabels?: Record<string, string>;
  revision: number;
  oldRevisions?: { revision: number; image: string; rsName: string }[];
  age: string;
  namespace?: string;
}

export interface DaemonSet {
  name: string;
  desiredNodes: number;
  currentPods: number;
  readyPods: number;
  numberReady?: number;
  desiredNumberScheduled?: number;
  image: string;
  age: string;
  namespace?: string;
}

export interface StatefulSet {
  name: string;
  replicas: number;
  readyReplicas: number;
  image: string;
  serviceName: string;
  age: string;
  namespace?: string;
}

export interface Job {
  name: string;
  completions: number;
  succeeded: number;
  failed: number;
  image: string;
  status: "Running" | "Complete" | "Failed";
  age: string;
  namespace?: string;
}

export interface CronJob {
  name: string;
  schedule: string;
  lastSchedule: string;
  active: number;
  age: string;
  namespace?: string;
}

export interface ServicePort {
  port: number | string;
  nodePort?: number | string;
  targetPort?: number | string;
  protocol?: string;
}

export interface Service {
  name: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "Headless";
  clusterIP: string;
  externalIP?: string;
  ports: string | ServicePort[];
  selector: Record<string, string>;
  age: string;
  namespace?: string;
}

export interface Namespace {
  name: string;
  status: "Active" | "Terminating";
  age: string;
}

export interface ConfigMapResource {
  name: string;
  data: Record<string, string>;
  age: string;
  namespace?: string;
}

export interface SecretResource {
  name: string;
  type: string;
  dataKeys?: string[];
  data?: Record<string, string>;
  age: string;
  namespace?: string;
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
  namespaces: Namespace[];
  configMaps: ConfigMapResource[];
  secrets: SecretResource[];
  files: Record<string, string>;
  lastActionImpact?: ActionImpact;
}

export const DEFAULT_NODES: ClusterNode[] = [
  {
    name: "control-plane",
    status: "Ready",
    roles: ["control-plane"],
    ip: "172.18.0.2",
    cpu: "4.0",
    memory: "8Gi",
    pods: [],
  },
  {
    name: "worker-node-1",
    status: "Ready",
    roles: ["worker"],
    ip: "172.18.0.3",
    cpu: "4.0",
    memory: "8Gi",
    pods: [],
  },
  {
    name: "worker-node-2",
    status: "Ready",
    roles: ["worker"],
    ip: "172.18.0.4",
    cpu: "4.0",
    memory: "8Gi",
    pods: [],
  },
];

export const DEFAULT_FILES: Record<string, string> = {
  "pod.yaml": `apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
spec:
  containers:
  - name: nginx
    image: nginx:latest
    ports:
    - containerPort: 80
`,
  "deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.19
        ports:
        - containerPort: 80
`,
  "service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: nginx-service
spec:
  type: ClusterIP
  selector:
    app: nginx
  ports:
  - port: 80
    targetPort: 80
`,
};

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
