import {
  addNode,
  createConfigMap,
  createDeployment,
  createPersistentVolumeClaim,
  createPod,
  createSecret,
  createService,
  endpointsOf,
  formatAge,
  isReady,
  listPath,
  matchesSelector,
  nodeFits,
  podEnv,
  podsOf,
  readPath,
  recordEvent,
  replicaSetsOf,
  templateHash,
  writePath,
} from "./cluster-state";
import { applyDocument } from "./manifest";
import type {
  ClusterState,
  CommandResult,
  Deployment,
  Labels,
  ParsedCommand,
  Pod,
  Service,
} from "./types";

/**
 * Executes the slice of kubectl (plus curl and cat) that the lessons need.
 * Every command mutates `state` in place and returns terminal output.
 */

export interface ManifestFile {
  raw: string;
  doc: Record<string, unknown>;
}

export interface ExecContext {
  files: Record<string, ManifestFile>;
}

const EMPTY_CONTEXT: ExecContext = { files: {} };

/* ------------------------------------------------------------------ */
/* Output helpers                                                      */
/* ------------------------------------------------------------------ */

function table(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column === columns - 1 ? cell : (cell ?? "").padEnd(widths[column] + 3),
      )
      .join("")
      .trimEnd(),
  );
}

function ok(output: string[]): CommandResult {
  return { output, isError: false };
}

function err(message: string): CommandResult {
  return { output: [`error: ${message}`], isError: true };
}

const NOTHING = "No resources found in default namespace.";

function labelString(labels: Labels): string {
  const entries = Object.entries(labels);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(",") : "<none>";
}

function parseLabels(value: unknown): Labels | undefined {
  if (typeof value !== "string") return undefined;
  const labels: Labels = {};
  for (const pair of value.split(",")) {
    const [key, val] = pair.split("=");
    if (key && val !== undefined) labels[key.trim()] = val.trim();
  }
  return Object.keys(labels).length ? labels : undefined;
}

function podStatus(pod: Pod): string {
  if (pod.phase === "Pending" && pod.reason?.startsWith("CreateContainerConfigError")) {
    return "CreateContainerConfigError";
  }
  return pod.phase;
}

/* ------------------------------------------------------------------ */
/* get                                                                 */
/* ------------------------------------------------------------------ */

function getPods(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const selector = parseLabels(parsed.flags.selector);
  let pods = state.pods;
  if (selector) pods = pods.filter((pod) => matchesSelector(pod.labels, selector));
  if (parsed.names.length) pods = pods.filter((pod) => parsed.names.includes(pod.name));
  if (pods.length === 0) return ok([NOTHING]);

  const wide = parsed.flags.output === "wide";
  const showLabels = parsed.flags["show-labels"] === true;
  const header = ["NAME", "READY", "STATUS", "RESTARTS", "AGE"];
  if (wide) header.push("IP", "NODE", "IMAGE");
  if (showLabels) header.push("LABELS");

  const rows = [header];
  for (const pod of pods) {
    const row = [
      pod.name,
      pod.phase === "Completed" ? "0/1" : isReady(pod) ? "1/1" : "0/1",
      podStatus(pod),
      String(pod.restarts),
      formatAge(pod.age),
    ];
    if (wide) row.push(pod.ip, pod.node ?? "<none>", pod.image);
    if (showLabels) row.push(labelString(pod.labels));
    rows.push(row);
  }
  return ok(table(rows));
}

function getReplicaSets(state: ClusterState, parsed: ParsedCommand): CommandResult {
  let sets = state.replicaSets;
  if (parsed.names.length) sets = sets.filter((rs) => parsed.names.includes(rs.name));
  if (sets.length === 0) return ok([NOTHING]);

  const rows = [["NAME", "DESIRED", "CURRENT", "READY", "AGE"]];
  for (const rs of sets) {
    const pods = podsOf(state, rs);
    rows.push([
      rs.name,
      String(rs.replicas),
      String(pods.length),
      String(pods.filter(isReady).length),
      formatAge(rs.age),
    ]);
  }
  return ok(table(rows));
}

function getDeployments(state: ClusterState, parsed: ParsedCommand): CommandResult {
  let deployments = state.deployments;
  if (parsed.names.length) {
    deployments = deployments.filter((item) => parsed.names.includes(item.name));
  }
  if (deployments.length === 0) return ok([NOTHING]);

  const rows = [["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"]];
  for (const deployment of deployments) {
    const sets = replicaSetsOf(state, deployment);
    const wanted = templateHash(deployment.template);
    const current = sets.find((rs) => rs.podTemplateHash === wanted);
    const ready = sets.flatMap((rs) => podsOf(state, rs)).filter(isReady).length;
    rows.push([
      deployment.name,
      `${ready}/${deployment.replicas}`,
      String(current ? podsOf(state, current).length : 0),
      String(ready),
      formatAge(deployment.age),
    ]);
  }
  return ok(table(rows));
}

function getDaemonSets(state: ClusterState): CommandResult {
  if (state.daemonSets.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "DESIRED", "CURRENT", "READY", "NODE SELECTOR", "AGE"]];
  for (const daemonSet of state.daemonSets) {
    const eligible = state.nodes.filter((node) => nodeFits(node, daemonSet.template)).length;
    const pods = podsOf(state, daemonSet);
    rows.push([
      daemonSet.name,
      String(eligible),
      String(pods.length),
      String(pods.filter(isReady).length),
      labelString(daemonSet.template.nodeSelector ?? {}),
      formatAge(daemonSet.age),
    ]);
  }
  return ok(table(rows));
}

function getStatefulSets(state: ClusterState): CommandResult {
  if (state.statefulSets.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "READY", "AGE"]];
  for (const set of state.statefulSets) {
    const ready = podsOf(state, set).filter(isReady).length;
    rows.push([set.name, `${ready}/${set.replicas}`, formatAge(set.age)]);
  }
  return ok(table(rows));
}

function getJobs(state: ClusterState): CommandResult {
  if (state.jobs.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "COMPLETIONS", "AGE"]];
  for (const job of state.jobs) {
    rows.push([job.name, `${job.succeeded}/${job.completions}`, formatAge(job.age)]);
  }
  return ok(table(rows));
}

