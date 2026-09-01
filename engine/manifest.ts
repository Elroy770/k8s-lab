import {
  createConfigMap,
  createCronJob,
  createDaemonSet,
  createDeployment,
  createIngress,
  createJob,
  createPersistentVolume,
  createPersistentVolumeClaim,
  createPod,
  createReplicaSet,
  createSecret,
  createService,
  createStatefulSet,
  createStorageClass,
} from "./cluster-state";
import type {
  AccessMode,
  ClusterState,
  EnvFromRef,
  Labels,
  NodeAffinityRule,
  PodTemplate,
  PodVolume,
  Probe,
  ProbeKind,
  Toleration,
  VolumeMount,
} from "./types";

/**
 * Translates Kubernetes YAML manifests into simulator objects.
 * Only the fields the lessons actually teach are honoured.
 */

type Doc = Record<string, any>;

export function parseQuantityGi(value: unknown): number {
  if (typeof value === "number") return value;
  const match = /^(\d+(?:\.\d+)?)\s*(Gi|Mi|G|M)?$/.exec(String(value ?? "1Gi"));
  if (!match) return 1;
  const amount = Number(match[1]);
  const unit = match[2] ?? "Gi";
  if (unit === "Mi" || unit === "M") return Math.max(0.1, amount / 1024);
  return amount;
}

export function podTemplateFrom(spec: Doc | undefined, fallbackLabels: Labels = {}): PodTemplate {
  const podSpec: Doc = spec?.spec ?? spec ?? {};
  const container: Doc = podSpec.containers?.[0] ?? {};

  const volumes: PodVolume[] = (podSpec.volumes ?? []).map((volume: Doc) => {
    if (volume.persistentVolumeClaim) {
      return {
        name: volume.name,
        kind: "persistentVolumeClaim" as const,
        source: volume.persistentVolumeClaim.claimName,
      };
    }
    if (volume.configMap) {
      return { name: volume.name, kind: "configMap" as const, source: volume.configMap.name };
    }
    if (volume.secret) {
      return { name: volume.name, kind: "secret" as const, source: volume.secret.secretName };
    }
    return { name: volume.name, kind: "emptyDir" as const };
  });

  const mounts: VolumeMount[] = (container.volumeMounts ?? []).map((mount: Doc) => ({
    name: mount.name,
    mountPath: mount.mountPath,
  }));

  const env: Record<string, string> = {};
  for (const entry of container.env ?? []) {
    if (entry?.name && entry.value !== undefined) env[entry.name] = String(entry.value);
    if (entry?.name && entry.valueFrom?.configMapKeyRef) {
      env[entry.name] = `<from configMap ${entry.valueFrom.configMapKeyRef.name}>`;
    }
    if (entry?.name && entry.valueFrom?.secretKeyRef) {
      env[entry.name] = `<from secret ${entry.valueFrom.secretKeyRef.name}>`;
    }
  }

  const envFrom: EnvFromRef[] = (container.envFrom ?? []).flatMap((entry: Doc) => {
    if (entry.configMapRef?.name) {
      return [{ kind: "configMap" as const, name: entry.configMapRef.name }];
    }
    if (entry.secretRef?.name) return [{ kind: "secret" as const, name: entry.secretRef.name }];
    return [];
  });

  const probes: Probe[] = [];
  for (const kind of ["liveness", "readiness", "startup"] as ProbeKind[]) {
    const probe = container[`${kind}Probe`];
    if (probe?.httpGet?.path) {
      probes.push({
        kind,
        path: probe.httpGet.path,
        failureThreshold: probe.failureThreshold ?? 3,
      });
    }
  }

  const tolerations: Toleration[] = (podSpec.tolerations ?? []).map((toleration: Doc) => ({
    key: toleration.key,
    value: toleration.value,
    operator: toleration.operator,
    effect: toleration.effect,
  }));

  const affinity: NodeAffinityRule[] = [];
  const nodeAffinity = podSpec.affinity?.nodeAffinity;
  for (const term of nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
    ?.nodeSelectorTerms ?? []) {
    for (const expression of term.matchExpressions ?? []) {
      affinity.push({
        key: expression.key,
        operator: expression.operator,
        values: expression.values,
      });
    }
  }
  for (const preference of nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution ?? []) {
    for (const expression of preference.preference?.matchExpressions ?? []) {
      affinity.push({
        key: expression.key,
        operator: expression.operator,
        values: expression.values,
        preferred: true,
      });
    }
  }

  return {
    image: container.image ?? "nginx:1.21",
    labels: { ...fallbackLabels, ...(spec?.metadata?.labels ?? {}) },
    nodeSelector: podSpec.nodeSelector,
    affinity: affinity.length ? affinity : undefined,
    tolerations: tolerations.length ? tolerations : undefined,
    volumes: volumes.length ? volumes : undefined,
    mounts: mounts.length ? mounts : undefined,
    env: Object.keys(env).length ? env : undefined,
    envFrom: envFrom.length ? envFrom : undefined,
    probes: probes.length ? probes : undefined,
    restartPolicy: podSpec.restartPolicy,
    runFor: container.runFor,
    failing: container.command?.join?.(" ")?.includes("exit 1") || undefined,
  };
}

