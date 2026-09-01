import {
  addNode,
  createCluster,
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
  recordEvent,
  settle,
} from "./cluster-state";
import type { LessonInitialState, StepEffect } from "./lesson-types";
import type { ClusterState } from "./types";

/** Builds the cluster a lesson wants the learner to walk into. */
export function buildInitialCluster(initial?: LessonInitialState): ClusterState {
  const state = createCluster();
  if (!initial) return state;

  for (const spec of initial.nodes ?? []) {
    const node = addNode(state, spec.name, spec.labels);
    node.taints = spec.taints ?? [];
  }

  for (const spec of initial.storageClasses ?? []) createStorageClass(state, spec);
  for (const spec of initial.persistentVolumes ?? []) createPersistentVolume(state, spec);
  for (const spec of initial.persistentVolumeClaims ?? []) {
    const claim = createPersistentVolumeClaim(state, spec);
    claim.data = { ...(spec.data ?? {}) };
  }
  for (const spec of initial.configMaps ?? []) createConfigMap(state, spec.name, spec.data);
  for (const spec of initial.secrets ?? []) {
    createSecret(state, spec.name, spec.data, spec.type);
  }

  for (const spec of initial.pods ?? []) {
    createPod(state, { name: spec.name, template: spec.template });
  }
  for (const spec of initial.replicaSets ?? []) {
    createReplicaSet(state, {
      name: spec.name,
      replicas: spec.replicas ?? 1,
      template: spec.template,
      selector: spec.selector ?? spec.template.labels,
    });
  }
  for (const spec of initial.daemonSets ?? []) {
    createDaemonSet(state, { name: spec.name, template: spec.template, selector: spec.selector });
  }
  for (const spec of initial.statefulSets ?? []) {
    createStatefulSet(state, {
      name: spec.name,
      replicas: spec.replicas ?? 1,
      template: spec.template,
      selector: spec.selector,
      serviceName: spec.serviceName,
      volumeClaimTemplate: spec.volumeClaimTemplate,
    });
  }
  for (const spec of initial.jobs ?? []) createJob(state, spec);
  for (const spec of initial.cronJobs ?? []) createCronJob(state, spec);
  for (const spec of initial.services ?? []) createService(state, spec);
  for (const spec of initial.ingresses ?? []) createIngress(state, spec);

  for (const spec of initial.deployments ?? []) {
    // Past rollouts are replayed for real, so old ReplicaSets and revision
    // history exist exactly as they would after a genuine release.
    const images = [...(spec.previousImages ?? []), spec.template.image];
    const deployment = createDeployment(state, {
      name: spec.name,
      replicas: spec.replicas ?? 1,
      template: { ...spec.template, image: images[0] },
      selector: spec.selector,
    });
    settle(state);

    const later = [...images.slice(1), spec.pendingImage].filter(Boolean) as string[];
    for (const image of later) {
      deployment.template.image = image;
      deployment.revision += 1;
      deployment.history.push({
        revision: deployment.revision,
        image,
        changeCause: `kubectl set image deployment/${spec.name} app=${image}`,
        template: { ...structuredClone(deployment.template), image },
      });
      settle(state);
    }
  }

  settle(state);

  // Lessons start on a cluster that has been up for a while, not one second old.
  for (const pod of state.pods) pod.age += 12;
  state.events = [];
  return state;
}

/** Applies a scripted world event attached to a lesson step. */
export function applyEffect(state: ClusterState, effect: StepEffect): string[] {
  const messages: string[] = [];

  if (effect.addNode) {
    addNode(state, effect.addNode.name, effect.addNode.labels);
    messages.push(`node/${effect.addNode.name} joined the cluster`);
  }
  if (effect.removeNode) {
    state.nodes = state.nodes.filter((node) => node.name !== effect.removeNode);
    for (const pod of state.pods) {
      if (pod.node === effect.removeNode) pod.phase = "Terminating";
    }
    messages.push(`node/${effect.removeNode} left the cluster`);
  }
  if (effect.nodeNotReady) {
    const node = state.nodes.find((item) => item.name === effect.nodeNotReady);
    if (node) {
      node.ready = false;
      for (const pod of state.pods) {
        if (pod.node === node.name) pod.phase = "Terminating";
      }
      recordEvent(state, "Warning", "NodeNotReady", `node/${node.name}`, "Node stopped responding");
      messages.push(`node/${node.name} is NotReady`);
    }
  }
  if (effect.killPod) {
    const pod = state.pods.find((item) => item.name === effect.killPod);
    if (pod) {
      pod.phase = "Terminating";
      messages.push(`pod/${pod.name} was killed by the platform`);
    }
  }
  return messages;
}
