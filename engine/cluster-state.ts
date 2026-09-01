import type {
  ClusterEvent,
  ClusterNode,
  ClusterState,
  ConfigMap,
  CronJob,
  DaemonSet,
  Deployment,
  Ingress,
  Job,
  Labels,
  PersistentVolume,
  PersistentVolumeClaim,
  Pod,
  PodTemplate,
  ProbeKind,
  ReplicaSet,
  Secret,
  Service,
  StatefulSet,
  StorageClass,
  Taint,
  Toleration,
} from "./types";

/**
 * A deterministic, in-browser Kubernetes cluster.
 *
 * Nothing real runs here. The goal is to reproduce the *causal* behaviour of
 * the control loops — controllers closing the gap between desired and observed
 * state — so a learner can watch cause and effect instead of reading about it.
 */

/** Images this fake registry can pull. Anything else fails, on purpose. */
export const REGISTRY = new Set([
  "nginx:1.21",
  "nginx:1.22",
  "nginx:1.23",
  "nginx:1.25",
  "nginx:alpine",
  "nginx:latest",
  "httpd:2.4",
  "redis:7",
  "postgres:16",
  "mysql:8",
  "busybox:1.36",
  "busybox:latest",
  "alpine:3.19",
  "fluentd:1.16",
  "node-exporter:1.7",
  "backup:1.0",
  "report-generator:2.1",
]);

/** HTTP paths the simulated containers actually serve. */
export const SERVED_PATHS = new Set(["/", "/index.html", "/healthz", "/ready"]);

const SUFFIX_ALPHABET = "bcdfghjklmnpqrstvwxz2456789";

export function createCluster(workers = ["worker-1", "worker-2"]): ClusterState {
  const nodes: ClusterNode[] = [
    {
      name: "control-plane",
      role: "control-plane",
      labels: { "kubernetes.io/hostname": "control-plane" },
      taints: [
        { key: "node-role.kubernetes.io/control-plane", value: "", effect: "NoSchedule" },
      ],
      ready: true,
    },
    ...workers.map<ClusterNode>((name) => ({
      name,
      role: "worker",
      labels: { "kubernetes.io/hostname": name },
      taints: [],
      ready: true,
    })),
  ];

  return {
    nodes,
    pods: [],
    replicaSets: [],
    deployments: [],
    daemonSets: [],
    statefulSets: [],
    jobs: [],
    cronJobs: [],
    services: [],
    ingresses: [],
    configMaps: [],
    secrets: [],
    storageClasses: [],
    persistentVolumes: [],
    persistentVolumeClaims: [],
    events: [],
    seq: 1,
    clock: 0,
  };
}

export function nextId(state: ClusterState): number {
  return state.seq++;
}

export function suffix(state: ClusterState, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const value = (nextId(state) * 7919 + i * 104729) % SUFFIX_ALPHABET.length;
    out += SUFFIX_ALPHABET[value];
  }
  return out;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function templateHash(template: PodTemplate): string {
  const source = stableStringify(template);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 9);
}

export function recordEvent(
  state: ClusterState,
  type: ClusterEvent["type"],
  reason: string,
  object: string,
  message: string,
): void {
  state.events.push({ id: nextId(state), at: state.clock, type, reason, object, message });
  if (state.events.length > 80) state.events.shift();
}

export function matchesSelector(labels: Labels, selector: Labels): boolean {
  const entries = Object.entries(selector);
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => labels[key] === value);
}

