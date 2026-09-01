"use client";

import {
  endpointsOf,
  formatAge,
  isReady,
  nodeFits,
  podsOf,
  replicaSetsOf,
  templateHash,
} from "@/engine/cluster-state";
import type { Lesson } from "@/engine/lesson-types";
import type { ClusterState, Pod, ReplicaSet } from "@/engine/types";

const PHASE_STYLE: Record<Pod["phase"], string> = {
  Running: "border-good/50 bg-good/10 text-good",
  Pending: "border-slate-600 bg-slate-700/20 text-slate-300",
  ContainerCreating: "border-warn/50 bg-warn/10 text-warn",
  ImagePullBackOff: "border-bad/60 bg-bad/10 text-bad",
  CrashLoopBackOff: "border-bad/60 bg-bad/10 text-bad",
  Completed: "border-accent/40 bg-accent/10 text-accent",
  Failed: "border-bad/60 bg-bad/10 text-bad",
  Terminating: "border-bad/40 bg-bad/5 text-bad/70",
};

function labelsOf(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function PodChip({ pod, prefix }: { pod: Pod; prefix?: string }) {
  const unstable = pod.phase === "Pending" || pod.phase === "ContainerCreating";
  const short = prefix && pod.name.startsWith(prefix) ? pod.name.slice(prefix.length) : pod.name;
  const notReady = pod.phase === "Running" && !pod.ready;

  return (
    <div
      className={`pod-in mono rounded-md border px-2 py-1.5 text-[11px] leading-tight ${PHASE_STYLE[pod.phase]} ${
        unstable || pod.phase === "Terminating" ? "pulsing" : ""
      }`}
      title={`${pod.name}\n${pod.image}\n${pod.ip} on ${pod.node ?? "unscheduled"}${
        pod.reason ? `\n${pod.reason}` : ""
      }`}
    >
      <div className="font-medium">
        {short !== pod.name ? <span className="opacity-40">…-</span> : null}
        {short}
      </div>
      <div className="truncate opacity-70">
        {notReady ? "Running · not ready" : pod.phase} · {pod.node ?? "unscheduled"}
      </div>
    </div>
  );
}

function Section({
  kind,
  name,
  meta,
  children,
  tone = "default",
}: {
  kind: string;
  name: string;
  meta?: string;
  children?: React.ReactNode;
  tone?: "default" | "warn";
}) {
  const border = tone === "warn" ? "border-warn/40 bg-warn/5" : "border-line bg-panel";
  const badge = tone === "warn" ? "bg-warn/20 text-warn" : "bg-accent/15 text-accent";
  return (
    <section className={`rounded-xl border p-3 ${border}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${badge}`}
          >
            {kind}
          </span>
          <span className="mono ml-2 text-sm text-slate-100">{name}</span>
        </div>
        {meta ? <span className="mono text-[11px] text-slate-500">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function PodGrid({ pods, prefix }: { pods: Pod[]; prefix?: string }) {
  if (pods.length === 0) {
    return (
      <div className="mono mt-2.5 rounded border border-dashed border-line px-2 py-3 text-center text-[11px] text-slate-600">
        no pods
      </div>
    );
  }
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-1.5">
      {pods.map((pod) => (
        <PodChip key={pod.uid} pod={pod} prefix={prefix} />
      ))}
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="mono flex items-center gap-2 py-1.5 pl-3 text-[11px] text-slate-600">
      <span className="text-slate-500">↓</span> {label}
    </div>
  );
}

function ReplicaSetCard({
  state,
  rs,
  variant,
}: {
  state: ClusterState;
  rs: ReplicaSet;
  variant: "current" | "old" | "standalone";
}) {
  const pods = podsOf(state, rs);
  const ready = pods.filter(isReady).length;
  const border = variant === "old" ? "border-line/70 opacity-70" : "border-accent/40";

  return (
    <div className={`rounded-lg border ${border} bg-panelsoft/70 p-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="mono truncate text-[12px] text-slate-200">{rs.name}</span>
        <span className="mono shrink-0 text-[11px] text-slate-500">
          {ready}/{rs.replicas} ready
        </span>
      </div>
      <div className="mono mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
        <span>{rs.template.image}</span>
        {variant !== "standalone" ? <span>rev {rs.revision}</span> : null}
        <span>{formatAge(rs.age)}</span>
        {variant === "old" ? (
          <span className="rounded bg-slate-700/60 px-1 text-slate-300">previous</span>
        ) : null}
      </div>
      {pods.length ? (
        <PodGrid pods={pods} prefix={`${rs.name}-`} />
      ) : (
        <div className="mono mt-2.5 rounded border border-dashed border-line px-2 py-3 text-center text-[11px] text-slate-600">
          scaled to zero — kept for rollback
        </div>
      )}
    </div>
  );
}

export default function ClusterView({
  state,
  files,
}: {
  state: ClusterState;
  files?: Lesson["files"];
}) {
  const orphanPods = state.pods.filter((pod) => !pod.ownerName);
  const standaloneSets = state.replicaSets.filter((rs) => !rs.ownerName);
  const isEmpty =
    state.pods.length === 0 &&
    state.replicaSets.length === 0 &&
    state.deployments.length === 0 &&
    state.services.length === 0 &&
    state.persistentVolumeClaims.length === 0 &&
    state.configMaps.length === 0;

  return (
    <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {isEmpty ? (
        <div className="mono rounded-lg border border-dashed border-line p-8 text-center text-[12px] text-slate-600">
          The cluster is empty. Nothing is scheduled.
        </div>
      ) : null}

      {state.ingresses.map((ingress) => (
        <Section
          key={ingress.uid}
          kind="Ingress"
          name={ingress.name}
          meta={ingress.address ?? "address pending"}
        >
          <div className="mono mt-2 flex flex-col gap-1 text-[11px] text-slate-400">
            {ingress.rules.map((rule, index) => {
              const service = state.services.find((item) => item.name === rule.service);
              return (
                <div
                  key={index}
                  className={`flex items-center gap-2 rounded border px-2 py-1 ${
                    service ? "border-line bg-panelsoft/60" : "border-bad/50 bg-bad/5 text-bad"
                  }`}
                >
                  <span className="text-slate-200">
                    {rule.host ?? "*"}
                    {rule.path}
                  </span>
                  <span className="opacity-60">→</span>
                  <span>
                    svc/{rule.service}:{rule.port}
                  </span>
                  {!service ? <span className="ml-auto">no such service</span> : null}
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      {state.services.map((service) => {
        const endpoints = endpointsOf(state, service);
        return (
          <Section
            key={service.uid}
            kind="Service"
            name={service.name}
            meta={`${service.type}${service.nodePort ? ` :${service.nodePort}` : ""} · ${service.clusterIP}`}
            tone={endpoints.length === 0 ? "warn" : "default"}
          >
            <div className="mono mt-2 text-[11px] text-slate-500">
              selector {labelsOf(service.selector) || "<none>"} ·{" "}
              {endpoints.length ? (
                <span className="text-good">{endpoints.length} ready endpoints</span>
              ) : (
                <span className="text-warn">no endpoints — routes nowhere</span>
              )}
            </div>
          </Section>
        );
      })}

      {state.deployments.map((deployment) => {
        const sets = replicaSetsOf(state, deployment);
        const wanted = templateHash(deployment.template);
        const current = sets.find((rs) => rs.podTemplateHash === wanted);
        const old = sets.filter((rs) => rs !== current);
        const rollingOut = old.some((rs) => rs.replicas > 0);

        return (
          <Section
            key={deployment.uid}
            kind="Deployment"
            name={deployment.name}
            meta={`${deployment.template.image} · ${deployment.replicas} replicas · rev ${deployment.revision}`}
          >
            <Arrow label={rollingOut ? "rollout in progress — new and previous ReplicaSets" : "owns"} />
            <div className="grid gap-3 xl:grid-cols-2">
              {current ? <ReplicaSetCard state={state} rs={current} variant="current" /> : null}
              {old.map((rs) => (
                <ReplicaSetCard key={rs.uid} state={state} rs={rs} variant="old" />
              ))}
            </div>
          </Section>
        );
      })}

      {state.statefulSets.map((set) => (
        <Section
          key={set.uid}
          kind="StatefulSet"
          name={set.name}
          meta={`${set.template.image} · ${podsOf(state, set).filter(isReady).length}/${set.replicas} ready · svc ${set.serviceName}`}
        >
          <PodGrid pods={podsOf(state, set)} />
        </Section>
      ))}

      {state.daemonSets.map((daemonSet) => (
        <Section
          key={daemonSet.uid}
          kind="DaemonSet"
          name={daemonSet.name}
          meta={`${daemonSet.template.image} · ${podsOf(state, daemonSet).length}/${
            state.nodes.filter((node) => nodeFits(node, daemonSet.template)).length
          } nodes covered`}
        >
          <PodGrid pods={podsOf(state, daemonSet)} prefix={`${daemonSet.name}-`} />
        </Section>
      ))}

      {standaloneSets.map((rs) => (
        <Section
          key={rs.uid}
          kind="ReplicaSet"
          name={rs.name}
          meta={`selector ${labelsOf(rs.selector)}`}
        >
          <Arrow label="owns" />
          <ReplicaSetCard state={state} rs={rs} variant="standalone" />
        </Section>
      ))}

      {state.cronJobs.map((cronJob) => (
        <Section
          key={cronJob.uid}
          kind="CronJob"
          name={cronJob.name}
          meta={`${cronJob.schedule} · ${cronJob.suspend ? "suspended" : "active"}`}
        />
      ))}

      {state.jobs.map((job) => (
        <Section
          key={job.uid}
          kind="Job"
          name={job.name}
          meta={`${job.succeeded}/${job.completions} completed${job.failed ? ` · ${job.failed} failed` : ""}`}
        >
          <PodGrid
            pods={state.pods.filter((pod) => pod.ownerName === job.name)}
            prefix={`${job.name}-`}
          />
        </Section>
      ))}

      {orphanPods.length ? (
        <Section
          kind="Unmanaged Pods"
          name={`${orphanPods.length} pod(s)`}
          meta="no controller — will not be replaced"
          tone="warn"
        >
          <PodGrid pods={orphanPods} />
        </Section>
      ) : null}

      {state.persistentVolumeClaims.length || state.persistentVolumes.length ? (
        <section className="rounded-xl border border-line bg-panel/60 p-3">
          <h3 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Storage
          </h3>
          <div className="mono mt-2 flex flex-col gap-1 text-[11px]">
            {state.storageClasses.map((storageClass) => (
              <div key={storageClass.uid} className="text-slate-500">
                sc/{storageClass.name}
                {storageClass.isDefault ? " (default)" : ""} · {storageClass.provisioner}
              </div>
            ))}
            {state.persistentVolumeClaims.map((claim) => (
              <div
                key={claim.uid}
                className={`flex items-center justify-between rounded border px-2 py-1 ${
                  claim.status === "Bound"
                    ? "border-line bg-panelsoft/60 text-slate-300"
                    : "border-warn/50 bg-warn/5 text-warn"
                }`}
                title={claim.reason}
              >
                <span>
                  pvc/{claim.name} · {claim.requestGi}Gi ·{" "}
                  {claim.accessModes.join(",")}
                </span>
                <span>{claim.status === "Bound" ? claim.volumeName : claim.status}</span>
              </div>
            ))}
            {state.persistentVolumes.map((volume) => (
              <div key={volume.uid} className="text-slate-500">
                pv/{volume.name} · {volume.capacityGi}Gi · {volume.status}
                {volume.claim ? ` → ${volume.claim}` : ""}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {state.configMaps.length || state.secrets.length ? (
        <section className="rounded-xl border border-line bg-panel/60 p-3">
          <h3 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Configuration
          </h3>
          <div className="mono mt-2 flex flex-col gap-1 text-[11px] text-slate-400">
            {state.configMaps.map((configMap) => (
              <div key={configMap.uid}>
                cm/{configMap.name} · {Object.keys(configMap.data).join(", ")}
              </div>
            ))}
            {state.secrets.map((secret) => (
              <div key={secret.uid}>
                secret/{secret.name} · {Object.keys(secret.data).length} keys (hidden)
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-panel/60 p-3">
        <h3 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Nodes</h3>
        <div className="mt-2 grid gap-2 xl:grid-cols-2">
          {state.nodes.map((node) => {
            const count = state.pods.filter((pod) => pod.node === node.name).length;
            return (
              <div
                key={node.name}
                className="mono rounded-md border border-line bg-panelsoft/60 px-2.5 py-2 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">{node.name}</span>
                  <span className={node.ready ? "text-slate-500" : "text-bad"}>
                    {node.ready ? `${count} pods` : "NotReady"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-slate-600">{labelsOf(node.labels)}</div>
                {node.taints.length ? (
                  <div className="mt-0.5 truncate text-warn/80">
                    taint {node.taints.map((taint) => `${taint.key}=${taint.value}:${taint.effect}`).join(" ")}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {files ? (
        <section className="rounded-xl border border-line bg-panel/60 p-3">
          <h3 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Manifests in this lesson
          </h3>
          {Object.entries(files).map(([name, file]) => (
            <details key={name} className="mt-2">
              <summary className="mono cursor-pointer text-[12px] text-accent">{name}</summary>
              <pre className="thin-scroll mono mt-2 max-h-64 overflow-auto rounded-md border border-line bg-black/50 p-3 text-[11px] leading-relaxed text-slate-400">
                {file.raw}
              </pre>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
