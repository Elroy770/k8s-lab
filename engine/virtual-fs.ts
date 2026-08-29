import YAML from "yaml";
import {
  ClusterState,
  Pod,
  ReplicaSet,
  Deployment,
  Service,
  ConfigMapResource,
  SecretResource,
  DaemonSet,
  StatefulSet,
  Job,
  CronJob,
  Namespace,
} from "./cluster-state";
import { DEFAULT_NODES, DEFAULT_VIRTUAL_FILES } from "./simulator";

export interface VirtualFile {
  name: string;
  content: string;
  updatedAt: number;
  size: number;
}

export const INITIAL_MANIFESTS: Record<string, string> = {
  "pod.yaml": `apiVersion: v1
kind: Pod
metadata:
  name: web-pod
  labels:
    app: web
    tier: frontend
spec:
  containers:
    - name: nginx-container
      image: nginx:latest
      ports:
        - containerPort: 80
      resources:
        limits:
          memory: "128Mi"
          cpu: "200m"
`,

  "deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deployment
  labels:
    app: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
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
  name: web-service
  labels:
    app: web
spec:
  type: ClusterIP
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP
`,

  "replicaset.yaml": `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: web-replicaset
  labels:
    app: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:latest
          ports:
            - containerPort: 80
`,

  "configmap.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_ENV: "production"
  LOG_LEVEL: "info"
  PORT: "8080"
  MAX_CONNECTIONS: "100"
`,

  "secret.yaml": `apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque
data:
  DB_PASSWORD: "c3VwZXJzZWNyZXQ="
  API_KEY: "ZGV2LWtleS0xMjM0NQ=="
`,

  "hpa.yaml": `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`,
};

// In-memory virtual file system store
const fileStore = new Map<string, VirtualFile>();

function initializeFiles() {
  if (fileStore.size === 0) {
    const now = Date.now();
    for (const [name, content] of Object.entries(INITIAL_MANIFESTS)) {
      fileStore.set(name, {
        name,
        content,
        updatedAt: now,
        size: new Blob([content]).size,
      });
    }
  }
}

export function getVirtualFile(name: string): VirtualFile | null {
  initializeFiles();
  return fileStore.get(name) || null;
}

export function saveVirtualFile(name: string, content: string): VirtualFile {
  initializeFiles();
  const file: VirtualFile = {
    name,
    content,
    updatedAt: Date.now(),
    size: new Blob([content]).size,
  };
  fileStore.set(name, file);
  return file;
}

export function deleteVirtualFile(name: string): boolean {
  initializeFiles();
  return fileStore.delete(name);
}