function getCronJobs(state: ClusterState): CommandResult {
  if (state.cronJobs.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "SCHEDULE", "SUSPEND", "LAST SCHEDULE", "AGE"]];
  for (const cronJob of state.cronJobs) {
    rows.push([
      cronJob.name,
      cronJob.schedule,
      String(cronJob.suspend),
      cronJob.lastScheduleAt === undefined
        ? "<none>"
        : formatAge(state.clock - cronJob.lastScheduleAt),
      formatAge(cronJob.age),
    ]);
  }
  return ok(table(rows));
}

function getServices(state: ClusterState): CommandResult {
  if (state.services.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"]];
  for (const service of state.services) {
    const ports = service.nodePort
      ? `${service.port}:${service.nodePort}/TCP`
      : `${service.port}/TCP`;
    rows.push([
      service.name,
      service.type,
      service.clusterIP,
      service.externalIP ?? "<none>",
      ports,
      formatAge(service.age),
    ]);
  }
  return ok(table(rows));
}

function getEndpoints(state: ClusterState): CommandResult {
  if (state.services.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "ENDPOINTS", "AGE"]];
  for (const service of state.services) {
    const endpoints = endpointsOf(state, service);
    rows.push([
      service.name,
      endpoints.length
        ? endpoints.map((pod) => `${pod.ip}:${service.targetPort}`).join(",")
        : "<none>",
      formatAge(service.age),
    ]);
  }
  return ok(table(rows));
}

function getIngresses(state: ClusterState): CommandResult {
  if (state.ingresses.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"]];
  for (const ingress of state.ingresses) {
    rows.push([
      ingress.name,
      ingress.className ?? "<none>",
      [...new Set(ingress.rules.map((rule) => rule.host ?? "*"))].join(","),
      ingress.address ?? "",
      "80",
      formatAge(ingress.age),
    ]);
  }
  return ok(table(rows));
}

function getConfigMaps(state: ClusterState): CommandResult {
  if (state.configMaps.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "DATA", "AGE"]];
  for (const configMap of state.configMaps) {
    rows.push([configMap.name, String(Object.keys(configMap.data).length), formatAge(configMap.age)]);
  }
  return ok(table(rows));
}

function getSecrets(state: ClusterState): CommandResult {
  if (state.secrets.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "TYPE", "DATA", "AGE"]];
  for (const secret of state.secrets) {
    rows.push([
      secret.name,
      secret.type,
      String(Object.keys(secret.data).length),
      formatAge(secret.age),
    ]);
  }
  return ok(table(rows));
}

function getStorageClasses(state: ClusterState): CommandResult {
  if (state.storageClasses.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "PROVISIONER", "AGE"]];
  for (const storageClass of state.storageClasses) {
    rows.push([
      storageClass.isDefault ? `${storageClass.name} (default)` : storageClass.name,
      storageClass.provisioner,
      formatAge(storageClass.age),
    ]);
  }
  return ok(table(rows));
}

function getPersistentVolumes(state: ClusterState): CommandResult {
  if (state.persistentVolumes.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "CAPACITY", "ACCESS MODES", "STATUS", "CLAIM", "STORAGECLASS", "AGE"]];
  for (const volume of state.persistentVolumes) {
    rows.push([
      volume.name,
      `${volume.capacityGi}Gi`,
      volume.accessModes.map(shortAccessMode).join(","),
      volume.status,
      volume.claim ? `default/${volume.claim}` : "",
      volume.storageClass,
      formatAge(volume.age),
    ]);
  }
  return ok(table(rows));
}

function shortAccessMode(mode: string): string {
  return mode === "ReadWriteOnce" ? "RWO" : mode === "ReadWriteMany" ? "RWX" : "ROX";
}