export interface ApplyOutcome {
  message?: string;
  error?: string;
}

export function applyDocument(state: ClusterState, doc: Doc): ApplyOutcome {
  const kind: string | undefined = doc?.kind;
  const name: string | undefined = doc?.metadata?.name;
  if (!kind || !name) return { error: "manifest is missing kind or metadata.name" };

  const spec: Doc = doc.spec ?? {};
  const selector: Labels = spec.selector?.matchLabels ?? { app: name };

  switch (kind) {
    case "Pod": {
      if (state.pods.some((pod) => pod.name === name)) return { message: `pod/${name} unchanged` };
      createPod(state, {
        name,
        template: podTemplateFrom(doc, doc.metadata?.labels ?? { run: name }),
      });
      return { message: `pod/${name} created` };
    }

    case "ReplicaSet": {
      const existing = state.replicaSets.find((rs) => rs.name === name);
      if (existing) {
        existing.replicas = spec.replicas ?? existing.replicas;
        return { message: `replicaset.apps/${name} configured` };
      }
      createReplicaSet(state, {
        name,
        replicas: spec.replicas ?? 1,
        template: podTemplateFrom(spec.template, selector),
        selector,
      });
      return { message: `replicaset.apps/${name} created` };
    }

    case "Deployment": {
      const template = podTemplateFrom(spec.template, selector);
      const existing = state.deployments.find((item) => item.name === name);
      if (existing) {
        const replicas = spec.replicas ?? existing.replicas;
        const changed =
          JSON.stringify(existing.template) !== JSON.stringify(template) ||
          replicas !== existing.replicas;
        existing.replicas = replicas;
        if (!changed) return { message: `deployment.apps/${name} unchanged` };
        const templateChanged = JSON.stringify(existing.template) !== JSON.stringify(template);
        existing.template = template;
        if (templateChanged) {
          existing.revision += 1;
          existing.history.push({
            revision: existing.revision,
            image: template.image,
            changeCause: `kubectl apply -f (${name})`,
            template: structuredClone(template),
          });
        }
        return { message: `deployment.apps/${name} configured` };
      }
      createDeployment(state, {
        name,
        replicas: spec.replicas ?? 1,
        template,
        selector,
      });
      return { message: `deployment.apps/${name} created` };
    }

    case "DaemonSet": {
      if (state.daemonSets.some((item) => item.name === name)) {
        return { message: `daemonset.apps/${name} unchanged` };
      }
      createDaemonSet(state, { name, template: podTemplateFrom(spec.template, selector), selector });
      return { message: `daemonset.apps/${name} created` };
    }

    case "StatefulSet": {
      const existing = state.statefulSets.find((item) => item.name === name);
      if (existing) {
        existing.replicas = spec.replicas ?? existing.replicas;
        return { message: `statefulset.apps/${name} configured` };
      }
      const claimTemplate = spec.volumeClaimTemplates?.[0];
      createStatefulSet(state, {
        name,
        replicas: spec.replicas ?? 1,
        template: podTemplateFrom(spec.template, selector),
        selector,
        serviceName: spec.serviceName,
        volumeClaimTemplate: claimTemplate
          ? {
              name: claimTemplate.metadata?.name ?? "data",
              requestGi: parseQuantityGi(claimTemplate.spec?.resources?.requests?.storage),
              storageClass: claimTemplate.spec?.storageClassName,
            }
          : undefined,
      });
      return { message: `statefulset.apps/${name} created` };
    }

    case "Job": {
      if (state.jobs.some((item) => item.name === name)) {
        return { message: `job.batch/${name} unchanged` };
      }
      createJob(state, {
        name,
        template: podTemplateFrom(spec.template, { "job-name": name }),
        completions: spec.completions ?? 1,
        parallelism: spec.parallelism ?? 1,
        backoffLimit: spec.backoffLimit ?? 3,
      });
      return { message: `job.batch/${name} created` };
    }

    case "CronJob": {
      if (state.cronJobs.some((item) => item.name === name)) {
        return { message: `cronjob.batch/${name} unchanged` };
      }
      createCronJob(state, {
        name,
        schedule: spec.schedule ?? "*/1 * * * *",
        suspend: spec.suspend,
        template: podTemplateFrom(spec.jobTemplate?.spec?.template, { "cronjob-name": name }),
      });
      return { message: `cronjob.batch/${name} created` };
    }

    case "Service": {
      const port: Doc = spec.ports?.[0] ?? {};
      const existing = state.services.find((item) => item.name === name);
      if (existing) {
        const nextSelector = spec.selector ?? existing.selector;
        const changed =
          JSON.stringify(existing.selector) !== JSON.stringify(nextSelector) ||
          (spec.type ?? existing.type) !== existing.type;
        existing.selector = nextSelector;
        existing.type = spec.type ?? existing.type;
        return { message: `service/${name} ${changed ? "configured" : "unchanged"}` };
      }
      createService(state, {
        name,
        type: spec.type ?? "ClusterIP",
        selector: spec.selector ?? {},
        port: port.port ?? 80,
        targetPort: port.targetPort ?? port.port ?? 80,
        nodePort: port.nodePort,
        headless: spec.clusterIP === "None",
      });
      return { message: `service/${name} created` };
    }

    case "Ingress": {
      if (state.ingresses.some((item) => item.name === name)) {
        return { message: `ingress.networking.k8s.io/${name} unchanged` };
      }
      const rules = (spec.rules ?? []).flatMap((rule: Doc) =>
        (rule.http?.paths ?? []).map((entry: Doc) => ({
          host: rule.host,
          path: entry.path ?? "/",
          service: entry.backend?.service?.name,
          port: entry.backend?.service?.port?.number ?? 80,
        })),
      );
      createIngress(state, { name, className: spec.ingressClassName, rules });
      return { message: `ingress.networking.k8s.io/${name} created` };
    }

    case "ConfigMap": {
      const existing = state.configMaps.find((item) => item.name === name);
      if (existing) {
        const next = { ...((doc.data ?? {}) as Record<string, string>) };
        const changed = JSON.stringify(existing.data) !== JSON.stringify(next);
        existing.data = next;
        return { message: `configmap/${name} ${changed ? "configured" : "unchanged"}` };
      }
      createConfigMap(state, name, doc.data ?? {});
      return { message: `configmap/${name} created` };
    }

    case "Secret": {
      if (state.secrets.some((item) => item.name === name)) {
        return { message: `secret/${name} unchanged` };
      }
      const data: Record<string, string> = {};
      for (const [key, value] of Object.entries(doc.stringData ?? {})) {
        data[key] = String(value);
      }
      for (const [key, value] of Object.entries(doc.data ?? {})) {
        data[key] = decodeBase64(String(value));
      }
      createSecret(state, name, data, doc.type ?? "Opaque");
      return { message: `secret/${name} created` };
    }

    case "StorageClass": {
      if (state.storageClasses.some((item) => item.name === name)) {
        return { message: `storageclass.storage.k8s.io/${name} unchanged` };
      }
      createStorageClass(state, {
        name,
        provisioner: doc.provisioner ?? "lab.local/provisioner",
        isDefault:
          doc.metadata?.annotations?.["storageclass.kubernetes.io/is-default-class"] === "true",
      });
      return { message: `storageclass.storage.k8s.io/${name} created` };
    }

    case "PersistentVolume": {
      if (state.persistentVolumes.some((item) => item.name === name)) {
        return { message: `persistentvolume/${name} unchanged` };
      }
      createPersistentVolume(state, {
        name,
        capacityGi: parseQuantityGi(spec.capacity?.storage),
        accessModes: (spec.accessModes ?? ["ReadWriteOnce"]) as AccessMode[],
        storageClass: spec.storageClassName ?? "manual",
      });
      return { message: `persistentvolume/${name} created` };
    }

    case "PersistentVolumeClaim": {
      if (state.persistentVolumeClaims.some((item) => item.name === name)) {
        return { message: `persistentvolumeclaim/${name} unchanged` };
      }
      createPersistentVolumeClaim(state, {
        name,
        requestGi: parseQuantityGi(spec.resources?.requests?.storage),
        accessModes: (spec.accessModes ?? ["ReadWriteOnce"]) as AccessMode[],
        storageClass: spec.storageClassName,
      });
      return { message: `persistentvolumeclaim/${name} created` };
    }

    default:
      return { error: `kind "${kind}" is not supported in this lab` };
  }
}

function decodeBase64(value: string): string {
  try {
    if (typeof atob === "function") return atob(value);
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return value;
  }
}