export function listVirtualFiles(): VirtualFile[] {
  initializeFiles();
  return Array.from(fileStore.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function resetVirtualFiles(): void {
  fileStore.clear();
  initializeFiles();
}

export function hasVirtualFile(name: string): boolean {
  initializeFiles();
  return fileStore.has(name);
}

export interface YamlApplyResult {
  newState: ClusterState;
  output: string;
  componentFlow: string[];
  actionDescription: string;
  success: boolean;
  resourceKind?: string;
  resourceName?: string;
}

/**
 * Parses and applies a YAML manifest string into the cluster state.
 */
export function applyYamlToCluster(
  yamlContent: string,
  state: ClusterState
): YamlApplyResult {
  const nextState: ClusterState = {
    nodes: [...(state.nodes && state.nodes.length > 0 ? state.nodes : DEFAULT_NODES)],
    pods: [...(state.pods || [])],
    replicaSets: [...(state.replicaSets || [])],
    deployments: [...(state.deployments || [])],
    daemonSets: [...(state.daemonSets || [])],
    statefulSets: [...(state.statefulSets || [])],
    jobs: [...(state.jobs || [])],
    cronJobs: [...(state.cronJobs || [])],
    services: [...(state.services || [])],
    namespaces: [...(state.namespaces || [])],
    configMaps: [...(state.configMaps || [])],
    secrets: [...(state.secrets || [])],
    files: { ...(state.files || DEFAULT_VIRTUAL_FILES) },
    lastActionImpact: state.lastActionImpact,
  };

  try {
    const doc = YAML.parse(yamlContent);
    if (!doc || typeof doc !== "object") {
      return {
        newState: state,
        output: "error: error parsing YAML: no valid object found in document",
        componentFlow: ["Terminal", "kube-apiserver"],
        actionDescription: "YAML validation failed at API Server.",
        success: false,
      };
    }

    const kind = String(doc.kind || "").trim();
    const metadata = doc.metadata || {};
    const name = String(metadata.name || "unnamed").trim();
    const spec = doc.spec || {};

    if (!kind) {
      return {
        newState: state,
        output: "error: Object 'kind' is missing in manifest",
        componentFlow: ["Terminal", "kube-apiserver"],
        actionDescription: "Schema validation failed: missing resource kind.",
        success: false,
      };
    }

    // 1. Pod
    if (kind.toLowerCase() === "pod") {
      const image =
        spec.containers?.[0]?.image ||
        spec.container?.image ||
        "nginx:latest";
      const existingIdx = nextState.pods.findIndex((p) => p.name === name);

      const podObj: Pod = {
        name,
        image,
        status: "Running",
        node: "worker-node-1",
        ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
        restarts: 0,
        age: "1s",
        labels: metadata.labels || {},
      };

      if (existingIdx >= 0) {
        nextState.pods[existingIdx] = {
          ...nextState.pods[existingIdx],
          image,
          labels: metadata.labels || nextState.pods[existingIdx].labels,
        };
        return {
          newState: nextState,
          output: `pod/${name} configured`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kubelet",
            "CRI",
          ],
          actionDescription: `API server updated Pod '${name}' in etcd → kubelet applied configuration changes.`,
          success: true,
          resourceKind: "pod",
          resourceName: name,
        };
      } else {
        nextState.pods.push(podObj);
        return {
          newState: nextState,
          output: `pod/${name} created`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-scheduler",
            "kubelet",
            "CRI",
          ],
          actionDescription: `Declarative apply: API Server persisted Pod '${name}' → Scheduler bound to worker-node-1 → CRI started container.`,
          success: true,
          resourceKind: "pod",
          resourceName: name,
        };
      }
    }

    // 2. Deployment
    if (kind.toLowerCase() === "deployment") {
      const replicas = parseInt(String(spec.replicas ?? 3), 10) || 1;
      const image =
        spec.template?.spec?.containers?.[0]?.image ||
        spec.containers?.[0]?.image ||
        "nginx:latest";
      const existingDep = nextState.deployments.find((d) => d.name === name);

      if (existingDep) {
        const isImageChanged = existingDep.image !== image;
        existingDep.replicas = replicas;
        existingDep.available = replicas;
        existingDep.upToDate = replicas;

        if (isImageChanged) {
          existingDep.revision += 1;
          existingDep.image = image;

          const oldRsName = `${name}-v${existingDep.revision - 1}`;
          const newRsName = `${name}-v${existingDep.revision}`;

          const oldRs = nextState.replicaSets.find((r) => r.name === oldRsName);
          if (oldRs) {
            oldRs.desiredReplicas = 0;
            oldRs.currentReplicas = 0;
            oldRs.readyReplicas = 0;
          }

          const newRs: ReplicaSet = {
            name: newRsName,
            desiredReplicas: replicas,
            currentReplicas: replicas,
            readyReplicas: replicas,
            image,
            ownerRef: { kind: "Deployment", name },
            age: "1s",
          };
          nextState.replicaSets.push(newRs);

          // Update Pods
          nextState.pods = nextState.pods.filter(
            (p) =>
              p.ownerRef?.kind !== "Deployment" && !p.name.startsWith(name)
          );
          for (let i = 0; i < replicas; i++) {
            nextState.pods.push({
              name: `${newRsName}-${Math.random().toString(36).substring(2, 7)}`,
              image,
              status: "Running",
              node: "worker-node-1",
              ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
              restarts: 0,
              ownerRef: { kind: "ReplicaSet", name: newRsName },
              age: "1s",
            });
          }
        }

        return {
          newState: nextState,
          output: `deployment.apps/${name} configured`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-controller-manager",
            "kube-scheduler",
            "kubelet",
          ],
          actionDescription: `Deployment Controller reconciled '${name}' to ${replicas} replicas (image: ${image}).`,
          success: true,
          resourceKind: "deployment",
          resourceName: name,
        };
      } else {
        const newDep: Deployment = {
          name,
          replicas,
          upToDate: replicas,
          available: replicas,
          image,
          revision: 1,
          age: "1s",
          labels: metadata.labels,
        };
        nextState.deployments.push(newDep);

        const rsName = `${name}-v1`;
        const newRs: ReplicaSet = {
          name: rsName,
          desiredReplicas: replicas,
          currentReplicas: replicas,
          readyReplicas: replicas,
          image,
          ownerRef: { kind: "Deployment", name },
          age: "1s",
        };
        nextState.replicaSets.push(newRs);

        for (let i = 0; i < replicas; i++) {
          nextState.pods.push({
            name: `${rsName}-${Math.random().toString(36).substring(2, 7)}`,
            image,
            status: "Running",
            node: "worker-node-1",
            ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
            restarts: 0,
            ownerRef: { kind: "ReplicaSet", name: rsName },
            age: "1s",
          });
        }

        return {
          newState: nextState,
          output: `deployment.apps/${name} created`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-controller-manager",
            "kube-scheduler",
            "kubelet",
          ],
          actionDescription: `Deployment Controller created Deployment '${name}' → spawned ReplicaSet '${rsName}' with ${replicas} pods.`,
          success: true,
          resourceKind: "deployment",
          resourceName: name,
        };
      }
    }

    // 3. ReplicaSet
    if (kind.toLowerCase() === "replicaset") {
      const replicas = parseInt(String(spec.replicas ?? 2), 10) || 1;
      const image =
        spec.template?.spec?.containers?.[0]?.image ||
        spec.containers?.[0]?.image ||
        "nginx:latest";
      const existingRs = nextState.replicaSets.find((r) => r.name === name);

      if (existingRs) {
        existingRs.desiredReplicas = replicas;
        existingRs.currentReplicas = replicas;
        existingRs.readyReplicas = replicas;
        return {
          newState: nextState,
          output: `replicaset.apps/${name} configured`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-controller-manager",
          ],
          actionDescription: `ReplicaSet Controller reconciled '${name}' desired count to ${replicas}.`,
          success: true,
          resourceKind: "replicaset",
          resourceName: name,
        };
      } else {
        const newRs: ReplicaSet = {
          name,
          desiredReplicas: replicas,
          currentReplicas: replicas,
          readyReplicas: replicas,
          image,
          age: "1s",
          labels: metadata.labels,
        };
        nextState.replicaSets.push(newRs);

        for (let i = 0; i < replicas; i++) {
          nextState.pods.push({
            name: `${name}-${Math.random().toString(36).substring(2, 7)}`,
            image,
            status: "Running",
            node: "worker-node-1",
            ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
            restarts: 0,
            ownerRef: { kind: "ReplicaSet", name },
            age: "1s",
          });
        }

        return {
          newState: nextState,
          output: `replicaset.apps/${name} created`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-controller-manager",
            "kube-scheduler",
            "kubelet",
          ],
          actionDescription: `ReplicaSet Controller spawned ${replicas} pods for '${name}'.`,
          success: true,
          resourceKind: "replicaset",
          resourceName: name,
        };
      }
    }

    // 4. Service
    if (kind.toLowerCase() === "service") {
      const type = spec.type || "ClusterIP";
      const ports = spec.ports || [{ port: 80, targetPort: 80, protocol: "TCP" }];
      const selector = spec.selector || {};

      const existingSvc = nextState.services.find((s) => s.name === name);
      if (existingSvc) {
        existingSvc.type = type;
        existingSvc.ports = ports;
        existingSvc.selector = selector;
        return {
          newState: nextState,
          output: `service/${name} configured`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-proxy",
          ],
          actionDescription: `kube-proxy updated routing rules and iptables endpoints for service '${name}'.`,
          success: true,
          resourceKind: "service",
          resourceName: name,
        };
      } else {
        const newSvc: Service = {
          name,
          type,
          clusterIP: `10.96.${Math.floor(Math.random() * 200) + 10}.${Math.floor(
            Math.random() * 200
          ) + 10}`,
          ports,
          selector,
          age: "1s",
        };
        nextState.services.push(newSvc);
        return {
          newState: nextState,
          output: `service/${name} created`,
          componentFlow: [
            "Terminal",
            "kube-apiserver",
            "etcd",
            "kube-proxy",
          ],
          actionDescription: `API Server allocated ClusterIP ${newSvc.clusterIP} → kube-proxy programmed service proxy rules.`,
          success: true,
          resourceKind: "service",
          resourceName: name,
        };
      }
    }

    // 5. ConfigMap
    if (kind.toLowerCase() === "configmap") {
      const data = doc.data || {};
      const existing = nextState.configMaps.find((c) => c.name === name);
      if (existing) {
        existing.data = data;
        return {
          newState: nextState,
          output: `configmap/${name} configured`,
          componentFlow: ["Terminal", "kube-apiserver", "etcd"],
          actionDescription: `API Server updated ConfigMap '${name}' data keys in etcd.`,
          success: true,
          resourceKind: "configmap",
          resourceName: name,
        };
      } else {
        nextState.configMaps.push({
          name,
          data,
          age: "1s",
        });
        return {
          newState: nextState,
          output: `configmap/${name} created`,
          componentFlow: ["Terminal", "kube-apiserver", "etcd"],
          actionDescription: `API Server stored ConfigMap '${name}' (${Object.keys(data).length} keys) in etcd.`,
          success: true,
          resourceKind: "configmap",
          resourceName: name,
        };
      }
    }

    // 6. Secret
    if (kind.toLowerCase() === "secret") {
      const type = doc.type || "Opaque";
      const data = doc.data || {};
      const existing = nextState.secrets.find((s) => s.name === name);
      if (existing) {
        existing.data = data;
        return {
          newState: nextState,
          output: `secret/${name} configured`,
          componentFlow: ["Terminal", "kube-apiserver", "etcd"],
          actionDescription: `API Server updated base64 Secret '${name}' in etcd.`,
          success: true,
          resourceKind: "secret",
          resourceName: name,
        };
      } else {
        nextState.secrets.push({
          name,
          type,
          data,
          dataKeys: Object.keys(data),
          age: "1s",
        });
        return {
          newState: nextState,
          output: `secret/${name} created`,
          componentFlow: ["Terminal", "kube-apiserver", "etcd"],
          actionDescription: `API Server securely stored base64 Secret '${name}' in etcd.`,
          success: true,
          resourceKind: "secret",
          resourceName: name,
        };
      }
    }

    // Other K8s kinds
    return {
      newState: nextState,
      output: `${kind.toLowerCase()}.${doc.apiVersion || "v1"}/${name} created (applied)`,
      componentFlow: ["Terminal", "kube-apiserver", "etcd"],
      actionDescription: `Resource '${kind}/${name}' accepted and persisted to etcd.`,
      success: true,
      resourceKind: kind.toLowerCase(),
      resourceName: name,
    };
  } catch (err: any) {
    return {
      newState: state,
      output: `error: YAML syntax error: ${err?.message || "Invalid format"}`,
      componentFlow: ["Terminal", "kube-apiserver"],
      actionDescription: "YAML parsing failed before API server validation.",
      success: false,
    };
  }
}