export function formatAge(ticks: number): string {
  const seconds = ticks * 5;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function livePods(state: ClusterState, ownerName: string): Pod[] {
  return state.pods.filter(
    (pod) => pod.ownerName === ownerName && pod.phase !== "Terminating",
  );
}

export function podsOf(state: ClusterState, owner: { name: string }): Pod[] {
  return livePods(state, owner.name);
}

export function replicaSetsOf(state: ClusterState, deployment: Deployment): ReplicaSet[] {
  return state.replicaSets
    .filter((rs) => rs.ownerName === deployment.name)
    .sort((a, b) => a.revision - b.revision);
}

export function isReady(pod: Pod): boolean {
  return pod.phase === "Running" && pod.ready;
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

export function tolerates(tolerations: Toleration[] | undefined, taint: Taint): boolean {
  return (tolerations ?? []).some((toleration) => {
    if (toleration.key !== taint.key) return false;
    if (toleration.effect && toleration.effect !== taint.effect) return false;
    if (toleration.operator === "Exists") return true;
    return (toleration.value ?? "") === taint.value;
  });
}

export function nodeFits(node: ClusterNode, template: PodTemplate): boolean {
  if (!node.ready) return false;

  for (const taint of node.taints) {
    if (!tolerates(template.tolerations, taint)) return false;
  }
  for (const [key, value] of Object.entries(template.nodeSelector ?? {})) {
    if (node.labels[key] !== value) return false;
  }
  for (const rule of template.affinity ?? []) {
    if (rule.preferred) continue;
    const actual = node.labels[rule.key];
    if (rule.operator === "Exists" && actual === undefined) return false;
    if (rule.operator === "In" && !(rule.values ?? []).includes(actual)) return false;
    if (rule.operator === "NotIn" && (rule.values ?? []).includes(actual)) return false;
  }
  return true;
}

function scoreNode(state: ClusterState, node: ClusterNode, template: PodTemplate): number {
  const load = state.pods.filter((pod) => pod.node === node.name).length;
  const preferred = (template.affinity ?? []).filter((rule) => rule.preferred);
  const bonus = preferred.some((rule) => (rule.values ?? []).includes(node.labels[rule.key]))
    ? 100
    : 0;
  return bonus - load;
}

function schedule(state: ClusterState, pod: Pod): void {
  const candidates = state.nodes.filter((node) => nodeFits(node, pod.template));
  if (candidates.length === 0) {
    pod.node = null;
    pod.phase = "Pending";
    pod.reason = "Unschedulable";
    return;
  }
  const best = candidates.reduce((a, b) =>
    scoreNode(state, b, pod.template) > scoreNode(state, a, pod.template) ? b : a,
  );
  pod.node = best.name;
  const index = state.nodes.indexOf(best);
  pod.ip = `10.244.${index}.${(nextId(state) % 200) + 10}`;
  pod.reason = undefined;
  recordEvent(state, "Normal", "Scheduled", `pod/${pod.name}`, `Assigned to ${best.name}`);
}

/* ------------------------------------------------------------------ */
/* Object creation                                                     */
/* ------------------------------------------------------------------ */

export function createPod(
  state: ClusterState,
  input: {
    name?: string;
    template: PodTemplate;
    owner?: { kind: Pod["ownerKind"]; name: string };
    ordinal?: number;
  },
): Pod {
  const generated = `${input.owner?.name ?? "pod"}-${suffix(state, 5)}`;
  const pod: Pod = {
    uid: `pod-${nextId(state)}`,
    name: input.name ?? generated,
    template: structuredClone(input.template),
    image: input.template.image,
    labels: { ...input.template.labels },
    phase: "Pending",
    ready: false,
    node: null,
    ip: "<none>",
    restarts: 0,
    age: 0,
    files: {},
    logs: [],
    ownerKind: input.owner?.kind,
    ownerName: input.owner?.name,
    ordinal: input.ordinal,
    runtime: 0,
  };
  state.pods.push(pod);
  schedule(state, pod);
  return pod;
}

export function createReplicaSet(
  state: ClusterState,
  input: {
    name: string;
    replicas: number;
    template: PodTemplate;
    selector: Labels;
    revision?: number;
    owner?: Deployment;
  },
): ReplicaSet {
  const rs: ReplicaSet = {
    uid: `rs-${nextId(state)}`,
    name: input.name,
    replicas: input.replicas,
    template: structuredClone(input.template),
    podTemplateHash: templateHash(input.template),
    selector: { ...input.selector },
    revision: input.revision ?? 1,
    age: 0,
    ownerKind: input.owner ? "Deployment" : undefined,
    ownerName: input.owner?.name,
  };
  state.replicaSets.push(rs);
  return rs;
}

export function createDeployment(
  state: ClusterState,
  input: { name: string; replicas: number; template: PodTemplate; selector?: Labels },
): Deployment {
  const selector = input.selector ?? { app: input.name };
  const template = structuredClone(input.template);
  template.labels = { ...selector, ...template.labels };

  const deployment: Deployment = {
    uid: `deploy-${nextId(state)}`,
    name: input.name,
    replicas: input.replicas,
    template,
    selector,
    revision: 1,
    history: [
      {
        revision: 1,
        image: template.image,
        changeCause: `kubectl create deployment ${input.name} --image=${template.image}`,
        template: structuredClone(template),
      },
    ],
    age: 0,
  };
  state.deployments.push(deployment);
  recordEvent(
    state,
    "Normal",
    "ScalingReplicaSet",
    `deployment/${deployment.name}`,
    `Created deployment with ${input.replicas} replica(s)`,
  );
  return deployment;
}

export function createService(
  state: ClusterState,
  input: {
    name: string;
    type?: Service["type"];
    selector: Labels;
    port: number;
    targetPort?: number;
    nodePort?: number;
    headless?: boolean;
    externalName?: string;
  },
): Service {
  const service: Service = {
    uid: `svc-${nextId(state)}`,
    name: input.name,
    type: input.type ?? "ClusterIP",
    selector: { ...input.selector },
    port: input.port,
    targetPort: input.targetPort ?? input.port,
    nodePort:
      input.type === "NodePort" || input.type === "LoadBalancer"
        ? (input.nodePort ?? 30000 + (nextId(state) % 2000))
        : undefined,
    clusterIP: input.headless ? "None" : `10.96.0.${(nextId(state) % 200) + 10}`,
    externalIP: input.type === "LoadBalancer" ? "203.0.113.10" : undefined,
    externalName: input.externalName,
    headless: Boolean(input.headless),
    age: 0,
  };
  state.services.push(service);
  return service;
}

export function endpointsOf(state: ClusterState, service: Service): Pod[] {
  if (Object.keys(service.selector).length === 0) return [];
  return state.pods.filter(
    (pod) =>
      pod.phase !== "Terminating" &&
      matchesSelector(pod.labels, service.selector) &&
      isReady(pod),
  );
}

/* ------------------------------------------------------------------ */
/* Volumes                                                             */
/* ------------------------------------------------------------------ */

export interface ResolvedMount {
  volume: NonNullable<PodTemplate["volumes"]>[number];
  mountPath: string;
  relative: string;
}

export function resolveMount(pod: Pod, path: string): ResolvedMount | undefined {
  for (const mount of pod.template.mounts ?? []) {
    if (path === mount.mountPath || path.startsWith(`${mount.mountPath}/`)) {
      const volume = (pod.template.volumes ?? []).find((item) => item.name === mount.name);
      if (!volume) continue;
      return {
        volume,
        mountPath: mount.mountPath,
        relative: path.slice(mount.mountPath.length).replace(/^\//, ""),
      };
    }
  }
  return undefined;
}

export function readPath(
  state: ClusterState,
  pod: Pod,
  path: string,
): { ok: true; content: string } | { ok: false; error: string } {
  const mount = resolveMount(pod, path);
  if (!mount) {
    const content = pod.files[path];
    if (content === undefined) return { ok: false, error: `${path}: No such file or directory` };
    return { ok: true, content };
  }

  if (mount.volume.kind === "persistentVolumeClaim") {
    const claim = state.persistentVolumeClaims.find(
      (item) => item.name === mount.volume.source,
    );
    const content = claim?.data[mount.relative];
    if (content === undefined) return { ok: false, error: `${path}: No such file or directory` };
    return { ok: true, content };
  }
  if (mount.volume.kind === "configMap") {
    const configMap = state.configMaps.find((item) => item.name === mount.volume.source);
    const content = configMap?.data[mount.relative];
    if (content === undefined) return { ok: false, error: `${path}: No such file or directory` };
    return { ok: true, content };
  }
  if (mount.volume.kind === "secret") {
    const secret = state.secrets.find((item) => item.name === mount.volume.source);
    const content = secret?.data[mount.relative];
    if (content === undefined) return { ok: false, error: `${path}: No such file or directory` };
    return { ok: true, content };
  }

  const content = pod.files[path];
  if (content === undefined) return { ok: false, error: `${path}: No such file or directory` };
  return { ok: true, content };
}

export function writePath(
  state: ClusterState,
  pod: Pod,
  path: string,
  content: string,
): { ok: true } | { ok: false; error: string } {
  const mount = resolveMount(pod, path);
  if (mount?.volume.kind === "configMap" || mount?.volume.kind === "secret") {
    return { ok: false, error: `${path}: Read-only file system` };
  }
  if (mount?.volume.kind === "persistentVolumeClaim") {
    const claim = state.persistentVolumeClaims.find(
      (item) => item.name === mount.volume.source,
    );
    if (!claim) return { ok: false, error: `${path}: volume is not attached` };
    claim.data[mount.relative] = content;
    return { ok: true };
  }
  pod.files[path] = content;
  return { ok: true };
}

export function listPath(state: ClusterState, pod: Pod, path: string): string[] {
  const mount = resolveMount(pod, path);
  if (mount?.volume.kind === "persistentVolumeClaim") {
    const claim = state.persistentVolumeClaims.find((item) => item.name === mount.volume.source);
    return Object.keys(claim?.data ?? {}).sort();
  }
  if (mount?.volume.kind === "configMap") {
    const configMap = state.configMaps.find((item) => item.name === mount.volume.source);
    return Object.keys(configMap?.data ?? {}).sort();
  }
  if (mount?.volume.kind === "secret") {
    const secret = state.secrets.find((item) => item.name === mount.volume.source);
    return Object.keys(secret?.data ?? {}).sort();
  }
  const prefix = path.endsWith("/") ? path : `${path}/`;
  return Object.keys(pod.files)
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    .sort();
}

export function podEnv(state: ClusterState, pod: Pod): Record<string, string> {
  const env: Record<string, string> = {
    HOSTNAME: pod.name,
    KUBERNETES_SERVICE_HOST: "10.96.0.1",
    ...(pod.template.env ?? {}),
  };
  if (pod.envSnapshot) return { ...env, ...pod.envSnapshot };
  return { ...env, ...resolveEnvFrom(state, pod) };
}

function resolveEnvFrom(state: ClusterState, pod: Pod): Record<string, string> {
  const env: Record<string, string> = {};
  for (const ref of pod.template.envFrom ?? []) {
    if (ref.kind === "configMap") {
      const configMap = state.configMaps.find((item) => item.name === ref.name);
      Object.assign(env, configMap?.data ?? {});
    } else {
      const secret = state.secrets.find((item) => item.name === ref.name);
      for (const [key, value] of Object.entries(secret?.data ?? {})) {
        env[key.toUpperCase().replace(/[-.]/g, "_")] = value;
      }
    }
  }
  return env;
}

/** Missing ConfigMap/Secret/PVC references keep a Pod out of Running. */
function configError(state: ClusterState, pod: Pod): string | undefined {
  for (const ref of pod.template.envFrom ?? []) {
    const found =
      ref.kind === "configMap"
        ? state.configMaps.some((item) => item.name === ref.name)
        : state.secrets.some((item) => item.name === ref.name);
    if (!found) return `CreateContainerConfigError: ${ref.kind} "${ref.name}" not found`;
  }
  for (const volume of pod.template.volumes ?? []) {
    if (volume.kind === "configMap" && !state.configMaps.some((i) => i.name === volume.source)) {
      return `CreateContainerConfigError: configMap "${volume.source}" not found`;
    }
    if (volume.kind === "secret" && !state.secrets.some((i) => i.name === volume.source)) {
      return `CreateContainerConfigError: secret "${volume.source}" not found`;
    }
    if (volume.kind === "persistentVolumeClaim") {
      const claim = state.persistentVolumeClaims.find((i) => i.name === volume.source);
      if (!claim) return `Unschedulable: persistentvolumeclaim "${volume.source}" not found`;
      if (claim.status !== "Bound") {
        return `Unschedulable: waiting for PersistentVolumeClaim "${claim.name}" to bind`;
      }
    }
  }
  return undefined;
}

function probeOf(pod: Pod, kind: ProbeKind) {
  return (pod.template.probes ?? []).find((probe) => probe.kind === kind);
}

/* ------------------------------------------------------------------ */
/* Control loops                                                       */
/* ------------------------------------------------------------------ */

function kubelet(state: ClusterState): void {
  for (const pod of [...state.pods]) {
    pod.age++;

    if (pod.phase === "Terminating") {
      state.pods = state.pods.filter((candidate) => candidate.uid !== pod.uid);
      continue;
    }
    if (pod.phase === "Completed" || pod.phase === "Failed") continue;

    if (!pod.node) {
      schedule(state, pod);
      if (!pod.node) continue;
    }

    const blocked = configError(state, pod);
    if (blocked) {
      pod.phase = "Pending";
      pod.ready = false;
      pod.reason = blocked;
      continue;
    }
    if (pod.reason?.startsWith("CreateContainerConfigError") || pod.reason === "Unschedulable") {
      pod.reason = undefined;
      pod.phase = "ContainerCreating";
    }

    if (pod.phase === "Pending") {
      pod.phase = "ContainerCreating";
      continue;
    }

    if (pod.phase === "ContainerCreating") {
      if (!REGISTRY.has(pod.image)) {
        pod.phase = "ImagePullBackOff";
        pod.reason = `Failed to pull image "${pod.image}": not found in registry`;
        recordEvent(state, "Warning", "Failed", `pod/${pod.name}`, pod.reason);
        continue;
      }
      const startup = probeOf(pod, "startup");
      if (startup && !SERVED_PATHS.has(startup.path)) {
        pod.restarts++;
        pod.reason = `Startup probe failed: HTTP 404 on ${startup.path}`;
        if (pod.restarts >= 3) {
          pod.phase = "CrashLoopBackOff";
          recordEvent(state, "Warning", "Unhealthy", `pod/${pod.name}`, pod.reason);
        }
        continue;
      }
      pod.phase = "Running";
      pod.reason = undefined;
      pod.envSnapshot = resolveEnvFrom(state, pod);
      pod.logs.push(`${pod.name} started, serving on :80`);
    }

    if (pod.phase === "Running") {
      if (pod.template.failing) {
        pod.runtime++;
        if (pod.runtime >= (pod.template.runFor ?? 2)) {
          pod.phase = pod.template.restartPolicy === "Never" ? "Failed" : "CrashLoopBackOff";
          pod.ready = false;
          pod.reason = "Container exited with code 1";
          pod.logs.push("error: task failed");
          continue;
        }
      } else if (pod.template.runFor) {
        pod.runtime++;
        if (pod.runtime >= pod.template.runFor) {
          pod.phase = "Completed";
          pod.ready = false;
          pod.logs.push("work finished, exiting 0");
          continue;
        }
      }

      const liveness = probeOf(pod, "liveness");
      if (liveness && !SERVED_PATHS.has(liveness.path)) {
        pod.restarts++;
        pod.ready = false;
        pod.reason = `Liveness probe failed: HTTP 404 on ${liveness.path}`;
        if (pod.restarts >= 3) {
          pod.phase = "CrashLoopBackOff";
          recordEvent(state, "Warning", "Unhealthy", `pod/${pod.name}`, pod.reason);
        } else {
          pod.phase = "ContainerCreating";
          recordEvent(state, "Warning", "Unhealthy", `pod/${pod.name}`, pod.reason);
        }
        continue;
      }

      const readiness = probeOf(pod, "readiness");
      if (readiness && !SERVED_PATHS.has(readiness.path)) {
        pod.ready = false;
        pod.reason = `Readiness probe failed: HTTP 404 on ${readiness.path}`;
      } else {
        pod.ready = true;
        pod.reason = undefined;
      }
    }
  }
}

function deploymentController(state: ClusterState): void {
  for (const deployment of state.deployments) {
    const owned = replicaSetsOf(state, deployment);
    const wantedHash = templateHash(deployment.template);
    const current = owned.find((rs) => rs.podTemplateHash === wantedHash);

    if (!current) {
      const rs = createReplicaSet(state, {
        name: `${deployment.name}-${wantedHash.slice(0, 6)}`,
        replicas: 0,
        template: deployment.template,
        selector: { ...deployment.selector, "pod-template-hash": wantedHash.slice(0, 6) },
        revision: deployment.revision,
        owner: deployment,
      });
      rs.template.labels = {
        ...deployment.template.labels,
        "pod-template-hash": wantedHash.slice(0, 6),
      };
      recordEvent(
        state,
        "Normal",
        "ScalingReplicaSet",
        `deployment/${deployment.name}`,
        `Created new ReplicaSet ${rs.name}`,
      );
      continue;
    }

    current.revision = deployment.revision;
    const older = owned.filter((rs) => rs !== current);
    const total = owned.reduce((sum, rs) => sum + rs.replicas, 0);
    const currentReady = podsOf(state, current).filter(isReady).length;

    if (current.replicas < deployment.replicas && total < deployment.replicas + 1) {
      current.replicas++;
      recordEvent(
        state,
        "Normal",
        "ScalingReplicaSet",
        `deployment/${deployment.name}`,
        `Scaled up replica set ${current.name} to ${current.replicas}`,
      );
      continue;
    }
    if (current.replicas > deployment.replicas) {
      current.replicas--;
      continue;
    }

    // An old Pod is only retired once the new Pods are actually serving.
    if (currentReady >= current.replicas) {
      const victim = older.find((rs) => rs.replicas > 0);
      if (victim) {
        victim.replicas--;
        recordEvent(
          state,
          "Normal",
          "ScalingReplicaSet",
          `deployment/${deployment.name}`,
          `Scaled down replica set ${victim.name} to ${victim.replicas}`,
        );
      }
    }
  }
}

function replicaSetController(state: ClusterState): void {
  for (const rs of state.replicaSets) {
    const owned = podsOf(state, rs);
    if (owned.length < rs.replicas) {
      const pod = createPod(state, {
        template: rs.template,
        owner: { kind: "ReplicaSet", name: rs.name },
      });
      recordEvent(
        state,
        "Normal",
        "SuccessfulCreate",
        `replicaset/${rs.name}`,
        `Created pod ${pod.name} (desired ${rs.replicas}, had ${owned.length})`,
      );
    } else if (owned.length > rs.replicas) {
      const victim = owned[owned.length - 1];
      victim.phase = "Terminating";
      recordEvent(
        state,
        "Normal",
        "SuccessfulDelete",
        `replicaset/${rs.name}`,
        `Deleted pod ${victim.name} (desired ${rs.replicas}, had ${owned.length})`,
      );
    }
  }
}

function daemonSetController(state: ClusterState): void {
  for (const daemonSet of state.daemonSets) {
    const owned = podsOf(state, daemonSet);
    const eligible = state.nodes.filter((node) => nodeFits(node, daemonSet.template));

    for (const node of eligible) {
      if (owned.some((pod) => pod.node === node.name)) continue;
      const pod = createPod(state, {
        name: `${daemonSet.name}-${suffix(state, 5)}`,
        template: daemonSet.template,
        owner: { kind: "DaemonSet", name: daemonSet.name },
      });
      pod.node = node.name;
      pod.ip = `10.244.${state.nodes.indexOf(node)}.${(nextId(state) % 200) + 10}`;
      pod.reason = undefined;
      recordEvent(
        state,
        "Normal",
        "SuccessfulCreate",
        `daemonset/${daemonSet.name}`,
        `Created pod ${pod.name} on ${node.name}`,
      );
    }

    for (const pod of owned) {
      if (!eligible.some((node) => node.name === pod.node)) {
        pod.phase = "Terminating";
        recordEvent(
          state,
          "Normal",
          "SuccessfulDelete",
          `daemonset/${daemonSet.name}`,
          `Evicted ${pod.name}: ${pod.node} no longer eligible`,
        );
      }
    }
  }
}

function statefulSetController(state: ClusterState): void {
  for (const set of state.statefulSets) {
    const owned = podsOf(state, set).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

    for (let ordinal = 0; ordinal < set.replicas; ordinal++) {
      const name = `${set.name}-${ordinal}`;
      if (owned.some((pod) => pod.name === name)) continue;

      // Ordered start-up: only create ordinal N once N-1 is Ready.
      const previous = ordinal === 0 ? undefined : owned.find((pod) => pod.ordinal === ordinal - 1);
      if (ordinal > 0 && (!previous || !isReady(previous))) break;

      const template = structuredClone(set.template);
      if (set.volumeClaimTemplate) {
        const claimName = `${set.volumeClaimTemplate.name}-${name}`;
        if (!state.persistentVolumeClaims.some((claim) => claim.name === claimName)) {
          createPersistentVolumeClaim(state, {
            name: claimName,
            requestGi: set.volumeClaimTemplate.requestGi,
            accessModes: ["ReadWriteOnce"],
            storageClass: set.volumeClaimTemplate.storageClass,
          });
        }
        template.volumes = [
          ...(template.volumes ?? []),
          {
            name: set.volumeClaimTemplate.name,
            kind: "persistentVolumeClaim",
            source: claimName,
          },
        ];
      }

      createPod(state, {
        name,
        template,
        owner: { kind: "StatefulSet", name: set.name },
        ordinal,
      });
      recordEvent(
        state,
        "Normal",
        "SuccessfulCreate",
        `statefulset/${set.name}`,
        `Created pod ${name} in order`,
      );
      break;
    }

    for (const pod of owned) {
      if ((pod.ordinal ?? 0) >= set.replicas) {
        pod.phase = "Terminating";
      }
    }
  }
}

function jobController(state: ClusterState): void {
  for (const job of state.jobs) {
    const owned = state.pods.filter((pod) => pod.ownerName === job.name);
    job.succeeded = owned.filter((pod) => pod.phase === "Completed").length;
    job.failed = owned.filter((pod) => pod.phase === "Failed").length;

    if (job.succeeded >= job.completions) continue;
    if (job.failed > job.backoffLimit) continue;

    const active = owned.filter(
      (pod) => pod.phase !== "Completed" && pod.phase !== "Failed" && pod.phase !== "Terminating",
    ).length;
    const remaining = job.completions - job.succeeded - active;
    if (active < job.parallelism && remaining > 0) {
      const template = structuredClone(job.template);
      template.restartPolicy = template.restartPolicy ?? "Never";
      template.runFor = template.runFor ?? 3;
      createPod(state, {
        name: `${job.name}-${suffix(state, 5)}`,
        template,
        owner: { kind: "Job", name: job.name },
      });
    }
  }
}

function cronJobController(state: ClusterState): void {
  for (const cronJob of state.cronJobs) {
    if (cronJob.suspend) continue;
    const last = cronJob.lastScheduleAt ?? -cronJob.intervalTicks;
    if (state.clock - last < cronJob.intervalTicks) continue;

    cronJob.lastScheduleAt = state.clock;
    const job = createJob(state, {
      name: `${cronJob.name}-${28000000 + state.clock}`,
      template: cronJob.template,
      completions: 1,
      parallelism: 1,
    });
    job.ownerKind = "CronJob";
    job.ownerName = cronJob.name;
    recordEvent(
      state,
      "Normal",
      "SuccessfulCreate",
      `cronjob/${cronJob.name}`,
      `Created job ${job.name}`,
    );

    const history = state.jobs.filter((item) => item.ownerName === cronJob.name);
    while (history.length > 3) {
      const oldest = history.shift();
      if (!oldest) break;
      state.pods = state.pods.filter((pod) => pod.ownerName !== oldest.name);
      state.jobs = state.jobs.filter((item) => item !== oldest);
    }
  }
}

function storageController(state: ClusterState): void {
  for (const claim of state.persistentVolumeClaims) {
    if (claim.status === "Bound") continue;

    const className =
      claim.storageClass ?? state.storageClasses.find((sc) => sc.isDefault)?.name;
    const volume = state.persistentVolumes.find(
      (candidate) =>
        candidate.status === "Available" &&
        candidate.capacityGi >= claim.requestGi &&
        claim.accessModes.every((mode) => candidate.accessModes.includes(mode)) &&
        (className === undefined || candidate.storageClass === className),
    );

    if (volume) {
      volume.status = "Bound";
      volume.claim = claim.name;
      claim.status = "Bound";
      claim.volumeName = volume.name;
      claim.reason = undefined;
      recordEvent(
        state,
        "Normal",
        "Bound",
        `persistentvolumeclaim/${claim.name}`,
        `Bound to ${volume.name}`,
      );
      continue;
    }

    const storageClass = state.storageClasses.find((sc) => sc.name === className);
    if (storageClass && storageClass.provisioner !== "kubernetes.io/no-provisioner") {
      const provisioned = createPersistentVolume(state, {
        name: `pvc-${suffix(state, 8)}`,
        capacityGi: claim.requestGi,
        accessModes: claim.accessModes,
        storageClass: storageClass.name,
      });
      provisioned.status = "Bound";
      provisioned.claim = claim.name;
      claim.status = "Bound";
      claim.volumeName = provisioned.name;
      claim.reason = undefined;
      recordEvent(
        state,
        "Normal",
        "ProvisioningSucceeded",
        `persistentvolumeclaim/${claim.name}`,
        `Dynamically provisioned ${provisioned.name} via ${storageClass.provisioner}`,
      );
      continue;
    }

    claim.reason = className
      ? `no volumes available for storage class "${className}"`
      : "no persistent volumes available and no default storage class";
    if (state.clock % 4 === 0) {
      recordEvent(
        state,
        "Warning",
        "FailedBinding",
        `persistentvolumeclaim/${claim.name}`,
        claim.reason,
      );
    }
  }
}

function networkController(state: ClusterState): void {
  for (const ingress of state.ingresses) {
    if (!ingress.address) ingress.address = "203.0.113.20";
  }
}

export interface TickOptions {
  /** Suppress CronJob firing while fast-forwarding a lesson's initial state. */
  suppressCron?: boolean;
}

export function tick(state: ClusterState, options: TickOptions = {}): void {
  state.clock++;
  kubelet(state);
  deploymentController(state);
  replicaSetController(state);
  daemonSetController(state);
  statefulSetController(state);
  jobController(state);
  if (!options.suppressCron) cronJobController(state);
  storageController(state);
  networkController(state);

  for (const item of [
    ...state.replicaSets,
    ...state.deployments,
    ...state.daemonSets,
    ...state.statefulSets,
    ...state.jobs,
    ...state.cronJobs,
    ...state.services,
    ...state.ingresses,
    ...state.configMaps,
    ...state.secrets,
    ...state.storageClasses,
    ...state.persistentVolumes,
    ...state.persistentVolumeClaims,
  ]) {
    item.age++;
  }
}

function fingerprint(state: ClusterState): string {
  const pods = state.pods
    .map(
      (pod) =>
        `${pod.name}:${pod.phase}:${pod.ready}:${pod.image}:${pod.node}:${pod.restarts}:${pod.reason ?? ""}`,
    )
    .sort()
    .join("|");
  const sets = state.replicaSets
    .map((rs) => `${rs.name}:${rs.replicas}:${rs.revision}`)
    .sort()
    .join("|");
  const workloads = [
    ...state.deployments.map((d) => `d${d.name}:${d.replicas}:${templateHash(d.template)}`),
    ...state.statefulSets.map((s) => `s${s.name}:${s.replicas}`),
    ...state.daemonSets.map((d) => `ds${d.name}`),
    ...state.jobs.map((j) => `j${j.name}:${j.succeeded}:${j.failed}`),
  ]
    .sort()
    .join("|");
  const storage = state.persistentVolumeClaims
    .map((claim) => `${claim.name}:${claim.status}`)
    .sort()
    .join("|");
  const network = state.ingresses.map((ing) => `${ing.name}:${ing.address ?? "-"}`).join("|");
  return [pods, sets, workloads, storage, network].join("//");
}

/** True when no further ticks would change anything the learner can see. */
export function isSettled(state: ClusterState): boolean {
  if (state.cronJobs.some((cronJob) => !cronJob.suspend)) return false;
  const probe = structuredClone(state);
  const before = fingerprint(probe);
  tick(probe, { suppressCron: true });
  return fingerprint(probe) === before;
}

export function clone(state: ClusterState): ClusterState {
  return structuredClone(state);
}

/** Run the control loops until the cluster stops changing (bounded). */
export function settle(state: ClusterState, maxTicks = 60): void {
  for (let i = 0; i < maxTicks; i++) {
    const before = fingerprint(state);
    tick(state, { suppressCron: true });
    if (fingerprint(state) === before) return;
  }
}

/* ------------------------------------------------------------------ */
/* Constructors used by both the simulator and the lesson seeder       */
/* ------------------------------------------------------------------ */

export function createConfigMap(
  state: ClusterState,
  name: string,
  data: Record<string, string>,
): ConfigMap {
  const configMap: ConfigMap = { uid: `cm-${nextId(state)}`, name, data: { ...data }, age: 0 };
  state.configMaps.push(configMap);
  return configMap;
}

export function createSecret(
  state: ClusterState,
  name: string,
  data: Record<string, string>,
  type = "Opaque",
): Secret {
  const secret: Secret = { uid: `sec-${nextId(state)}`, name, type, data: { ...data }, age: 0 };
  state.secrets.push(secret);
  return secret;
}

export function createDaemonSet(
  state: ClusterState,
  input: { name: string; template: PodTemplate; selector?: Labels },
): DaemonSet {
  const selector = input.selector ?? { app: input.name };
  const template = structuredClone(input.template);
  template.labels = { ...selector, ...template.labels };
  const daemonSet: DaemonSet = {
    uid: `ds-${nextId(state)}`,
    name: input.name,
    template,
    selector,
    age: 0,
  };
  state.daemonSets.push(daemonSet);
  return daemonSet;
}

export function createStatefulSet(
  state: ClusterState,
  input: {
    name: string;
    replicas: number;
    template: PodTemplate;
    selector?: Labels;
    serviceName?: string;
    volumeClaimTemplate?: StatefulSet["volumeClaimTemplate"];
  },
): StatefulSet {
  const selector = input.selector ?? { app: input.name };
  const template = structuredClone(input.template);
  template.labels = { ...selector, ...template.labels };
  const set: StatefulSet = {
    uid: `sts-${nextId(state)}`,
    name: input.name,
    replicas: input.replicas,
    template,
    selector,
    serviceName: input.serviceName ?? input.name,
    volumeClaimTemplate: input.volumeClaimTemplate,
    age: 0,
  };
  state.statefulSets.push(set);
  return set;
}

export function createJob(
  state: ClusterState,
  input: {
    name: string;
    template: PodTemplate;
    completions?: number;
    parallelism?: number;
    backoffLimit?: number;
  },
): Job {
  const job: Job = {
    uid: `job-${nextId(state)}`,
    name: input.name,
    template: structuredClone(input.template),
    completions: input.completions ?? 1,
    parallelism: input.parallelism ?? 1,
    backoffLimit: input.backoffLimit ?? 3,
    succeeded: 0,
    failed: 0,
    age: 0,
  };
  state.jobs.push(job);
  return job;
}

export function scheduleToTicks(schedule: string): number {
  const minutes = schedule.trim().split(/\s+/)[0];
  const every = /^\*\/(\d+)$/.exec(minutes ?? "");
  if (every) return Math.max(4, Number(every[1]) * 6);
  return 12;
}

export function createCronJob(
  state: ClusterState,
  input: { name: string; schedule: string; template: PodTemplate; suspend?: boolean },
): CronJob {
  const cronJob: CronJob = {
    uid: `cj-${nextId(state)}`,
    name: input.name,
    schedule: input.schedule,
    intervalTicks: scheduleToTicks(input.schedule),
    suspend: Boolean(input.suspend),
    template: structuredClone(input.template),
    age: 0,
  };
  state.cronJobs.push(cronJob);
  return cronJob;
}

export function createIngress(
  state: ClusterState,
  input: { name: string; className?: string; rules: Ingress["rules"] },
): Ingress {
  const ingress: Ingress = {
    uid: `ing-${nextId(state)}`,
    name: input.name,
    className: input.className,
    rules: input.rules.map((rule) => ({ ...rule })),
    age: 0,
  };
  state.ingresses.push(ingress);
  return ingress;
}

export function createStorageClass(
  state: ClusterState,
  input: { name: string; provisioner: string; isDefault?: boolean },
): StorageClass {
  const storageClass: StorageClass = {
    uid: `sc-${nextId(state)}`,
    name: input.name,
    provisioner: input.provisioner,
    isDefault: Boolean(input.isDefault),
    age: 0,
  };
  state.storageClasses.push(storageClass);
  return storageClass;
}

export function createPersistentVolume(
  state: ClusterState,
  input: {
    name: string;
    capacityGi: number;
    accessModes: PersistentVolume["accessModes"];
    storageClass: string;
  },
): PersistentVolume {
  const volume: PersistentVolume = {
    uid: `pv-${nextId(state)}`,
    name: input.name,
    capacityGi: input.capacityGi,
    accessModes: [...input.accessModes],
    storageClass: input.storageClass,
    status: "Available",
    age: 0,
  };
  state.persistentVolumes.push(volume);
  return volume;
}

export function createPersistentVolumeClaim(
  state: ClusterState,
  input: {
    name: string;
    requestGi: number;
    accessModes: PersistentVolumeClaim["accessModes"];
    storageClass?: string;
  },
): PersistentVolumeClaim {
  const claim: PersistentVolumeClaim = {
    uid: `pvc-${nextId(state)}`,
    name: input.name,
    requestGi: input.requestGi,
    accessModes: [...input.accessModes],
    storageClass: input.storageClass,
    status: "Pending",
    data: {},
    age: 0,
  };
  state.persistentVolumeClaims.push(claim);
  return claim;
}

export function addNode(state: ClusterState, name: string, labels: Labels = {}): ClusterNode {
  const node: ClusterNode = {
    name,
    role: "worker",
    labels: { "kubernetes.io/hostname": name, ...labels },
    taints: [],
    ready: true,
  };
  state.nodes.push(node);
  recordEvent(state, "Normal", "RegisteredNode", `node/${name}`, `Node ${name} joined the cluster`);
  return node;
}
