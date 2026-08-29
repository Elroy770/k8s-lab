import YAML from "yaml";
import {
  ClusterState,
  ClusterNode,
  Pod,
  ReplicaSet,
  Deployment,
  LessonStep,
  DaemonSet,
  StatefulSet,
  Job,
  CronJob,
  Service,
  ServicePort,
  Namespace,
  ConfigMapResource,
  SecretResource,
  ActionImpact,
  DEFAULT_NODES,
  DEFAULT_FILES,
} from "./cluster-state";
import { parseCommand, ParsedCommand, normalizeResource } from "./kubectl-parser";

export { DEFAULT_NODES, DEFAULT_FILES };
export const DEFAULT_VIRTUAL_FILES = DEFAULT_FILES;

export interface ExecutionResult {
  output: string;
  newState: ClusterState;
  isCorrect: boolean;
  message?: string;
  componentFlow?: string[];
  actionDescription?: string;
  actionImpact?: ActionImpact;
  openVim?: string;
}

function formatServicePorts(ports: string | ServicePort[] | undefined): string {
  if (!ports) return "<none>";
  if (typeof ports === "string") return ports;
  if (Array.isArray(ports)) {
    return ports
      .map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol || "TCP"}`)
      .join(",");
  }
  return "<none>";
}

function getServicePortInfo(ports: string | ServicePort[] | undefined): { portNum: string; targetPort: string } {
  if (!ports) return { portNum: "80", targetPort: "80" };
  if (Array.isArray(ports)) {
    const first = ports[0];
    if (first) {
      return {
        portNum: String(first.port),
        targetPort: String(first.nodePort || first.targetPort || first.port),
      };
    }
    return { portNum: "80", targetPort: "80" };
  }
  if (typeof ports === "string") {
    const portNum = ports.split(":")[0];
    const targetPort = ports.includes(":")
      ? ports.split(":")[1].includes("/")
        ? ports.split(":")[1].split("/")[0]
        : ports.split(":")[1]
      : portNum;
    return { portNum, targetPort };
  }
  return { portNum: "80", targetPort: "80" };
}

function cell(value: unknown, width: number, fallback = "-"): string {
  return String(value ?? fallback).padEnd(width);
}

export function syncNodes(nodes: ClusterNode[], pods: Pod[]): ClusterNode[] {
  const effectiveNodes = nodes && nodes.length > 0 ? nodes : DEFAULT_NODES;
  return effectiveNodes.map((node) => {
    if (node.roles.includes("control-plane")) {
      return { ...node, pods: [] };
    }
    const nodePods = pods
      .filter((p) => (p.node === node.name || (!p.node && node.name === "worker-node-1")) && p.status !== "Terminating")
      .map((p) => p.name);
    return { ...node, pods: nodePods };
  });
}

export function schedulePodToNode(existingPods: Pod[], nodes: ClusterNode[]): string {
  const worker1 = "worker-node-1";
  const worker2 = "worker-node-2";

  const count1 = existingPods.filter((p) => (p.node === worker1 || !p.node) && p.status !== "Terminating").length;
  const count2 = existingPods.filter((p) => p.node === worker2 && p.status !== "Terminating").length;

  if (count1 <= count2) {
    return worker1;
  } else {
    return worker2;
  }
}

export function getPodIpForNode(nodeName: string): string {
  const subnet = nodeName === "worker-node-2" ? "2" : "1";
  const host = Math.floor(Math.random() * 200) + 10;
  return `10.244.${subnet}.${host}`;
}

function parseYamlDocuments(content: string): any[] {
  try {
    const docs = YAML.parseAllDocuments(content);
    const results: any[] = [];
    for (const doc of docs) {
      const json = doc.toJSON();
      if (json && typeof json === "object") {
        if (json.kind === "List" && Array.isArray(json.items)) {
          results.push(...json.items);
        } else {
          results.push(json);
        }
      }
    }
    if (results.length > 0) return results;
  } catch {
    // Continue to single parse fallback
  }

  try {
    const single = YAML.parse(content);
    if (single && typeof single === "object") {
      if (single.kind === "List" && Array.isArray(single.items)) {
        return single.items;
      }
      return [single];
    }
  } catch {
    return [];
  }
  return [];
}

export function executeCommand(
  input: string,
  state: ClusterState,
  currentStep?: LessonStep
): ExecutionResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { output: "", newState: state, isCorrect: false };
  }

  if (trimmed === "clear") {
    return { output: "__CLEAR__", newState: state, isCorrect: false };
  }

  // Ensure initial nodes and files exist
  const initialNodes = state.nodes && state.nodes.length > 0 ? state.nodes : DEFAULT_NODES;
  const initialFiles = state.files && Object.keys(state.files).length > 0 ? state.files : DEFAULT_FILES;

  const nextState: ClusterState = {
    nodes: syncNodes(initialNodes, state.pods || []),
    pods: (state.pods || []).map((p) => ({
      ...p,
      node: p.node || "worker-node-1",
      ip: p.ip || getPodIpForNode(p.node || "worker-node-1"),
    })),
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
    files: { ...initialFiles },
    lastActionImpact: state.lastActionImpact,
  };

  const parsed = parseCommand(input);

  // Shell Command Execution
  if (parsed.isShellCommand || (!parsed.isKubectl && ["cat", "ls", "vim", "vi", "rm", "touch", "echo", "pwd"].includes(parsed.verb))) {
    return handleShellCommand(input, parsed, nextState, currentStep);
  }

  if (!parsed.isKubectl) {
    if (trimmed === "help") {
      return {
        output: `Available kubectl commands:
  kubectl get nodes [-o wide]
  kubectl describe node <name>
  kubectl run <name> --image=<image> [--dry-run=client -o yaml > file.yaml]
  kubectl apply -f <file.yaml>
  kubectl create -f <file.yaml>
  kubectl delete -f <file.yaml>
  kubectl get pods | rs | deployments | ds | sts | jobs | cronjobs | svc | ns | cm | secrets [-o wide]
  kubectl describe pod <name> | svc <name> | deployment <name> | node <name>
  kubectl delete pod <name> | deployment <name> | svc <name>
  kubectl scale rs <name> --replicas=<num>
  kubectl scale deployment <name> --replicas=<num>
  kubectl set image deployment/<name> <container>=<image>
  kubectl rollout status | history | undo deployment/<name>
  kubectl logs <pod-name>
  kubectl events

Shell utilities:
  ls
  cat <file.yaml>
  vim <file.yaml>
  rm <file.yaml>`,
        newState: nextState,
        isCorrect: false,
      };
    }

    return {
      output: `bash: ${parsed.raw.split(" ")[0]}: command not found. Try running a kubectl command or type 'help'.`,
      newState: nextState,
      isCorrect: false,
    };
  }

  let output = "";
  let matchedChallenge = false;
  const { verb, resource, name, flags, args, file, redirectToFile, subVerb } = parsed;

  const affectedNodes: string[] = [];
  const affectedPods: string[] = [];
  let summary = "";
  let controlPlaneEvents: string[] = [];
  let dataPlaneEvents: string[] = [];
  let componentFlow: string[] = ["Terminal", "kube-apiserver"];
  let actionDescription = "Command processed by kube-apiserver";

  // 1. APPLY / CREATE -f / DELETE -f
  if (verb === "apply" || ((verb === "create" || verb === "delete") && file)) {
    const fileName = file || args[0];
    if (!fileName) {
      output = `error: must specify one of -f and -k`;
      summary = `Failed ${verb} command: missing file argument`;
      controlPlaneEvents = [`kube-apiserver rejected command: missing file specification (-f).`];
      dataPlaneEvents = [`No data plane changes.`];
    } else if (!nextState.files[fileName]) {
      output = `error: the path "${fileName}" does not exist`;
      summary = `Failed ${verb} command: file "${fileName}" not found in local workspace`;
      controlPlaneEvents = [`Local file lookup for "${fileName}" failed before transmission to API server.`];
      dataPlaneEvents = [`No data plane changes.`];
    } else {
      const yamlContent = nextState.files[fileName];
      const docs = parseYamlDocuments(yamlContent);

      if (docs.length === 0) {
        output = `error: no objects passed to ${verb}`;
        summary = `Empty or invalid YAML file "${fileName}"`;
        controlPlaneEvents = [`kube-apiserver could not parse valid Kubernetes resource from "${fileName}".`];
        dataPlaneEvents = [`No data plane changes.`];
      } else {
        const results: string[] = [];

        for (const doc of docs) {
          const kind = (doc.kind || "Pod") as string;
          const metaName = doc.metadata?.name || doc.name || "unnamed";
          const labels = doc.metadata?.labels || {};
          const namespace = doc.metadata?.namespace || "default";

          if (verb === "delete") {
            // DELETE FROM FILE
            const normKind = normalizeResource(kind);
            if (normKind === "pod") {
              nextState.pods = nextState.pods.filter((p) => p.name !== metaName);
              results.push(`pod "${metaName}" deleted`);
              affectedPods.push(metaName);
            } else if (normKind === "deployment") {
              nextState.deployments = nextState.deployments.filter((d) => d.name !== metaName);
              nextState.replicaSets = nextState.replicaSets.filter((rs) => !rs.name.startsWith(metaName) && rs.ownerRef?.name !== metaName);
              nextState.pods = nextState.pods.filter((p) => !p.name.startsWith(metaName) && p.ownerRef?.name !== metaName);
              results.push(`deployment.apps "${metaName}" deleted`);
            } else if (normKind === "replicaset") {
              nextState.replicaSets = nextState.replicaSets.filter((rs) => rs.name !== metaName);
              nextState.pods = nextState.pods.filter((p) => p.ownerRef?.name !== metaName);
              results.push(`replicaset.apps "${metaName}" deleted`);
            } else if (normKind === "service") {
              nextState.services = nextState.services.filter((s) => s.name !== metaName);
              results.push(`service "${metaName}" deleted`);
            } else if (normKind === "configmap") {
              nextState.configMaps = nextState.configMaps.filter((cm) => cm.name !== metaName);
              results.push(`configmap "${metaName}" deleted`);
            } else if (normKind === "secret") {
              nextState.secrets = nextState.secrets.filter((sec) => sec.name !== metaName);
              results.push(`secret "${metaName}" deleted`);
            } else {
              results.push(`${kind.toLowerCase()} "${metaName}" deleted`);
            }
          } else {
            // APPLY OR CREATE
            const normKind = normalizeResource(kind);

            if (normKind === "pod") {
              const image = doc.spec?.containers?.[0]?.image || doc.image || "nginx:latest";
              const existingIdx = nextState.pods.findIndex((p) => p.name === metaName);
              const assignedNode = schedulePodToNode(nextState.pods, nextState.nodes);
              const assignedIp = getPodIpForNode(assignedNode);

              if (existingIdx >= 0) {
                if (verb === "create") {
                  results.push(`Error from server (AlreadyExists): pods "${metaName}" already exists`);
                } else {
                  nextState.pods[existingIdx] = {
                    ...nextState.pods[existingIdx],
                    image,
                    labels: { ...(nextState.pods[existingIdx].labels || {}), ...labels },
                  };
                  results.push(`pod/${metaName} configured`);
                  affectedPods.push(metaName);
                  if (nextState.pods[existingIdx].node) affectedNodes.push(nextState.pods[existingIdx].node!);
                }
              } else {
                const newPod: Pod = {
                  name: metaName,
                  image,
                  status: "Running",
                  node: assignedNode,
                  ip: assignedIp,
                  labels,
                  namespace,
                  restarts: 0,
                  age: "10s",
                };
                nextState.pods.push(newPod);
                results.push(`pod/${metaName} created`);
                affectedPods.push(metaName);
                affectedNodes.push(assignedNode);
              }
            } else if (normKind === "deployment") {
              const replicas = doc.spec?.replicas ?? 1;
              const image = doc.spec?.template?.spec?.containers?.[0]?.image || "nginx:latest";
              const matchLabels = doc.spec?.selector?.matchLabels || labels;
              const existingIdx = nextState.deployments.findIndex((d) => d.name === metaName);

              if (existingIdx >= 0) {
                const dep = nextState.deployments[existingIdx];
                dep.replicas = replicas;
                dep.image = image;
                dep.available = replicas;
                dep.upToDate = replicas;
                dep.revision += 1;
                results.push(`deployment.apps/${metaName} configured`);
              } else {
                const dep: Deployment = {
                  name: metaName,
                  replicas,
                  available: replicas,
                  upToDate: replicas,
                  image,
                  labels,
                  matchLabels,
                  revision: 1,
                  age: "5s",
                  namespace,
                };
                nextState.deployments.push(dep);

                const rsName = `${metaName}-v1`;
                nextState.replicaSets.push({
                  name: rsName,
                  desiredReplicas: replicas,
                  currentReplicas: replicas,
                  readyReplicas: replicas,
                  image,
                  ownerRef: { kind: "Deployment", name: metaName },
                  labels,
                  matchLabels,
                  age: "5s",
                  namespace,
                });

                for (let i = 0; i < replicas; i++) {
                  const node = schedulePodToNode(nextState.pods, nextState.nodes);
                  const pName = `${metaName}-${Math.random().toString(36).substring(2, 7)}`;
                  nextState.pods.push({
                    name: pName,
                    image,
                    status: "Running",
                    node,
                    ip: getPodIpForNode(node),
                    labels: matchLabels,
                    ownerRef: { kind: "ReplicaSet", name: rsName },
                    restarts: 0,
                    age: "5s",
                    namespace,
                  });
                  affectedPods.push(pName);
                  if (!affectedNodes.includes(node)) affectedNodes.push(node);
                }
                results.push(`deployment.apps/${metaName} created`);
              }
            } else if (normKind === "replicaset") {
              const replicas = doc.spec?.replicas ?? 1;
              const image = doc.spec?.template?.spec?.containers?.[0]?.image || "nginx:latest";
              const matchLabels = doc.spec?.selector?.matchLabels || labels;
              const existingIdx = nextState.replicaSets.findIndex((r) => r.name === metaName);

              if (existingIdx >= 0) {
                nextState.replicaSets[existingIdx].desiredReplicas = replicas;
                nextState.replicaSets[existingIdx].currentReplicas = replicas;
                nextState.replicaSets[existingIdx].readyReplicas = replicas;
                nextState.replicaSets[existingIdx].image = image;
                results.push(`replicaset.apps/${metaName} configured`);
              } else {
                nextState.replicaSets.push({
                  name: metaName,
                  desiredReplicas: replicas,
                  currentReplicas: replicas,
                  readyReplicas: replicas,
                  image,
                  labels,
                  matchLabels,
                  age: "5s",
                  namespace,
                });

                for (let i = 0; i < replicas; i++) {
                  const node = schedulePodToNode(nextState.pods, nextState.nodes);
                  const pName = `${metaName}-${Math.random().toString(36).substring(2, 7)}`;
                  nextState.pods.push({
                    name: pName,
                    image,
                    status: "Running",
                    node,
                    ip: getPodIpForNode(node),
                    labels: matchLabels,
                    ownerRef: { kind: "ReplicaSet", name: metaName },
                    restarts: 0,
                    age: "5s",
                    namespace,
                  });
                  affectedPods.push(pName);
                  if (!affectedNodes.includes(node)) affectedNodes.push(node);
                }
                results.push(`replicaset.apps/${metaName} created`);
              }
            } else if (normKind === "daemonset") {
              const image = doc.spec?.template?.spec?.containers?.[0]?.image || "fluentd:latest";
              nextState.daemonSets.push({
                name: metaName,
                desiredNodes: 2,
                currentPods: 2,
                readyPods: 2,
                image,
                age: "5s",
                namespace,
              });

              ["worker-node-1", "worker-node-2"].forEach((node) => {
                const pName = `${metaName}-${node.slice(-1)}${Math.random().toString(36).substring(2, 5)}`;
                nextState.pods.push({
                  name: pName,
                  image,
                  status: "Running",
                  node,
                  ip: getPodIpForNode(node),
                  ownerRef: { kind: "DaemonSet", name: metaName },
                  restarts: 0,
                  age: "5s",
                  namespace,
                });
                affectedPods.push(pName);
                if (!affectedNodes.includes(node)) affectedNodes.push(node);
              });
              results.push(`daemonset.apps/${metaName} created`);
            } else if (normKind === "service") {
              const type = doc.spec?.type || "ClusterIP";
              const ports = doc.spec?.ports || [{ port: 80, targetPort: 80 }];
              const selector = doc.spec?.selector || {};
              const clusterIP = `10.96.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;

              const existingIdx = nextState.services.findIndex((s) => s.name === metaName);
              if (existingIdx >= 0) {
                nextState.services[existingIdx] = {
                  ...nextState.services[existingIdx],
                  type,
                  ports,
                  selector,
                };
                results.push(`service/${metaName} configured`);
              } else {
                nextState.services.push({
                  name: metaName,
                  type,
                  clusterIP,
                  ports,
                  selector,
                  age: "5s",
                  namespace,
                });
                results.push(`service/${metaName} created`);
              }
            } else if (normKind === "configmap") {
              const data = doc.data || {};
              const existingIdx = nextState.configMaps.findIndex((cm) => cm.name === metaName);
              if (existingIdx >= 0) {
                nextState.configMaps[existingIdx].data = data;
                results.push(`configmap/${metaName} configured`);
              } else {
                nextState.configMaps.push({
                  name: metaName,
                  data,
                  age: "5s",
                  namespace,
                });
                results.push(`configmap/${metaName} created`);
              }
            } else if (normKind === "secret") {
              const data = doc.data || doc.stringData || {};
              const type = doc.type || "Opaque";
              const existingIdx = nextState.secrets.findIndex((s) => s.name === metaName);
              if (existingIdx >= 0) {
                nextState.secrets[existingIdx].data = data;
                results.push(`secret/${metaName} configured`);
              } else {
                nextState.secrets.push({
                  name: metaName,
                  type,
                  data,
                  age: "5s",
                  namespace,
                });
                results.push(`secret/${metaName} created`);
              }
            } else if (normKind === "namespace") {
              nextState.namespaces.push({
                name: metaName,
                status: "Active",
                age: "5s",
              });
              results.push(`namespace/${metaName} created`);
            } else {
              results.push(`${kind.toLowerCase()}/${metaName} created`);
            }
          }
        }

        output = results.join("\n");
        nextState.nodes = syncNodes(nextState.nodes, nextState.pods);

        const targetNode = affectedNodes[0] || "worker-node-1";
        summary = `Applied declarative manifest "${fileName}". kube-apiserver parsed and validated the resource specifications and stored the desired state into etcd. kube-scheduler assigned workloads across worker nodes.`;
        controlPlaneEvents = [
          `kube-apiserver: Decoded and validated YAML manifest "${fileName}" against OpenAPI schemas.`,
          `etcd: Persisted updated resource state definitions under the registry keys.`,
          `kube-scheduler: Evaluated node resource allocations and selected optimal worker nodes.`,
          `kube-controller-manager: Reconciled object state and initiated pod provisioning.`,
        ];
        dataPlaneEvents = [
          `kubelet (${targetNode}): Received pod specification via API server watch stream.`,
          `CRI (Container Runtime): Initialized container sandbox and started container processes.`,
          `CNI: Allocated pod IP and established network routing on host bridge.`,
        ];
        componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-scheduler", "kubelet", "CRI"];
        actionDescription = `Manifest '${fileName}' applied → API Server validated schema & wrote to etcd → Scheduler assigned nodes → kubelet invoked CRI to launch containers.`;
      }
    }
  }

  // 2. RUN
  else if (verb === "run") {
    if (!name) {
      output = `error: NAME is required for run`;
      summary = `Missing Pod name for 'kubectl run'`;
    } else {
      const image = (flags.image as string) || "nginx:latest";
      const isDryRun = Boolean(flags["dry-run"] || flags.dryRun);
      const isYamlOutput = (flags.output === "yaml" || flags.o === "yaml");

      if (isDryRun && isYamlOutput) {
        const yamlOutput = `apiVersion: v1
kind: Pod
metadata:
  creationTimestamp: null
  labels:
    run: ${name}
  name: ${name}
spec:
  containers:
  - image: ${image}
    name: ${name}
    resources: {}
  dnsPolicy: ClusterFirst
  restartPolicy: Always
status: {}
`;
        if (redirectToFile) {
          nextState.files[redirectToFile] = yamlOutput;
          output = ""; // Silent redirect in shell
          summary = `Generated declarative Pod YAML for '${name}' via --dry-run=client and wrote to '${redirectToFile}'.`;
          controlPlaneEvents = [`Client-side dry-run generated Pod manifest locally without contacting the cluster API.`];
          dataPlaneEvents = [`Saved generated YAML into virtual file system at '${redirectToFile}'.`];
        } else {
          output = yamlOutput.trim();
          summary = `Rendered declarative Pod YAML for '${name}' via --dry-run=client.`;
          controlPlaneEvents = [`Client-side dry-run evaluated Pod configuration.`];
          dataPlaneEvents = [`Manifest displayed in stdout.`];
        }
        componentFlow = ["Terminal"];
        actionDescription = `Client generated dry-run Pod specification without modifying cluster state.`;
      } else {
        const existing = nextState.pods.find((p) => p.name === name);
        if (existing) {
          output = `Error from server (AlreadyExists): pods "${name}" already exists`;
          summary = `Pod '${name}' already exists in the cluster.`;
          controlPlaneEvents = [`kube-apiserver rejected creation: Pod '${name}' already registered in etcd.`];
          dataPlaneEvents = [`No changes to worker nodes.`];
        } else {
          const assignedNode = schedulePodToNode(nextState.pods, nextState.nodes);
          const assignedIp = getPodIpForNode(assignedNode);
          const newPod: Pod = {
            name,
            image,
            status: "Running",
            node: assignedNode,
            ip: assignedIp,
            labels: { run: name },
            restarts: 0,
            age: "5s",
          };
          nextState.pods.push(newPod);
          nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
          output = `pod/${name} created`;

          affectedPods.push(name);
          affectedNodes.push(assignedNode);
          summary = `Created standalone Pod '${name}'. kube-apiserver authenticated the request, etcd committed the object, kube-scheduler selected ${assignedNode}, and kubelet instructed the CRI to start the container.`;
          controlPlaneEvents = [
            `kube-apiserver: Validated PodSpec for '${name}' and persisted state to etcd.`,
            `kube-scheduler: Filtered and scored worker nodes, selecting '${assignedNode}'.`,
            `kube-apiserver: Created NodeBinding object binding '${name}' to '${assignedNode}'.`,
          ];
          dataPlaneEvents = [
            `kubelet (${assignedNode}): Detected new Pod binding via watch stream.`,
            `CRI (containerd): Pulled image '${image}', initialized Linux cgroups & namespaces.`,
            `CNI: Allocated IP '${assignedIp}' to container interface eth0.`,
            `kubelet (${assignedNode}): Confirmed running status and updated API server.`,
          ];
          componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-scheduler", "kubelet", "CRI"];
          actionDescription = `API Server validated Pod '${name}' & stored in etcd → Scheduler assigned ${assignedNode} → kubelet instructed CRI to pull '${image}' and start container.`;
        }
      }
    }
  }

  // 3. GET
  else if (verb === "get") {
    const isWide = flags.output === "wide" || flags.o === "wide";
    const targetNs = (flags.namespace || flags.n) as string | undefined;
    const allNamespaces = Boolean(flags.allNamespaces || flags.A);

    if (resource === "node" || resource === "nodes") {
      if (name) {
        const node = nextState.nodes.find((n) => n.name === name);
        if (!node) {
          output = `Error from server (NotFound): nodes "${name}" not found`;
        } else {
          output = `NAME            STATUS   ROLES           AGE   VERSION\n${cell(node.name, 15)} ${cell(node.status, 8)} ${cell(node.roles.join(","), 15)} 10d   v1.28.2`;
        }
      } else {
        if (isWide) {
          const header = `NAME            STATUS   ROLES           AGE   VERSION   INTERNAL-IP   EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION     CONTAINER-RUNTIME`;
          const rows = nextState.nodes.map(
            (n) => `${cell(n.name, 15)} ${cell(n.status, 8)} ${cell(n.roles.join(","), 15)} 10d   v1.28.2   ${cell(n.ip, 13)} <none>        Ubuntu 22.04.3 LTS   5.15.0-88-generic  containerd://1.7.5`
          );
          output = [header, ...rows].join("\n");
        } else {
          const header = `NAME            STATUS   ROLES           AGE   VERSION`;
          const rows = nextState.nodes.map(
            (n) => `${cell(n.name, 15)} ${cell(n.status, 8)} ${cell(n.roles.join(","), 15)} 10d   v1.28.2`
          );
          output = [header, ...rows].join("\n");
        }
      }
      summary = `Retrieved cluster node topology and health statuses directly from etcd.`;
    } else if (resource === "pod" || resource === "pods") {
      let filteredPods = nextState.pods;
      if (targetNs && !allNamespaces) {
        filteredPods = filteredPods.filter((p) => (p.namespace || "default") === targetNs);
      }

      if (name) {
        const p = filteredPods.find((pod) => pod.name === name);
        if (!p) {
          output = `Error from server (NotFound): pods "${name}" not found`;
        } else if (isWide) {
          output = `NAME                        READY   STATUS    RESTARTS   AGE   IP            NODE            NOMINATED NODE   READINESS GATES\n${cell(p.name, 27)} 1/1     ${cell(p.status, 9, "Running")} ${cell(p.restarts, 10, "0")} ${cell(p.age || "5s", 5)} ${cell(p.ip || "10.244.1.5", 13)} ${cell(p.node || "worker-node-1", 15)} <none>           <none>`;
        } else {
          output = `NAME                        READY   STATUS    RESTARTS   AGE\n${cell(p.name, 27)} 1/1     ${cell(p.status, 9, "Running")} ${cell(p.restarts, 10, "0")} ${p.age || "5s"}`;
        }
      } else {
        if (filteredPods.length === 0) {
          output = `No resources found in ${targetNs || "default"} namespace.`;
        } else if (isWide) {
          const header = `NAME                        READY   STATUS    RESTARTS   AGE   IP            NODE            NOMINATED NODE   READINESS GATES`;
          const rows = filteredPods.map(
            (p) => `${cell(p.name, 27)} 1/1     ${cell(p.status, 9, "Running")} ${cell(p.restarts, 10, "0")} ${cell(p.age || "5s", 5)} ${cell(p.ip || "10.244.1.5", 13)} ${cell(p.node || "worker-node-1", 15)} <none>           <none>`
          );
          output = [header, ...rows].join("\n");
        } else {
          const header = `NAME                        READY   STATUS    RESTARTS   AGE`;
          const rows = filteredPods.map(
            (p) => `${cell(p.name, 27)} 1/1     ${cell(p.status, 9, "Running")} ${cell(p.restarts, 10, "0")} ${p.age || "5s"}`
          );
          output = [header, ...rows].join("\n");
        }
      }
      summary = `Queried live Pod status and IP/node assignments from etcd.`;
    } else if (resource === "replicaset" || resource === "rs") {
      if (nextState.replicaSets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME                   DESIRED   CURRENT   READY   AGE`;
        const rows = nextState.replicaSets.map(
          (rs) => `${cell(rs.name, 22)} ${cell(rs.desiredReplicas ?? rs.replicas, 9, "0")} ${cell(rs.currentReplicas ?? rs.replicas, 9, "0")} ${cell(rs.readyReplicas ?? rs.replicas, 7, "0")} ${rs.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried ReplicaSet controllers from etcd.`;
    } else if (resource === "deployment" || resource === "deploy") {
      if (nextState.deployments.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         READY   UP-TO-DATE   AVAILABLE   AGE`;
        const rows = nextState.deployments.map(
          (d) => `${cell(d.name, 12)} ${d.available ?? 0}/${d.replicas ?? 0}     ${cell(d.upToDate, 12, "0")} ${cell(d.available, 11, "0")} ${d.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried Deployment objects and rollout status from etcd.`;
    } else if (resource === "daemonset" || resource === "ds") {
      if (nextState.daemonSets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME                   DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE`;
        const rows = nextState.daemonSets.map(
          (ds) => `${cell(ds.name, 22)} ${cell(ds.desiredNodes, 9, "0")} ${cell(ds.currentPods, 9, "0")} ${cell(ds.readyPods, 7, "0")} ${cell(ds.currentPods, 12, "0")} ${cell(ds.readyPods, 11, "0")} <none>          ${ds.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried DaemonSet controller objects from etcd.`;
    } else if (resource === "statefulset" || resource === "sts") {
      if (nextState.statefulSets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         READY   AGE`;
        const rows = nextState.statefulSets.map(
          (sts) => `${cell(sts.name, 12)} ${sts.readyReplicas ?? 0}/${sts.replicas ?? 0}     ${sts.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried StatefulSet controllers from etcd.`;
    } else if (resource === "job") {
      if (nextState.jobs.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         COMPLETIONS   DURATION   AGE`;
        const rows = nextState.jobs.map(
          (job) => `${cell(job.name, 12)} ${job.succeeded ?? 0}/${job.completions ?? 0}           12s        ${job.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried batch Job completion objects from etcd.`;
    } else if (resource === "cronjob" || resource === "cj") {
      if (nextState.cronJobs.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE`;
        const rows = nextState.cronJobs.map(
          (cj) => `${cell(cj.name, 12)} ${cell(cj.schedule, 13)} False     ${cell(cj.active, 8, "0")} ${cell(cj.lastSchedule, 15)} ${cj.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried CronJob schedules from etcd.`;
    } else if (resource === "service" || resource === "svc") {
      if (nextState.services.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE`;
        const rows = nextState.services.map(
          (svc) => `${cell(svc.name, 12)} ${cell(svc.type, 14)} ${cell(svc.clusterIP, 15)} ${svc.externalIP || "<none>        "} ${cell(formatServicePorts(svc.ports), 9)} ${svc.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried Service networking definitions from etcd.`;
    } else if (resource === "namespace" || resource === "ns") {
      if (nextState.namespaces.length === 0) {
        output = `NAME              STATUS   AGE\ndefault           Active   10d\nkube-system       Active   10d\nkube-public       Active   10d`;
      } else {
        const header = `NAME              STATUS   AGE`;
        const rows = nextState.namespaces.map(
          (ns) => `${cell(ns.name, 17)} ${cell(ns.status, 8, "Active")} ${ns.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried Namespace isolation partitions from etcd.`;
    } else if (resource === "configmap" || resource === "cm") {
      if (nextState.configMaps.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         DATA   AGE`;
        const rows = nextState.configMaps.map(
          (cm) => `${cell(cm.name, 12)} ${cell(Object.keys(cm.data || {}).length, 6, "0")} ${cm.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried ConfigMaps configuration objects from etcd.`;
    } else if (resource === "secret") {
      if (nextState.secrets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         TYPE                                  DATA   AGE`;
        const rows = nextState.secrets.map(
          (sec) => `${cell(sec.name, 12)} ${cell(sec.type, 37)} ${cell((sec.dataKeys || Object.keys(sec.data || {})).length, 6, "0")} ${sec.age || "-"}`
        );
        output = [header, ...rows].join("\n");
      }
      summary = `Queried Secret security credentials from etcd.`;
    } else if (resource === "all") {
      const parts: string[] = [];
      if (nextState.pods.length > 0) {
        parts.push(`NAME                        READY   STATUS    RESTARTS   AGE\n` + nextState.pods.map((p) => `pod/${cell(p.name, 23)} 1/1     ${cell(p.status, 9, "Running")} ${cell(p.restarts, 10, "0")} ${p.age || "5s"}`).join("\n"));
      }
      if (nextState.services.length > 0) {
        parts.push(`NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE\n` + nextState.services.map((s) => `service/${cell(s.name, 10)} ${cell(s.type, 11)} ${cell(s.clusterIP, 12)} <none>        ${cell(formatServicePorts(s.ports), 9)} ${s.age || "5s"}`).join("\n"));
      }
      if (nextState.deployments.length > 0) {
        parts.push(`NAME                     READY   UP-TO-DATE   AVAILABLE   AGE\n` + nextState.deployments.map((d) => `deployment.apps/${cell(d.name, 8)} ${d.available ?? 0}/${d.replicas ?? 0}     ${cell(d.upToDate, 12, "0")} ${cell(d.available, 11, "0")} ${d.age || "-"}`).join("\n"));
      }
      if (nextState.replicaSets.length > 0) {
        parts.push(`NAME                                DESIRED   CURRENT   READY   AGE\n` + nextState.replicaSets.map((rs) => `replicaset.apps/${cell(rs.name, 19)} ${cell(rs.desiredReplicas ?? rs.replicas, 9, "0")} ${cell(rs.currentReplicas ?? rs.replicas, 9, "0")} ${cell(rs.readyReplicas ?? rs.replicas, 7, "0")} ${rs.age || "-"}`).join("\n"));
      }
      output = parts.length > 0 ? parts.join("\n\n") : "No resources found in default namespace.";
      summary = `Queried all default namespace workloads from etcd.`;
    } else {
      output = `error: the server doesn't have a resource type "${resource || args[0]}"`;
      summary = `Resource type not found.`;
    }

    controlPlaneEvents = [
      `kube-apiserver: Received authenticated GET request for ${resource || "resources"}.`,
      `etcd: Retrieved current state definitions directly from database indexes.`,
    ];
    dataPlaneEvents = [`Data plane nodes remain unperturbed during read-only cluster queries.`];
    componentFlow = ["Terminal", "kube-apiserver", "etcd"];
    actionDescription = `API Server queried the current desired and live state directly from etcd key-value store.`;
  }

  // 4. DESCRIBE
  else if (verb === "describe") {
    if (resource === "node" || resource === "nodes") {
      const nodeName = name || "worker-node-1";
      const targetNode = nextState.nodes.find((n) => n.name === nodeName) || nextState.nodes[1] || nextState.nodes[0];
      const nodePods = nextState.pods.filter((p) => p.node === targetNode.name && p.status !== "Terminating");

      const podRows = nodePods.length > 0
        ? nodePods.map((p) => `  default      ${cell(p.name, 28)} 100m (2%)     128Mi (1%)`).join("\n")
        : "  (none)";

      output = `Name:               ${targetNode.name}
Roles:              ${targetNode.roles.join(",")}
Labels:             beta.kubernetes.io/arch=amd64
                    beta.kubernetes.io/os=linux
                    kubernetes.io/arch=amd64
                    kubernetes.io/hostname=${targetNode.name}
                    kubernetes.io/os=linux
Annotations:        kubeadm.alpha.kubernetes.io/cri-socket: unix:///run/containerd/containerd.sock
                    node.alpha.kubernetes.io/ttl: 0
CreationTimestamp:  Mon, 18 Aug 2026 09:00:00 +0000
Taints:             ${targetNode.roles.includes("control-plane") ? "node-role.kubernetes.io/control-plane:NoSchedule" : "<none>"}
Status:             ${targetNode.status}
Addresses:
  InternalIP:   ${targetNode.ip}
  Hostname:     ${targetNode.name}
Capacity:
  cpu:                4
  ephemeral-storage:  100Gi
  memory:             8192Mi
  pods:               110
Allocatable:
  cpu:                4
  ephemeral-storage:  100Gi
  memory:             8192Mi
  pods:               110
Non-terminated Pods:  (${nodePods.length} in total)
  Namespace    Name                         CPU Requests  Memory Requests
  ---------    ----                         ------------  ---------------
${podRows}
Allocated resources:
  Resource           Requests    Limits
  --------           --------    ------
  cpu                ${nodePods.length * 100}m (${nodePods.length * 2}%)   ${nodePods.length * 200}m (${nodePods.length * 4}%)
  memory             ${nodePods.length * 128}Mi (${Math.round(nodePods.length * 1.5)}%)  ${nodePods.length * 256}Mi (${nodePods.length * 3}%)
Events:
  Type    Reason                   Age   From        Message
  ----    ------                   ----  ----        -------
  Normal  Starting                 10d   kubelet     Starting kubelet.
  Normal  NodeHasSufficientMemory  10d   kubelet     Node ${targetNode.name} status is now: NodeHasSufficientMemory
  Normal  NodeReady                10d   kubelet     Node ${targetNode.name} status is now: NodeReady`;

      summary = `Inspected node telemetry, allocatable capacities, running container workloads, and kubelet conditions for '${targetNode.name}'.`;
      controlPlaneEvents = [`kube-apiserver: Aggregated node metadata, health status heartbeats, and bound Pod allocations from etcd.`];
      dataPlaneEvents = [`kubelet (${targetNode.name}): Reported real-time node resource telemetry and hardware metrics to the API server.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd", "kubelet"];
      actionDescription = `API Server aggregated Node object metadata, resource allocations, and kubelet conditions.`;
    } else if (resource === "pod" || resource === "pods") {
      const p = nextState.pods.find((pod) => pod.name === name) || nextState.pods[0];
      if (!p) {
        output = `Error from server (NotFound): pods "${name || ""}" not found`;
      } else {
        const podNode = p.node || "worker-node-1";
        const podIp = p.ip || "10.244.1.5";
        output = `Name:         ${p.name}
Namespace:    ${p.namespace || "default"}
Priority:     0
Node:         ${podNode}/172.18.0.3
Status:       ${p.status}
IP:           ${podIp}
Containers:
  nginx:
    Container ID:   containerd://simulated-${p.name}
    Image:          ${p.image}
    Port:           80/TCP
    State:          Running
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  20s   default-scheduler  Successfully assigned default/${p.name} to ${podNode}
  Normal  Pulling    19s   kubelet            Pulling image "${p.image}"
  Normal  Pulled     18s   kubelet            Successfully pulled image "${p.image}"
  Normal  Created    18s   kubelet            Created container nginx
  Normal  Started    18s   kubelet            Started container nginx`;
      }
      summary = `Inspected detailed Pod state, container runtimes, IP assignment, and chronological kubelet events for '${p?.name || name}'.`;
      controlPlaneEvents = [`kube-apiserver: Fetched Pod manifest and aggregated cluster event objects from etcd.`];
      dataPlaneEvents = [`kubelet: Event logs confirm healthy container lifecycle.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd"];
      actionDescription = `API Server aggregated Pod details, node bindings, and lifecycle events from etcd.`;
    } else if (resource === "service" || resource === "svc") {
      const svc = nextState.services.find((s) => s.name === name);
      if (!svc) {
        output = `Error from server (NotFound): services "${name}" not found`;
      } else {
        const selectors = svc.selector ? Object.entries(svc.selector).map(([k, v]) => `${k}=${v}`).join(",") : "<none>";
        const { portNum, targetPort } = getServicePortInfo(svc.ports);
        output = `Name:              ${svc.name}
Namespace:         ${svc.namespace || "default"}
Labels:            <none>
Annotations:       <none>
Selector:          ${selectors}
Type:              ${svc.type}
IP Family Policy:  SingleStack
IP Families:       IPv4
IP:                ${svc.clusterIP}
IPs:               ${svc.clusterIP}
Port:              <unset>  ${portNum}/TCP
TargetPort:        ${targetPort}/TCP
Endpoints:         10.244.1.10:80,10.244.2.11:80
Session Affinity:  None
Events:            <none>`;
      }
      summary = `Inspected Service routing configuration, ClusterIP, and dynamic Endpoints.`;
      controlPlaneEvents = [`kube-apiserver: Retrieved Service object and matched EndpointSlice objects from etcd.`];
      dataPlaneEvents = [`kube-proxy: Configures iptables DNAT rules matching these Endpoints.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd"];
      actionDescription = `API Server inspected Service definitions and endpoint mappings.`;
    } else {
      output = `describe ${resource} ${name || ""} (simulated detail view)`;
      summary = `Inspected ${resource} details.`;
      controlPlaneEvents = [`kube-apiserver queried etcd for resource details.`];
      dataPlaneEvents = [`No data plane changes.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd"];
      actionDescription = `API Server queried resource description from etcd.`;
    }
  }

  // 5. DELETE
  else if (verb === "delete") {
    if (resource === "pod" || resource === "pods") {
      const targetPod = name
        ? nextState.pods.find((p) => p.name === name)
        : nextState.pods[0];

      if (!targetPod) {
        output = `Error from server (NotFound): pods "${name || ""}" not found`;
        summary = `Pod '${name || ""}' not found for deletion.`;
        controlPlaneEvents = [`kube-apiserver: Could not locate Pod in etcd.`];
        dataPlaneEvents = [`No data plane changes.`];
      } else {
        nextState.pods = nextState.pods.filter((p) => p.name !== targetPod.name);
        output = `pod "${targetPod.name}" deleted`;
        affectedPods.push(targetPod.name);
        if (targetPod.node) affectedNodes.push(targetPod.node);

        // Check if Pod belonged to a ReplicaSet (self-healing reconciliation loop)
        if (targetPod.ownerRef && targetPod.ownerRef.kind === "ReplicaSet") {
          const parentRs = nextState.replicaSets.find(
            (rs) => rs.name === targetPod.ownerRef?.name
          );
          if (parentRs) {
            const randomSuffix = Math.random().toString(36).substring(2, 7);
            const newNode = schedulePodToNode(nextState.pods, nextState.nodes);
            const recreatedPod: Pod = {
              name: `${parentRs.name}-${randomSuffix}`,
              image: parentRs.image,
              status: "Running",
              node: newNode,
              ip: getPodIpForNode(newNode),
              restarts: 0,
              ownerRef: { kind: "ReplicaSet", name: parentRs.name },
              age: "1s",
              namespace: parentRs.namespace,
            };
            nextState.pods.push(recreatedPod);
            affectedPods.push(recreatedPod.name);
            if (!affectedNodes.includes(newNode)) affectedNodes.push(newNode);

            summary = `Pod '${targetPod.name}' was terminated. Because it is owned by ReplicaSet '${parentRs.name}', the ReplicaSet Controller immediately detected the missing replica (Reconciliation Loop) and spawned self-healing replacement '${recreatedPod.name}' on ${newNode}!`;
            controlPlaneEvents = [
              `kube-apiserver: Marked Pod '${targetPod.name}' for deletion in etcd.`,
              `kube-controller-manager (ReplicaSet Controller): Observed Actual Pods < Desired Replicas.`,
              `kube-controller-manager: Triggered self-healing loop and created replacement Pod '${recreatedPod.name}'.`,
              `kube-scheduler: Selected ${newNode} for replacement Pod.`,
            ];
            dataPlaneEvents = [
              `kubelet (${targetPod.node}): Sent SIGTERM signal to old container, released cgroups & network interface.`,
              `kubelet (${newNode}): Received replacement PodSpec and instructed containerd CRI to launch container.`,
            ];
            componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-controller-manager", "kube-scheduler", "kubelet", "CRI"];
            actionDescription = `Pod '${targetPod.name}' deleted → kubelet stopped container → ReplicaSet Controller triggered self-healing & created replacement '${recreatedPod.name}' on ${newNode}.`;
          }
        } else {
          summary = `Deleted standalone Pod '${targetPod.name}'. Because it has no controlling ReplicaSet/Deployment, it has permanently ceased to exist.`;
          controlPlaneEvents = [`kube-apiserver: Removed Pod '${targetPod.name}' record from etcd.`];
          dataPlaneEvents = [`kubelet (${targetPod.node}): Stopped container process, destroyed Linux namespaces, and returned IP to IPAM pool.`];
          componentFlow = ["Terminal", "kube-apiserver", "etcd", "kubelet", "CRI"];
          actionDescription = `API Server recorded deletion in etcd → kubelet stopped & cleaned up container → no controller exists to replace it.`;
        }
        nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
      }
    } else if (resource === "deployment" || resource === "deploy") {
      const dep = nextState.deployments.find((d) => d.name === name);
      if (!dep) {
        output = `Error from server (NotFound): deployments.apps "${name}" not found`;
      } else {
        nextState.deployments = nextState.deployments.filter((d) => d.name !== name);
        nextState.replicaSets = nextState.replicaSets.filter((rs) => !rs.name.startsWith(dep.name) && rs.ownerRef?.name !== dep.name);
        nextState.pods = nextState.pods.filter((p) => !p.name.startsWith(dep.name) && p.ownerRef?.name !== dep.name);
        output = `deployment.apps "${dep.name}" deleted`;
        nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
        summary = `Deleted Deployment '${dep.name}' and cascaded deletion to its managed ReplicaSets and Pods.`;
        controlPlaneEvents = [
          `kube-apiserver: Recorded deletion of Deployment '${dep.name}'.`,
          `kube-controller-manager: Cascaded deletion to child ReplicaSets and Pods.`,
        ];
        dataPlaneEvents = [`kubelets across worker nodes terminated all child containers.`];
        componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-controller-manager", "kubelet"];
        actionDescription = `Deployment '${dep.name}' deleted → Controller cascaded deletion to ReplicaSets & Pods → kubelets cleaned up containers.`;
      }
    } else if (resource === "replicaset" || resource === "rs") {
      const rs = nextState.replicaSets.find((r) => r.name === name);
      if (!rs) {
        output = `Error from server (NotFound): replicasets.apps "${name}" not found`;
      } else {
        nextState.replicaSets = nextState.replicaSets.filter((r) => r.name !== name);
        nextState.pods = nextState.pods.filter((p) => p.ownerRef?.name !== rs.name);
        output = `replicaset.apps "${rs.name}" deleted`;
        nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
        summary = `Deleted ReplicaSet '${rs.name}' and cascaded deletion to all its Pods.`;
        controlPlaneEvents = [`kube-apiserver: Deleted ReplicaSet '${rs.name}' from etcd.`];
        dataPlaneEvents = [`kubelet stopped all child container processes.`];
        componentFlow = ["Terminal", "kube-apiserver", "etcd", "kubelet"];
        actionDescription = `ReplicaSet '${rs.name}' deleted → kubelet terminated child Pods.`;
      }
    } else if (resource === "service" || resource === "svc") {
      nextState.services = nextState.services.filter((s) => s.name !== name);
      output = `service "${name}" deleted`;
      summary = `Deleted Service '${name}' and tore down virtual ClusterIP routing.`;
      controlPlaneEvents = [`kube-apiserver: Deleted Service '${name}' from etcd.`];
      dataPlaneEvents = [`kube-proxy: Flushed iptables/IPVS routing chains for Service ClusterIP.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-proxy"];
      actionDescription = `Service '${name}' deleted → kube-proxy flushed iptables rules.`;
    } else {
      output = `error: resource type "${resource}" not deletable in this simulated environment`;
      summary = `Resource deletion attempted.`;
    }
  }

  // 6. SCALE
  else if (verb === "scale") {
    const replicasFlag = flags.replicas ? parseInt(String(flags.replicas), 10) : 3;
    if (resource === "replicaset" || resource === "rs") {
      const rs = nextState.replicaSets.find((r) => r.name === name);
      if (!rs) {
        output = `Error from server (NotFound): replicasets.apps "${name}" not found`;
      } else {
        const oldReplicas = rs.desiredReplicas ?? rs.replicas ?? 1;
        rs.desiredReplicas = replicasFlag;
        rs.currentReplicas = replicasFlag;
        rs.readyReplicas = replicasFlag;

        const rsPods = nextState.pods.filter((p) => p.ownerRef?.name === rs.name);
        if (rsPods.length < replicasFlag) {
          const toAdd = replicasFlag - rsPods.length;
          for (let i = 0; i < toAdd; i++) {
            const node = schedulePodToNode(nextState.pods, nextState.nodes);
            const pName = `${rs.name}-${Math.random().toString(36).substring(2, 7)}`;
            nextState.pods.push({
              name: pName,
              image: rs.image,
              status: "Running",
              node,
              ip: getPodIpForNode(node),
              restarts: 0,
              ownerRef: { kind: "ReplicaSet", name: rs.name },
              age: "2s",
              namespace: rs.namespace,
            });
            affectedPods.push(pName);
            if (!affectedNodes.includes(node)) affectedNodes.push(node);
          }
        } else if (rsPods.length > replicasFlag) {
          const toRemove = rsPods.length - replicasFlag;
          const keepNames = rsPods.slice(0, rsPods.length - toRemove).map((p) => p.name);
          nextState.pods = nextState.pods.filter(
            (p) => p.ownerRef?.name !== rs.name || keepNames.includes(p.name)
          );
        }
        nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
        output = `replicaset.apps/${rs.name} scaled`;

        summary = `Scaled ReplicaSet '${rs.name}' from ${oldReplicas} to ${replicasFlag} replicas. The ReplicaSet controller detected the replica drift and scheduled new Pods across worker nodes.`;
        controlPlaneEvents = [
          `kube-apiserver: Updated desiredReplicas = ${replicasFlag} in etcd.`,
          `kube-controller-manager (ReplicaSet Controller): Detected delta and adjusted active Pod count.`,
          `kube-scheduler: Balanced pod placements between worker-node-1 and worker-node-2.`,
        ];
        dataPlaneEvents = [
          `kubelets on worker nodes spawned container runtimes and registered healthy statuses.`,
          `kube-proxy: Updated endpoint pools to include new Pod IPs.`,
        ];
        componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-controller-manager", "kube-scheduler", "kubelet"];
        actionDescription = `API Server updated desired replicas in etcd → Controller Manager reconciled replica drift → Scheduler distributed pods across worker nodes.`;
      }
    } else if (resource === "deployment" || resource === "deploy") {
      const dep = nextState.deployments.find((d) => d.name === name);
      if (!dep) {
        output = `Error from server (NotFound): deployments.apps "${name}" not found`;
      } else {
        dep.replicas = replicasFlag;
        dep.available = replicasFlag;
        dep.upToDate = replicasFlag;

        const activeRs = nextState.replicaSets.find((rs) => rs.ownerRef?.name === dep.name) || nextState.replicaSets[0];
        if (activeRs) {
          activeRs.desiredReplicas = replicasFlag;
          activeRs.currentReplicas = replicasFlag;
          activeRs.readyReplicas = replicasFlag;

          const currentPods = nextState.pods.filter((p) => p.ownerRef?.name === activeRs.name || p.name.startsWith(dep.name));
          if (currentPods.length < replicasFlag) {
            const toAdd = replicasFlag - currentPods.length;
            for (let i = 0; i < toAdd; i++) {
              const node = schedulePodToNode(nextState.pods, nextState.nodes);
              const pName = `${dep.name}-${Math.random().toString(36).substring(2, 7)}`;
              nextState.pods.push({
                name: pName,
                image: dep.image,
                status: "Running",
                node,
                ip: getPodIpForNode(node),
                restarts: 0,
                ownerRef: { kind: "ReplicaSet", name: activeRs.name },
                age: "2s",
                namespace: dep.namespace,
              });
              affectedPods.push(pName);
              if (!affectedNodes.includes(node)) affectedNodes.push(node);
            }
          }
        }
        nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
        output = `deployment.apps/${dep.name} scaled`;

        summary = `Scaled Deployment '${dep.name}' to ${replicasFlag} replicas. Deployment Controller scaled the underlying ReplicaSet and orchestrated balanced Pod distribution across worker nodes.`;
        controlPlaneEvents = [
          `kube-apiserver: Updated Deployment desired replicas in etcd.`,
          `kube-controller-manager: Deployment Controller instructed active ReplicaSet to scale.`,
          `kube-scheduler: Placed new Pod replicas across worker-node-1 and worker-node-2.`,
        ];
        dataPlaneEvents = [`Worker node kubelets launched new container sandboxes.`];
        componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-controller-manager", "kube-scheduler", "kubelet"];
        actionDescription = `Deployment Controller updated ReplicaSet desired replicas → Scheduler placed pods across worker nodes.`;
      }
    }
  }

  // 7. SET IMAGE
  else if (verb === "set" && (args[0] === "image" || resource === "deployment")) {
    const dep = nextState.deployments.find((d) => d.name === (name || "my-app"));
    if (!dep) {
      output = `Error from server (NotFound): deployments.apps "${name || "my-app"}" not found`;
    } else {
      const imageSpec = args.find((a) => a.includes("="));
      const newImage = imageSpec ? imageSpec.split("=")[1] : "nginx:1.19";
      dep.image = newImage;
      dep.revision += 1;

      const oldRsName = `${dep.name}-v${dep.revision - 1}`;
      const newRsName = `${dep.name}-v${dep.revision}`;

      const existingOldRs = nextState.replicaSets.find((r) => r.name.startsWith(dep.name));
      if (existingOldRs) {
        existingOldRs.desiredReplicas = 0;
        existingOldRs.currentReplicas = 0;
        existingOldRs.readyReplicas = 0;
      }

      const newRs: ReplicaSet = {
        name: newRsName,
        desiredReplicas: dep.replicas,
        currentReplicas: dep.replicas,
        readyReplicas: dep.replicas,
        image: newImage,
        ownerRef: { kind: "Deployment", name: dep.name },
        age: "1s",
        namespace: dep.namespace,
      };
      nextState.replicaSets.push(newRs);

      nextState.pods = nextState.pods.filter((p) => p.ownerRef?.kind !== "Deployment" && !p.name.startsWith(dep.name));
      for (let i = 0; i < dep.replicas; i++) {
        const node = schedulePodToNode(nextState.pods, nextState.nodes);
        const pName = `${newRsName}-${Math.random().toString(36).substring(2, 7)}`;
        nextState.pods.push({
          name: pName,
          image: newImage,
          status: "Running",
          node,
          ip: getPodIpForNode(node),
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: newRsName },
          age: "1s",
          namespace: dep.namespace,
        });
        affectedPods.push(pName);
        if (!affectedNodes.includes(node)) affectedNodes.push(node);
      }

      nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
      output = `deployment.apps/${dep.name} image updated`;

      summary = `Initiated Rolling Update on Deployment '${dep.name}' with new image '${newImage}'. Created new ReplicaSet '${newRsName}', progressively scheduled updated Pods, and scaled down '${oldRsName}'.`;
      controlPlaneEvents = [
        `kube-apiserver: Received image update and persisted Revision ${dep.revision} in etcd.`,
        `kube-controller-manager: Created new ReplicaSet '${newRsName}' with updated PodTemplate.`,
        `kube-controller-manager: Coordinated rolling update (maxSurge / maxUnavailable).`,
        `kube-scheduler: Distributed new Pods evenly between worker-node-1 and worker-node-2.`,
      ];
      dataPlaneEvents = [
        `kubelets pulled new image '${newImage}' and started updated container sandboxes.`,
        `kube-proxy: Dynamic Endpoints shifted traffic seamlessly with zero downtime.`,
      ];
      componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-controller-manager", "kube-scheduler", "kubelet"];
      actionDescription = `Deployment Controller created new ReplicaSet with updated image template → performed rolling update by orchestrating pod lifecycles.`;
    }
  }

  // 8. ROLLOUT
  else if (verb === "rollout") {
    const dep = nextState.deployments.find((d) => d.name === (name || "my-app"));
    if (!dep) {
      output = `Error from server (NotFound): deployments.apps "${name || "my-app"}" not found`;
    } else if (subVerb === "status") {
      summary = `Checked rollout progress for Deployment '${dep.name}'.`;
      controlPlaneEvents = [`kube-apiserver: Read live replica statuses from Deployment controller in etcd.`];
      dataPlaneEvents = [`All worker pods are passing readiness probes.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd"];
      actionDescription = `Deployment Controller reported all ${dep.replicas} replicas available and ready.`;
    } else if (subVerb === "history") {
      output = `deployment.apps/${dep.name} \nREVISION  CHANGE-CAUSE\n1         <none>\n2         <none>`;
      summary = `Retrieved revision history for Deployment '${dep.name}'.`;
      controlPlaneEvents = [`kube-apiserver: Retrieved ReplicaSet generation history from etcd.`];
      dataPlaneEvents = [`No data plane changes.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd"];
      actionDescription = `API Server fetched ReplicaSet revision histories.`;
    } else if (subVerb === "undo") {
      dep.revision += 1;
      dep.image = "nginx:latest";
      nextState.replicaSets.forEach((rs) => {
        if (rs.name.includes("v2") || rs.image !== "nginx:latest") {
          rs.desiredReplicas = 0;
          rs.currentReplicas = 0;
          rs.readyReplicas = 0;
        } else {
          rs.desiredReplicas = dep.replicas;
          rs.currentReplicas = dep.replicas;
          rs.readyReplicas = dep.replicas;
        }
      });
      nextState.pods = [];
      for (let i = 0; i < dep.replicas; i++) {
        const node = schedulePodToNode(nextState.pods, nextState.nodes);
        const pName = `${dep.name}-v1-${Math.random().toString(36).substring(2, 7)}`;
        nextState.pods.push({
          name: pName,
          image: "nginx:latest",
          status: "Running",
          node,
          ip: getPodIpForNode(node),
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: `${dep.name}-v1` },
          age: "2s",
          namespace: dep.namespace,
        });
        affectedPods.push(pName);
        if (!affectedNodes.includes(node)) affectedNodes.push(node);
      }
      nextState.nodes = syncNodes(nextState.nodes, nextState.pods);
      output = `deployment.apps/${dep.name} rolled back`;

      summary = `Rolled back Deployment '${dep.name}' to the previous stable revision. Scaled up old stable ReplicaSet and retired broken revision with zero application downtime.`;
      controlPlaneEvents = [
        `kube-apiserver: Updated Deployment active revision in etcd.`,
        `kube-controller-manager: Scaled stable ReplicaSet '${dep.name}-v1' back to ${dep.replicas} replicas.`,
        `kube-scheduler: Re-scheduled restored Pods across worker nodes.`,
      ];
      dataPlaneEvents = [`kubelets launched previous container image and kube-proxy redirected traffic.`];
      componentFlow = ["Terminal", "kube-apiserver", "etcd", "kube-controller-manager", "kubelet"];
      actionDescription = `Deployment Controller read revision history from etcd → restored previous ReplicaSet template → reconciled pod counts.`;
    }
  }

  // 9. LOGS
  else if (verb === "logs") {
    const p = nextState.pods.find((pod) => pod.name === name) || nextState.pods[0];
    if (!p) {
      output = `Error from server (NotFound): pods "${name}" not found`;
    } else {
      output = `[simulated stdout logs for pod/${p.name} on ${p.node || "worker-node-1"}]
2026/08/28 12:00:00 [notice] 1#1: using the "epoll" event method
2026/08/28 12:00:00 [notice] 1#1: nginx/1.25.2
2026/08/28 12:00:00 [notice] 1#1: start worker processes
2026/08/28 12:05:00 [info] 28#28: *1 GET / HTTP/1.1" 200 615 "-" "kube-probe/1.28"
2026/08/28 12:05:15 [info] 28#28: *2 GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.28"`;
    }
    summary = `Retrieved container stdout/stderr log stream for Pod '${p?.name || name}'.`;
    controlPlaneEvents = [`kube-apiserver: Proxied streaming request to worker node kubelet on port 10250.`];
    dataPlaneEvents = [`kubelet: Read container log files from /var/log/pods/ on host filesystem and streamed back to API server.`];
    componentFlow = ["Terminal", "kube-apiserver", "kubelet", "CRI"];
    actionDescription = `API Server opened streaming connection to kubelet on worker node → kubelet retrieved stdout/stderr logs directly from CRI container runtime.`;
  }

  // 10. EVENTS
  else if (verb === "events") {
    output = `LAST SEEN   TYPE      REASON      OBJECT               MESSAGE
12s         Normal    Scheduled   pod/nginx            Successfully assigned default/nginx to worker-node-1
11s         Normal    Pulling     pod/nginx            Pulling image "nginx:latest"
10s         Normal    Pulled      pod/nginx            Successfully pulled image "nginx:latest"
10s         Normal    Created     pod/nginx            Created container nginx
9s          Normal    Started     pod/nginx            Started container nginx
5s          Normal    ScalingReplicaSet deployment/app Scaled up replicaSet app-v1 to 3`;
    summary = `Retrieved cluster lifecycle and controller event logs from etcd.`;
    controlPlaneEvents = [`kube-apiserver: Queried chronological cluster Event objects from etcd.`];
    dataPlaneEvents = [`Events reflect historical state changes generated by kubelet and controllers.`];
    componentFlow = ["Terminal", "kube-apiserver", "etcd"];
    actionDescription = `API Server retrieved recorded cluster lifecycle and controller events from etcd.`;
  } else {
    output = `unknown command: kubectl ${verb}`;
    summary = `Unknown command 'kubectl ${verb}'.`;
  }

  // ActionImpact object
  const actionImpact: ActionImpact = {
    userAction: input,
    summary,
    controlPlaneEvents,
    dataPlaneEvents,
    affectedNodes: affectedNodes.length > 0 ? affectedNodes : ["control-plane"],
    affectedPods,
    timestamp: Date.now(),
  };
  nextState.lastActionImpact = actionImpact;

  // Validate step completion
  if (currentStep && currentStep.type === "challenge" && currentStep.expected) {
    const exp = currentStep.expected;
    if (exp.verb.toLowerCase() === verb.toLowerCase() || (exp.verb === "apply" && verb === "create")) {
      if (!exp.resource || (resource && exp.resource.toLowerCase() === resource.toLowerCase()) || (verb === "apply" && file)) {
        if (
          !exp.name ||
          (name && name.toLowerCase().includes(exp.name.toLowerCase())) ||
          verb === "delete" ||
          verb === "set" ||
          verb === "rollout" ||
          verb === "logs" ||
          verb === "apply" ||
          verb === "create"
        ) {
          matchedChallenge = true;
        }
      }
    }
  }

  return {
    output,
    newState: nextState,
    isCorrect: matchedChallenge,
    componentFlow,
    actionDescription,
    actionImpact,
  };
}

function handleShellCommand(
  input: string,
  parsed: ParsedCommand,
  state: ClusterState,
  currentStep?: LessonStep
): ExecutionResult {
  let output = "";
  let openVim: string | undefined;
  const { verb, file, redirectToFile, args } = parsed;
  const fileName = file || args[0];

  const nextFiles = { ...state.files };

  if (verb === "ls") {
    const fileList = Object.keys(nextFiles);
    output = fileList.length > 0 ? fileList.join("  ") : "(no files in workspace)";
  } else if (verb === "cat") {
    if (!fileName) {
      output = `cat: missing operand`;
    } else if (nextFiles[fileName] !== undefined) {
      output = nextFiles[fileName].trimEnd();
    } else {
      output = `cat: ${fileName}: No such file or directory`;
    }
  } else if (verb === "rm") {
    if (!fileName) {
      output = `rm: missing operand`;
    } else if (nextFiles[fileName] !== undefined) {
      delete nextFiles[fileName];
      output = "";
    } else {
      output = `rm: cannot remove '${fileName}': No such file or directory`;
    }
  } else if (verb === "vim" || verb === "vi") {
    if (!fileName) {
      output = `~ [vim: new file] ~\n(Simulated editor: specify a file name to create or view)`;
    } else if (nextFiles[fileName] !== undefined) {
      openVim = fileName;
      output = `~ [vim: ${fileName}] ~
${nextFiles[fileName].trimEnd()}
~
~ (Simulated read-only vim view. File is stored in workspace virtual filesystem. Apply with 'kubectl apply -f ${fileName}')`;
    } else {
      openVim = fileName;
      nextFiles[fileName] = `apiVersion: v1\nkind: Pod\nmetadata:\n  name: my-pod\nspec:\n  containers:\n  - name: my-container\n    image: nginx:latest\n`;
      output = `~ [vim: ${fileName} [New File]] ~
${nextFiles[fileName].trimEnd()}
~
~ (Simulated editor: created new template file '${fileName}' in virtual filesystem. Apply with 'kubectl apply -f ${fileName}')`;
    }
  } else if (verb === "touch") {
    if (fileName && nextFiles[fileName] === undefined) {
      nextFiles[fileName] = "";
    }
    output = "";
  } else if (verb === "echo") {
    const content = args.join(" ");
    if (redirectToFile) {
      nextFiles[redirectToFile] = content;
      output = "";
    } else {
      output = content;
    }
  } else if (verb === "pwd") {
    output = "/root";
  }

  const nextState: ClusterState = {
    ...state,
    files: nextFiles,
  };

  const actionImpact: ActionImpact = {
    userAction: input,
    summary: `Executed local utility command '${verb}${fileName ? ` ${fileName}` : ""}' in the workspace shell environment.`,
    controlPlaneEvents: [
      `Local shell session executed command without issuing HTTP calls to the Kubernetes Control Plane.`,
    ],
    dataPlaneEvents: [
      `Workspace local virtual filesystem updated.`,
    ],
    affectedNodes: [],
    affectedPods: [],
    timestamp: Date.now(),
  };
  nextState.lastActionImpact = actionImpact;

  let matchedChallenge = false;
  if (currentStep && currentStep.type === "challenge" && currentStep.expected) {
    const exp = currentStep.expected;
    if (exp.verb.toLowerCase() === verb.toLowerCase()) {
      matchedChallenge = true;
    }
  }

  return {
    output,
    newState: nextState,
    isCorrect: matchedChallenge,
    componentFlow: ["Terminal"],
    actionDescription: `Executed local shell utility '${verb}'.`,
    actionImpact,
    openVim,
  };
}