/**
 * Handles `kubectl delete -f <file>` by removing corresponding resources.
 */
export function deleteYamlFromCluster(
  yamlContent: string,
  state: ClusterState
): YamlApplyResult {
  const nextState: ClusterState = {
    nodes: [...(state.nodes && state.nodes.length > 0 ? state.nodes : DEFAULT_NODES)],
    pods: [...(state.pods || [])],
    replicaSets: [...(state.replicaSets || [])],
    deployments: [...(state.deployments || [])],
    daemonSets: [...(state.daemonSets || [])],
    statefulSets: [...(state.statefulSets || [])],
    jobs: [...(state.jobs || [])],
    cronJobs: [...(state.cronJobs || [])],
    services: [...(state.services || [])],
    namespaces: [...(state.namespaces || [])],
    configMaps: [...(state.configMaps || [])],
    secrets: [...(state.secrets || [])],
    files: { ...(state.files || DEFAULT_VIRTUAL_FILES) },
    lastActionImpact: state.lastActionImpact,
  };

  try {
    const doc = YAML.parse(yamlContent);
    if (!doc || typeof doc !== "object") {
      return {
        newState: state,
        output: "error: error parsing YAML for deletion",
        componentFlow: ["Terminal", "kube-apiserver"],
        actionDescription: "YAML parsing failed.",
        success: false,
      };
    }

    const kind = String(doc.kind || "").toLowerCase();
    const name = String(doc.metadata?.name || "").trim();

    if (kind === "pod") {
      nextState.pods = nextState.pods.filter((p) => p.name !== name);
      return {
        newState: nextState,
        output: `pod "${name}" deleted`,
        componentFlow: ["Terminal", "kube-apiserver", "etcd", "kubelet"],
        actionDescription: `Pod '${name}' deleted from cluster.`,
        success: true,
        resourceKind: "pod",
        resourceName: name,
      };
    } else if (kind === "deployment") {
      nextState.deployments = nextState.deployments.filter((d) => d.name !== name);
      nextState.replicaSets = nextState.replicaSets.filter(
        (rs) => rs.ownerRef?.name !== name && !rs.name.startsWith(name)
      );
      nextState.pods = nextState.pods.filter(
        (p) => p.ownerRef?.name !== name && !p.name.startsWith(name)
      );
      return {
        newState: nextState,
        output: `deployment.apps "${name}" deleted`,
        componentFlow: [
          "Terminal",
          "kube-apiserver",
          "etcd",
          "kube-controller-manager",
          "kubelet",
        ],
        actionDescription: `Deployment '${name}' and all associated ReplicaSets and Pods deleted.`,
        success: true,
        resourceKind: "deployment",
        resourceName: name,
      };
    } else if (kind === "replicaset") {
      nextState.replicaSets = nextState.replicaSets.filter((rs) => rs.name !== name);
      nextState.pods = nextState.pods.filter((p) => p.ownerRef?.name !== name);
      return {
        newState: nextState,
        output: `replicaset.apps "${name}" deleted`,
        componentFlow: [
          "Terminal",
          "kube-apiserver",
          "etcd",
          "kube-controller-manager",
        ],
        actionDescription: `ReplicaSet '${name}' and its managed pods deleted.`,
        success: true,
        resourceKind: "replicaset",
        resourceName: name,
      };
    } else if (kind === "service") {
      nextState.services = nextState.services.filter((s) => s.name !== name);
      return {
        newState: nextState,
        output: `service "${name}" deleted`,
        componentFlow: ["Terminal", "kube-apiserver", "etcd", "kube-proxy"],
        actionDescription: `Service '${name}' and its proxy routes removed.`,
        success: true,
        resourceKind: "service",
        resourceName: name,
      };
    } else if (kind === "configmap") {
      nextState.configMaps = nextState.configMaps.filter((c) => c.name !== name);
      return {
        newState: nextState,
        output: `configmap "${name}" deleted`,
        componentFlow: ["Terminal", "kube-apiserver", "etcd"],
        actionDescription: `ConfigMap '${name}' removed.`,
        success: true,
        resourceKind: "configmap",
        resourceName: name,
      };
    } else if (kind === "secret") {
      nextState.secrets = nextState.secrets.filter((s) => s.name !== name);
      return {
        newState: nextState,
        output: `secret "${name}" deleted`,
        componentFlow: ["Terminal", "kube-apiserver", "etcd"],
        actionDescription: `Secret '${name}' removed.`,
        success: true,
        resourceKind: "secret",
        resourceName: name,
      };
    }

    return {
      newState: nextState,
      output: `resource "${name}" deleted`,
      componentFlow: ["Terminal", "kube-apiserver", "etcd"],
      actionDescription: `Resource '${name}' deleted.`,
      success: true,
    };
  } catch (err: any) {
    return {
      newState: state,
      output: `error deleting resource: ${err?.message || "Invalid YAML"}`,
      componentFlow: ["Terminal", "kube-apiserver"],
      actionDescription: "YAML deletion error.",
      success: false,
    };
  }
}