function getPersistentVolumeClaims(state: ClusterState): CommandResult {
  if (state.persistentVolumeClaims.length === 0) return ok([NOTHING]);
  const rows = [["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "AGE"]];
  for (const claim of state.persistentVolumeClaims) {
    rows.push([
      claim.name,
      claim.status,
      claim.volumeName ?? "",
      claim.status === "Bound" ? `${claim.requestGi}Gi` : "",
      claim.accessModes.map(shortAccessMode).join(","),
      claim.storageClass ?? "<none>",
      formatAge(claim.age),
    ]);
  }
  return ok(table(rows));
}

function getNodes(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const wide = parsed.flags.output === "wide" || parsed.flags["show-labels"] === true;
  const rows = [["NAME", "STATUS", "ROLES", "AGE", "VERSION", ...(wide ? ["LABELS"] : [])]];
  for (const node of state.nodes) {
    rows.push([
      node.name,
      node.ready ? "Ready" : "NotReady",
      node.role === "control-plane" ? "control-plane" : "<none>",
      formatAge(state.clock + 240),
      "v1.30.2",
      ...(wide ? [labelString(node.labels)] : []),
    ]);
  }
  return ok(table(rows));
}

function getEvents(state: ClusterState): CommandResult {
  if (state.events.length === 0) return ok(["No events."]);
  const rows = [["TYPE", "REASON", "OBJECT", "MESSAGE"]];
  for (const event of state.events.slice(-16)) {
    rows.push([event.type, event.reason, event.object, event.message]);
  }
  return ok(table(rows));
}

function getAll(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const output: string[] = [];
  const sections: [unknown[], () => CommandResult][] = [
    [state.pods, () => getPods(state, parsed)],
    [state.services, () => getServices(state)],
    [state.deployments, () => getDeployments(state, parsed)],
    [state.statefulSets, () => getStatefulSets(state)],
    [state.daemonSets, () => getDaemonSets(state)],
    [state.replicaSets, () => getReplicaSets(state, parsed)],
    [state.jobs, () => getJobs(state)],
    [state.cronJobs, () => getCronJobs(state)],
  ];
  for (const [collection, render] of sections) {
    if (collection.length === 0) continue;
    if (output.length) output.push("");
    output.push(...render().output);
  }
  return ok(output.length ? output : [NOTHING]);
}

/* ------------------------------------------------------------------ */
/* describe                                                            */
/* ------------------------------------------------------------------ */

function describePod(state: ClusterState, name: string): CommandResult {
  const pod = state.pods.find((candidate) => candidate.name === name);
  if (!pod) return err(`pods "${name}" not found`);

  const lines = [
    `Name:             ${pod.name}`,
    `Namespace:        default`,
    `Node:             ${pod.node ?? "<none>"}`,
    `Labels:           ${labelString(pod.labels)}`,
    `Status:           ${podStatus(pod)}`,
    `Reason:           ${pod.reason ?? "<none>"}`,
    `IP:               ${pod.ip}`,
    `Controlled By:    ${pod.ownerName ? `${pod.ownerKind}/${pod.ownerName}` : "<none>"}`,
    "Containers:",
    "  app:",
    `    Image:          ${pod.image}`,
    `    Ready:          ${isReady(pod)}`,
    `    Restart Count:  ${pod.restarts}`,
  ];

  for (const probe of pod.template.probes ?? []) {
    lines.push(`    ${probe.kind} probe: http-get http://:80${probe.path}`);
  }
  for (const mount of pod.template.mounts ?? []) {
    const volume = (pod.template.volumes ?? []).find((item) => item.name === mount.name);
    lines.push(`    Mount:          ${mount.mountPath} from ${mount.name} (${volume?.kind})`);
  }
  for (const ref of pod.template.envFrom ?? []) {
    lines.push(`    EnvFrom:        ${ref.kind} ${ref.name}`);
  }
  if (pod.template.nodeSelector) {
    lines.push(`Node-Selectors:   ${labelString(pod.template.nodeSelector)}`);
  }
  if (pod.template.tolerations?.length) {
    lines.push(
      `Tolerations:      ${pod.template.tolerations
        .map((toleration) => `${toleration.key}=${toleration.value ?? ""}:${toleration.effect ?? "*"}`)
        .join(", ")}`,
    );
  }
  if (!pod.ownerName) {
    lines.push("", "Note:  This Pod has no controller. If it dies, nothing will recreate it.");
  }

  const events = state.events.filter((event) => event.object === `pod/${pod.name}`);
  lines.push("", "Events:");
  if (events.length === 0) lines.push("  <none>");
  else for (const event of events.slice(-6)) {
    lines.push(`  ${event.type}  ${event.reason}  ${event.message}`);
  }
  return ok(lines);
}

function describeDeployment(state: ClusterState, name: string): CommandResult {
  const deployment = state.deployments.find((item) => item.name === name);
  if (!deployment) return err(`deployments "${name}" not found`);
  const sets = replicaSetsOf(state, deployment);
  const wanted = templateHash(deployment.template);
  const current = sets.find((rs) => rs.podTemplateHash === wanted);
  const lines = [
    `Name:                   ${deployment.name}`,
    `Selector:               ${labelString(deployment.selector)}`,
    `Replicas:               ${deployment.replicas} desired`,
    `StrategyType:           RollingUpdate`,
    `RollingUpdateStrategy:  1 max unavailable, 1 max surge`,
    `Image:                  ${deployment.template.image}`,
    `Revision:               ${deployment.revision}`,
    `NewReplicaSet:          ${current ? `${current.name} (${current.replicas} replicas)` : "<none>"}`,
  ];
  const old = sets.filter((rs) => rs !== current);
  if (old.length) {
    lines.push(
      `OldReplicaSets:         ${old.map((rs) => `${rs.name} (${rs.replicas} replicas)`).join(", ")}`,
    );
  }
  return ok(lines);
}

function describeService(state: ClusterState, name: string): CommandResult {
  const service = state.services.find((item) => item.name === name);
  if (!service) return err(`services "${name}" not found`);
  const endpoints = endpointsOf(state, service);
  const lines = [
    `Name:              ${service.name}`,
    `Type:              ${service.type}`,
    `Selector:          ${labelString(service.selector)}`,
    `IP:                ${service.clusterIP}`,
    `Port:              ${service.port}/TCP`,
    `TargetPort:        ${service.targetPort}/TCP`,
  ];
  if (service.nodePort) lines.push(`NodePort:          ${service.nodePort}/TCP`);
  lines.push(
    `Endpoints:         ${
      endpoints.length ? endpoints.map((pod) => `${pod.ip}:${service.targetPort}`).join(",") : "<none>"
    }`,
  );
  if (endpoints.length === 0) {
    lines.push(
      "",
      "Note:  No Pod is both matching the selector and Ready, so this Service routes nowhere.",
    );
  }
  return ok(lines);
}

function describeNode(state: ClusterState, name: string): CommandResult {
  const node = state.nodes.find((item) => item.name === name);
  if (!node) return err(`nodes "${name}" not found`);
  const pods = state.pods.filter((pod) => pod.node === node.name);
  return ok([
    `Name:               ${node.name}`,
    `Roles:              ${node.role}`,
    `Labels:             ${labelString(node.labels)}`,
    `Taints:             ${
      node.taints.length
        ? node.taints.map((taint) => `${taint.key}=${taint.value}:${taint.effect}`).join(", ")
        : "<none>"
    }`,
    `Ready:              ${node.ready}`,
    `Non-terminated Pods: ${pods.length}`,
    ...pods.map((pod) => `  ${pod.name}  ${pod.phase}`),
  ]);
}

function describeClaim(state: ClusterState, name: string): CommandResult {
  const claim = state.persistentVolumeClaims.find((item) => item.name === name);
  if (!claim) return err(`persistentvolumeclaims "${name}" not found`);
  return ok([
    `Name:          ${claim.name}`,
    `Status:        ${claim.status}`,
    `Volume:        ${claim.volumeName ?? "<none>"}`,
    `StorageClass:  ${claim.storageClass ?? "<none>"}`,
    `Capacity:      ${claim.requestGi}Gi requested`,
    `Access Modes:  ${claim.accessModes.join(",")}`,
    ...(claim.reason ? ["", `Warning  FailedBinding  ${claim.reason}`] : []),
  ]);
}

function describeIngress(state: ClusterState, name: string): CommandResult {
  const ingress = state.ingresses.find((item) => item.name === name);
  if (!ingress) return err(`ingresses "${name}" not found`);
  const lines = [
    `Name:             ${ingress.name}`,
    `Class:            ${ingress.className ?? "<none>"}`,
    `Address:          ${ingress.address ?? "<pending>"}`,
    "Rules:",
  ];
  for (const rule of ingress.rules) {
    const service = state.services.find((item) => item.name === rule.service);
    const endpoints = service ? endpointsOf(state, service).length : 0;
    lines.push(
      `  ${rule.host ?? "*"}${rule.path}  ->  ${rule.service}:${rule.port}  ${
        service ? `(${endpoints} endpoints)` : "(service not found!)"
      }`,
    );
  }
  return ok(lines);
}

function describeSimple(
  state: ClusterState,
  resource: string,
  name: string,
): CommandResult | undefined {
  if (resource === "replicasets") {
    const rs = state.replicaSets.find((item) => item.name === name);
    if (!rs) return err(`replicasets "${name}" not found`);
    const pods = podsOf(state, rs);
    return ok([
      `Name:           ${rs.name}`,
      `Selector:       ${labelString(rs.selector)}`,
      `Controlled By:  ${rs.ownerName ? `Deployment/${rs.ownerName}` : "<none>"}`,
      `Replicas:       ${pods.length} current / ${rs.replicas} desired`,
      `Image:          ${rs.template.image}`,
    ]);
  }
  if (resource === "configmaps") {
    const configMap = state.configMaps.find((item) => item.name === name);
    if (!configMap) return err(`configmaps "${name}" not found`);
    return ok([
      `Name:  ${configMap.name}`,
      "Data",
      "====",
      ...Object.entries(configMap.data).map(([key, value]) => `${key}:\n----\n${value}\n`),
    ]);
  }
  if (resource === "secrets") {
    const secret = state.secrets.find((item) => item.name === name);
    if (!secret) return err(`secrets "${name}" not found`);
    return ok([
      `Name:  ${secret.name}`,
      `Type:  ${secret.type}`,
      "Data",
      "====",
      ...Object.entries(secret.data).map(([key, value]) => `${key}:  ${value.length} bytes`),
      "",
      "Note:  describe never prints Secret values. `kubectl get secret -o yaml` shows base64.",
    ]);
  }
  if (resource === "statefulsets") {
    const set = state.statefulSets.find((item) => item.name === name);
    if (!set) return err(`statefulsets "${name}" not found`);
    return ok([
      `Name:               ${set.name}`,
      `Replicas:           ${set.replicas} desired`,
      `Service Name:       ${set.serviceName}`,
      `Image:              ${set.template.image}`,
      `VolumeClaimTemplate: ${
        set.volumeClaimTemplate
          ? `${set.volumeClaimTemplate.name} (${set.volumeClaimTemplate.requestGi}Gi)`
          : "<none>"
      }`,
      `Pods:               ${podsOf(state, set)
        .map((pod) => pod.name)
        .join(", ")}`,
    ]);
  }
  if (resource === "daemonsets") {
    const daemonSet = state.daemonSets.find((item) => item.name === name);
    if (!daemonSet) return err(`daemonsets "${name}" not found`);
    const pods = podsOf(state, daemonSet);
    return ok([
      `Name:           ${daemonSet.name}`,
      `Selector:       ${labelString(daemonSet.selector)}`,
      `Node-Selector:  ${labelString(daemonSet.template.nodeSelector ?? {})}`,
      `Image:          ${daemonSet.template.image}`,
      `Pods:           ${pods.map((pod) => `${pod.name}@${pod.node}`).join(", ") || "<none>"}`,
    ]);
  }
  if (resource === "jobs") {
    const job = state.jobs.find((item) => item.name === name);
    if (!job) return err(`jobs "${name}" not found`);
    return ok([
      `Name:            ${job.name}`,
      `Completions:     ${job.succeeded}/${job.completions}`,
      `Parallelism:     ${job.parallelism}`,
      `Backoff Limit:   ${job.backoffLimit}`,
      `Failed:          ${job.failed}`,
      `Pods:            ${state.pods
        .filter((pod) => pod.ownerName === job.name)
        .map((pod) => `${pod.name} (${pod.phase})`)
        .join(", ")}`,
    ]);
  }
  if (resource === "persistentvolumes") {
    const volume = state.persistentVolumes.find((item) => item.name === name);
    if (!volume) return err(`persistentvolumes "${name}" not found`);
    return ok([
      `Name:          ${volume.name}`,
      `Status:        ${volume.status}`,
      `Claim:         ${volume.claim ?? "<none>"}`,
      `Capacity:      ${volume.capacityGi}Gi`,
      `Access Modes:  ${volume.accessModes.join(",")}`,
      `StorageClass:  ${volume.storageClass}`,
    ]);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function runPod(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const name = parsed.names[0];
  if (!name) return err("NAME is required for `kubectl run`");
  const image = parsed.flags.image;
  if (typeof image !== "string") return err("you must specify an image, e.g. --image=nginx:1.21");
  if (state.pods.some((pod) => pod.name === name)) return err(`pods "${name}" already exists`);

  const labels = parseLabels(parsed.flags.labels) ?? { run: name };
  createPod(state, { name, template: { image, labels } });
  return ok([`pod/${name} created`]);
}

function createResource(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const secretTypes = new Set(["generic", "tls", "docker-registry"]);
  const names = parsed.names.filter((token) => !secretTypes.has(token));
  const name = names[0];
  if (!name) return err("NAME is required");

  if (parsed.resource === "deployments") {
    const image = parsed.flags.image;
    if (typeof image !== "string") return err("you must specify --image");
    if (state.deployments.some((item) => item.name === name)) {
      return err(`deployments "${name}" already exists`);
    }
    createDeployment(state, {
      name,
      replicas: Number(parsed.flags.replicas ?? 1),
      template: { image, labels: { app: name } },
    });
    return ok([`deployment.apps/${name} created`]);
  }

  if (parsed.subcommand === "configmap" || parsed.resource === "configmaps") {
    const data = literalData(parsed);
    if (!data) return err("use --from-literal=key=value");
    if (state.configMaps.some((item) => item.name === name)) {
      return err(`configmaps "${name}" already exists`);
    }
    createConfigMap(state, name, data);
    return ok([`configmap/${name} created`]);
  }

  if (parsed.subcommand === "secret" || parsed.resource === "secrets") {
    const data = literalData(parsed);
    if (!data) return err("use --from-literal=key=value");
    if (state.secrets.some((item) => item.name === name)) {
      return err(`secrets "${name}" already exists`);
    }
    createSecret(state, name, data);
    return ok([`secret/${name} created`]);
  }

  return err("this lab supports `create deployment`, `create configmap` and `create secret generic`");
}

function literalData(parsed: ParsedCommand): Record<string, string> | undefined {
  const literals = parsed.repeated["from-literal"];
  if (!literals?.length) return undefined;
  const data: Record<string, string> = {};
  for (const literal of literals) {
    const [key, ...rest] = literal.split("=");
    if (key) data[key] = rest.join("=");
  }
  return data;
}

function expose(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const target = parsed.names[0];
  if (!target) return err("NAME is required for `kubectl expose`");

  let selector: Labels | undefined;
  if (parsed.resource === "deployments") {
    selector = state.deployments.find((item) => item.name === target)?.selector;
    if (!selector) return err(`deployments "${target}" not found`);
  } else if (parsed.resource === "pods") {
    selector = state.pods.find((pod) => pod.name === target)?.labels;
    if (!selector) return err(`pods "${target}" not found`);
  } else {
    return err("expose a deployment or a pod in this lab");
  }

  const name = typeof parsed.flags.name === "string" ? parsed.flags.name : target;
  if (state.services.some((item) => item.name === name)) {
    return err(`services "${name}" already exists`);
  }
  const port = Number(parsed.flags.port ?? 80);
  const service = createService(state, {
    name,
    type: (parsed.flags.type as Service["type"]) ?? "ClusterIP",
    selector,
    port,
    targetPort: Number(parsed.flags["target-port"] ?? port),
    nodePort: parsed.flags["node-port"] ? Number(parsed.flags["node-port"]) : undefined,
  });
  return ok([`service/${service.name} exposed`]);
}

function deleteResource(state: ClusterState, parsed: ParsedCommand): CommandResult {
  if (!parsed.resource) return err("you must specify a resource type, e.g. pod");
  if (parsed.names.length === 0) return err("resource name is required");

  const messages: string[] = [];
  for (const name of parsed.names) {
    switch (parsed.resource) {
      case "pods": {
        const pod = state.pods.find((candidate) => candidate.name === name);
        if (!pod) return err(`pods "${name}" not found`);
        pod.phase = "Terminating";
        recordEvent(state, "Normal", "Killing", `pod/${pod.name}`, "Stopping container app");
        messages.push(`pod "${name}" deleted`);
        break;
      }
      case "replicasets": {
        const rs = state.replicaSets.find((candidate) => candidate.name === name);
        if (!rs) return err(`replicasets "${name}" not found`);
        for (const pod of podsOf(state, rs)) pod.phase = "Terminating";
        state.replicaSets = state.replicaSets.filter((candidate) => candidate !== rs);
        messages.push(`replicaset.apps "${name}" deleted`);
        break;
      }
      case "deployments": {
        const deployment = state.deployments.find((candidate) => candidate.name === name);
        if (!deployment) return err(`deployments "${name}" not found`);
        for (const rs of replicaSetsOf(state, deployment)) {
          for (const pod of podsOf(state, rs)) pod.phase = "Terminating";
        }
        state.replicaSets = state.replicaSets.filter((rs) => rs.ownerName !== deployment.name);
        state.deployments = state.deployments.filter((candidate) => candidate !== deployment);
        messages.push(`deployment.apps "${name}" deleted`);
        break;
      }
      case "daemonsets": {
        const daemonSet = state.daemonSets.find((candidate) => candidate.name === name);
        if (!daemonSet) return err(`daemonsets "${name}" not found`);
        for (const pod of podsOf(state, daemonSet)) pod.phase = "Terminating";
        state.daemonSets = state.daemonSets.filter((candidate) => candidate !== daemonSet);
        messages.push(`daemonset.apps "${name}" deleted`);
        break;
      }
      case "statefulsets": {
        const set = state.statefulSets.find((candidate) => candidate.name === name);
        if (!set) return err(`statefulsets "${name}" not found`);
        for (const pod of podsOf(state, set)) pod.phase = "Terminating";
        state.statefulSets = state.statefulSets.filter((candidate) => candidate !== set);
        messages.push(`statefulset.apps "${name}" deleted`);
        break;
      }
      case "jobs": {
        const job = state.jobs.find((candidate) => candidate.name === name);
        if (!job) return err(`jobs "${name}" not found`);
        state.pods = state.pods.filter((pod) => pod.ownerName !== job.name);
        state.jobs = state.jobs.filter((candidate) => candidate !== job);
        messages.push(`job.batch "${name}" deleted`);
        break;
      }
      case "cronjobs": {
        const cronJob = state.cronJobs.find((candidate) => candidate.name === name);
        if (!cronJob) return err(`cronjobs "${name}" not found`);
        state.cronJobs = state.cronJobs.filter((candidate) => candidate !== cronJob);
        messages.push(`cronjob.batch "${name}" deleted`);
        break;
      }
      case "services": {
        const service = state.services.find((candidate) => candidate.name === name);
        if (!service) return err(`services "${name}" not found`);
        state.services = state.services.filter((candidate) => candidate !== service);
        messages.push(`service "${name}" deleted`);
        break;
      }
      case "ingresses": {
        const ingress = state.ingresses.find((candidate) => candidate.name === name);
        if (!ingress) return err(`ingresses "${name}" not found`);
        state.ingresses = state.ingresses.filter((candidate) => candidate !== ingress);
        messages.push(`ingress.networking.k8s.io "${name}" deleted`);
        break;
      }
      case "configmaps": {
        state.configMaps = state.configMaps.filter((candidate) => candidate.name !== name);
        messages.push(`configmap "${name}" deleted`);
        break;
      }
      case "secrets": {
        state.secrets = state.secrets.filter((candidate) => candidate.name !== name);
        messages.push(`secret "${name}" deleted`);
        break;
      }
      case "persistentvolumeclaims": {
        const claim = state.persistentVolumeClaims.find((candidate) => candidate.name === name);
        if (!claim) return err(`persistentvolumeclaims "${name}" not found`);
        const volume = state.persistentVolumes.find((item) => item.name === claim.volumeName);
        if (volume) {
          volume.status = "Released";
          volume.claim = undefined;
        }
        state.persistentVolumeClaims = state.persistentVolumeClaims.filter(
          (candidate) => candidate !== claim,
        );
        messages.push(`persistentvolumeclaim "${name}" deleted`);
        break;
      }
      default:
        return err(`deleting ${parsed.resource} is not supported in this lab`);
    }
  }
  return ok(messages);
}

function scale(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const replicas = Number(parsed.flags.replicas);
  if (!Number.isFinite(replicas)) return err("--replicas is required for `kubectl scale`");
  const name = parsed.names[0];
  if (!name) return err("resource name is required");

  if (parsed.resource === "deployments") {
    const deployment = state.deployments.find((item) => item.name === name);
    if (!deployment) return err(`deployments "${name}" not found`);
    deployment.replicas = replicas;
    return ok([`deployment.apps/${name} scaled`]);
  }
  if (parsed.resource === "statefulsets") {
    const set = state.statefulSets.find((item) => item.name === name);
    if (!set) return err(`statefulsets "${name}" not found`);
    set.replicas = replicas;
    return ok([`statefulset.apps/${name} scaled`]);
  }
  if (parsed.resource === "replicasets") {
    const rs = state.replicaSets.find((item) => item.name === name);
    if (!rs) return err(`replicasets "${name}" not found`);
    if (rs.ownerName) {
      return err(
        `replicaset "${name}" is owned by Deployment/${rs.ownerName}; scale the Deployment instead`,
      );
    }
    rs.replicas = replicas;
    return ok([`replicaset.apps/${name} scaled`]);
  }
  return err("you can scale deployments, statefulsets or replicasets in this lab");
}

function setImage(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const name = parsed.names[0];
  const assignment = parsed.names.find((token) => token.includes("="));
  if (!name || !assignment) return err("usage: kubectl set image deployment/NAME CONTAINER=IMAGE");
  const image = assignment.split("=").slice(1).join("=");
  if (!image) return err("an image is required");

  if (parsed.resource === "statefulsets") {
    const set = state.statefulSets.find((item) => item.name === name);
    if (!set) return err(`statefulsets "${name}" not found`);
    set.template.image = image;
    for (const pod of podsOf(state, set)) pod.phase = "Terminating";
    return ok([`statefulset.apps/${name} image updated`]);
  }

  const deployment = state.deployments.find((item) => item.name === name);
  if (!deployment) return err(`deployments "${name}" not found`);
  if (deployment.template.image === image) {
    return ok([`deployment.apps/${name} image not updated (already ${image})`]);
  }
  deployment.template.image = image;
  bumpRevision(deployment, image, `kubectl set image deployment/${name} ${assignment}`);
  recordEvent(
    state,
    "Normal",
    "DeploymentUpdated",
    `deployment/${name}`,
    `Pod template image changed to ${image}`,
  );
  return ok([`deployment.apps/${name} image updated`]);
}

function bumpRevision(deployment: Deployment, image: string, changeCause: string): void {
  deployment.revision += 1;
  deployment.history.push({
    revision: deployment.revision,
    image,
    changeCause,
    template: structuredClone(deployment.template),
  });
}

function rollout(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const name = parsed.names[0];
  if (parsed.resource !== "deployments" || !name) {
    return err("usage: kubectl rollout <status|history|undo|restart> deployment/NAME");
  }
  const deployment = state.deployments.find((item) => item.name === name);
  if (!deployment) return err(`deployments "${name}" not found`);

  switch (parsed.subcommand) {
    case "status": {
      const sets = replicaSetsOf(state, deployment);
      const wanted = templateHash(deployment.template);
      const current = sets.find((rs) => rs.podTemplateHash === wanted);
      const pods = current ? podsOf(state, current) : [];
      const ready = pods.filter(isReady).length;
      const stuck = pods.some(
        (pod) => pod.phase === "ImagePullBackOff" || pod.phase === "CrashLoopBackOff",
      );
      if (stuck) {
        return ok([
          `Waiting for deployment "${name}" rollout to finish: ${ready} of ${deployment.replicas} updated replicas are available...`,
          `error: the rollout is stuck. New Pods never became Ready.`,
        ]);
      }
      if (ready >= deployment.replicas && sets.every((rs) => rs === current || rs.replicas === 0)) {
        return ok([`deployment "${name}" successfully rolled out`]);
      }
      return ok([
        `Waiting for deployment "${name}" rollout to finish: ${ready} of ${deployment.replicas} updated replicas are available...`,
      ]);
    }
    case "history": {
      const rows = [["REVISION", "CHANGE-CAUSE"]];
      for (const entry of deployment.history) {
        rows.push([String(entry.revision), `${entry.changeCause}  (image: ${entry.image})`]);
      }
      return ok([`deployment.apps/${name}`, ...table(rows)]);
    }
    case "undo": {
      const target = parsed.flags["to-revision"]
        ? Number(parsed.flags["to-revision"])
        : deployment.revision - 1;
      const entry = deployment.history.find((item) => item.revision === target);
      if (!entry) return err(`unable to find specified revision ${target} in history`);
      deployment.template = structuredClone(entry.template);
      bumpRevision(
        deployment,
        entry.image,
        `kubectl rollout undo deployment/${name} (to revision ${target})`,
      );
      recordEvent(
        state,
        "Normal",
        "DeploymentRolledBack",
        `deployment/${name}`,
        `Rolled back to ${entry.image}`,
      );
      return ok([`deployment.apps/${name} rolled back`]);
    }
    case "restart": {
      deployment.template.env = {
        ...(deployment.template.env ?? {}),
        RESTARTED_AT: String(state.clock),
      };
      bumpRevision(
        deployment,
        deployment.template.image,
        `kubectl rollout restart deployment/${name}`,
      );
      return ok([`deployment.apps/${name} restarted`]);
    }
    default:
      return err(`unknown rollout subcommand "${parsed.subcommand ?? ""}"`);
  }
}

function labelCommand(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const [target, ...assignments] = parsed.names;
  if (!target || assignments.length === 0) return err("usage: kubectl label node NAME key=value");

  if (parsed.resource === "nodes") {
    const node = state.nodes.find((item) => item.name === target);
    if (!node) return err(`nodes "${target}" not found`);
    for (const assignment of assignments) {
      if (assignment.endsWith("-")) delete node.labels[assignment.slice(0, -1)];
      else {
        const [key, value] = assignment.split("=");
        node.labels[key] = value ?? "";
      }
    }
    return ok([`node/${target} labeled`]);
  }
  if (parsed.resource === "pods") {
    const pod = state.pods.find((item) => item.name === target);
    if (!pod) return err(`pods "${target}" not found`);
    for (const assignment of assignments) {
      if (assignment.endsWith("-")) delete pod.labels[assignment.slice(0, -1)];
      else {
        const [key, value] = assignment.split("=");
        pod.labels[key] = value ?? "";
      }
    }
    return ok([`pod/${target} labeled`]);
  }
  return err("this lab can label nodes and pods");
}

function taintCommand(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const [target, ...specs] = parsed.names;
  if (!target || specs.length === 0) {
    return err("usage: kubectl taint nodes NAME key=value:NoSchedule");
  }
  const node = state.nodes.find((item) => item.name === target);
  if (!node) return err(`nodes "${target}" not found`);

  for (const spec of specs) {
    if (spec.endsWith("-")) {
      const key = spec.slice(0, -1).split("=")[0].split(":")[0];
      node.taints = node.taints.filter((taint) => taint.key !== key);
      continue;
    }
    const [pair, effect] = spec.split(":");
    const [key, value] = pair.split("=");
    if (effect !== "NoSchedule" && effect !== "NoExecute") {
      return err(`unsupported taint effect "${effect}"; use NoSchedule or NoExecute`);
    }
    node.taints.push({ key, value: value ?? "", effect });
    if (effect === "NoExecute") {
      for (const pod of state.pods) {
        if (pod.node !== node.name) continue;
        const tolerated = (pod.template.tolerations ?? []).some(
          (toleration) => toleration.key === key,
        );
        if (!tolerated) pod.phase = "Terminating";
      }
    }
  }
  return ok([`node/${target} tainted`]);
}

function applyFile(
  state: ClusterState,
  parsed: ParsedCommand,
  context: ExecContext,
): CommandResult {
  const filename = parsed.flags.filename;
  if (typeof filename !== "string") return err("usage: kubectl apply -f FILENAME");
  const file = context.files[filename];
  if (!file) return err(`the path "${filename}" does not exist in this lesson`);

  const documents = Array.isArray(file.doc) ? file.doc : [file.doc];
  const output: string[] = [];
  for (const document of documents) {
    const outcome = applyDocument(state, document as Record<string, unknown>);
    if (outcome.error) return err(outcome.error);
    if (outcome.message) output.push(outcome.message);
  }
  return ok(output);
}

/* ------------------------------------------------------------------ */
/* logs, exec and curl                                                 */
/* ------------------------------------------------------------------ */

function logs(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const name = parsed.names[0];
  if (!name) return err("usage: kubectl logs POD");
  const pod = state.pods.find((candidate) => candidate.name === name);
  if (!pod) return err(`pods "${name}" not found`);
  if (pod.logs.length === 0) {
    return ok([`No logs yet for ${pod.name} (status ${pod.phase}).`]);
  }
  return ok(pod.logs.slice(-20));
}

function execInPod(state: ClusterState, parsed: ParsedCommand): CommandResult {
  const name = parsed.names[0];
  if (!name) return err("usage: kubectl exec POD -- COMMAND");
  const pod = state.pods.find((candidate) => candidate.name === name);
  if (!pod) return err(`pods "${name}" not found`);
  if (pod.phase !== "Running") {
    return err(`cannot exec into a pod in ${pod.phase} state`);
  }

  const args = [...parsed.execArgs];
  if (args.length === 0) return err("no command supplied; use `-- COMMAND`");
  if (args[0] === "sh" || args[0] === "bash") {
    const index = args.indexOf("-c");
    if (index !== -1) return runShell(state, pod, args.slice(index + 1).join(" "));
    return ok(["This lab has no interactive shell. Use: kubectl exec POD -- sh -c '<command>'"]);
  }
  return runShell(state, pod, args.join(" "));
}

function runShell(state: ClusterState, pod: Pod, line: string): CommandResult {
  const command = line.trim();

  const redirect = /^echo\s+(.+?)\s*>\s*(\S+)$/.exec(command);
  if (redirect) {
    const content = redirect[1].replace(/^["']|["']$/g, "");
    const result = writePath(state, pod, redirect[2], content);
    return result.ok ? ok([]) : err(result.error);
  }

  const [binary, ...rest] = command.split(/\s+/);
  switch (binary) {
    case "cat": {
      const result = readPath(state, pod, rest[0] ?? "");
      return result.ok ? ok([result.content]) : err(`cat: ${result.error}`);
    }
    case "ls": {
      const entries = listPath(state, pod, rest[0] ?? "/");
      return ok(entries.length ? entries : ["(empty)"]);
    }
    case "hostname":
      return ok([pod.name]);
    case "env":
    case "printenv":
      return ok(
        Object.entries(podEnv(state, pod))
          .map(([key, value]) => `${key}=${value}`)
          .sort(),
      );
    case "echo":
      return ok([rest.join(" ").replace(/^["']|["']$/g, "")]);
    case "nslookup": {
      const service = state.services.find((item) => item.name === rest[0]);
      if (!service) return err(`nslookup: can't resolve '${rest[0]}'`);
      return ok([
        `Name:    ${service.name}.default.svc.cluster.local`,
        `Address: ${service.clusterIP}`,
      ]);
    }
    case "curl":
    case "wget":
      return curl(state, rest.filter((token) => !token.startsWith("-"))[0] ?? "");
    default:
      return err(`${binary}: not found in this simulated container`);
  }
}

interface ResolvedTarget {
  service: Service;
  via?: string;
}

function resolveTarget(state: ClusterState, host: string, port: number, path: string):
  | ResolvedTarget
  | { error: string } {
  const byName = state.services.find((item) => item.name === host || item.clusterIP === host);
  if (byName) return { service: byName };

  const node = state.nodes.find((item) => item.name === host);
  if (node) {
    const service = state.services.find((item) => item.nodePort === port);
    if (service) return { service, via: `node ${node.name}:${port}` };
    return { error: `curl: (7) Failed to connect to ${host} port ${port}: Connection refused` };
  }

  for (const ingress of state.ingresses) {
    const rules = ingress.rules.filter(
      (rule) => rule.host === host || (!rule.host && host === ingress.address),
    );
    if (rules.length === 0) continue;
    if (!ingress.address) {
      return { error: `curl: (7) ingress ${ingress.name} has no address yet` };
    }
    const match = rules
      .filter((rule) => path.startsWith(rule.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!match) {
      return { error: `HTTP 404 Not Found — ingress ${ingress.name} has no rule for ${path}` };
    }
    const service = state.services.find((item) => item.name === match.service);
    if (!service) {
      return {
        error: `HTTP 503 Service Unavailable — ingress ${ingress.name} points at service "${match.service}", which does not exist`,
      };
    }
    return { service, via: `ingress/${ingress.name} (${match.host ?? "*"}${match.path})` };
  }

  return { error: `curl: (6) Could not resolve host: ${host}` };
}

function curl(state: ClusterState, url: string): CommandResult {
  if (!url) return err("usage: curl http://HOST[:PORT][/PATH]");
  const match = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url.trim());
  if (!match) return err(`curl: (3) URL using bad/illegal format: ${url}`);

  const [, host, portText, rawPath] = match;
  const path = rawPath ?? "/";
  const target = resolveTarget(state, host, Number(portText ?? 80), path);
  if ("error" in target) return { output: [target.error], isError: true };

  const { service, via } = target;
  const endpoints = endpointsOf(state, service);
  if (endpoints.length === 0) {
    return {
      output: [
        `HTTP 503 Service Unavailable — service/${service.name} has no ready endpoints.`,
        `  selector: ${labelString(service.selector)}`,
      ],
      isError: true,
    };
  }

  const pod = endpoints[state.clock % endpoints.length];
  pod.logs.push(`10.244.0.1 - "GET ${path} HTTP/1.1" 200 ${pod.name}`);
  return ok([
    `HTTP/1.1 200 OK`,
    `served by ${pod.name} (${pod.ip}) on ${pod.node} running ${pod.image}`,
    `route: ${via ? `${via} -> ` : ""}service/${service.name} -> pod`,
  ]);
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export function execute(
  state: ClusterState,
  parsed: ParsedCommand,
  context: ExecContext = EMPTY_CONTEXT,
): CommandResult {
  if (!parsed.ok) return err(parsed.error ?? "invalid command");

  switch (parsed.verb) {
    case "curl":
      return curl(state, parsed.names[0] ?? "");

    case "cat": {
      const file = context.files[parsed.names[0] ?? ""];
      return file ? ok(file.raw.split("\n")) : err(`cat: ${parsed.names[0]}: No such file`);
    }

    case "get":
      switch (parsed.resource) {
        case "pods":
          return getPods(state, parsed);
        case "replicasets":
          return getReplicaSets(state, parsed);
        case "deployments":
          return getDeployments(state, parsed);
        case "daemonsets":
          return getDaemonSets(state);
        case "statefulsets":
          return getStatefulSets(state);
        case "jobs":
          return getJobs(state);
        case "cronjobs":
          return getCronJobs(state);
        case "services":
          return getServices(state);
        case "endpoints":
          return getEndpoints(state);
        case "ingresses":
          return getIngresses(state);
        case "configmaps":
          return getConfigMaps(state);
        case "secrets":
          return getSecrets(state);
        case "storageclasses":
          return getStorageClasses(state);
        case "persistentvolumes":
          return getPersistentVolumes(state);
        case "persistentvolumeclaims":
          return getPersistentVolumeClaims(state);
        case "nodes":
          return getNodes(state, parsed);
        case "events":
          return getEvents(state);
        case "all":
          return getAll(state, parsed);
        default:
          return err("specify a resource, e.g. `kubectl get pods`. Type `help` for the full list.");
      }

    case "describe": {
      const name = parsed.names[0];
      if (!name) return err("resource name is required");
      switch (parsed.resource) {
        case "pods":
          return describePod(state, name);
        case "deployments":
          return describeDeployment(state, name);
        case "services":
          return describeService(state, name);
        case "nodes":
          return describeNode(state, name);
        case "ingresses":
          return describeIngress(state, name);
        case "persistentvolumeclaims":
          return describeClaim(state, name);
        default: {
          const result = describeSimple(state, parsed.resource ?? "", name);
          return result ?? err(`describing ${parsed.resource} is not supported in this lab`);
        }
      }
    }

    case "run":
      return runPod(state, parsed);

    case "create":
      return createResource(state, parsed);

    case "apply":
      return applyFile(state, parsed, context);

    case "expose":
      return expose(state, parsed);

    case "delete":
      return deleteResource(state, parsed);

    case "scale":
      return scale(state, parsed);

    case "set":
      if (parsed.subcommand !== "image") return err("only `kubectl set image` is supported");
      return setImage(state, parsed);

    case "rollout":
      return rollout(state, parsed);

    case "label":
      return labelCommand(state, parsed);

    case "taint":
      return taintCommand(state, parsed);

    case "logs":
      return logs(state, parsed);

    case "exec":
      return execInPod(state, parsed);

    case "explain":
      return ok(["Type `help` to see every command this simulated cluster understands."]);

    default:
      return err(`verb "${parsed.verb}" is not implemented in this lab`);
  }
}
