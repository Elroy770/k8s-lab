import { ClusterState, Pod, ReplicaSet, Deployment, LessonStep, DaemonSet, StatefulSet, Job, CronJob, Service, ServicePort, Namespace, ConfigMapResource, SecretResource } from "./cluster-state";
import { parseCommand } from "./kubectl-parser";

export interface ExecutionResult {
  output: string;
  newState: ClusterState;
  isCorrect: boolean;
  message?: string;
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
        targetPort: String(first.nodePort || first.port),
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

  if (trimmed === "help") {
    return {
      output: `Available kubectl commands:
  kubectl run <name> --image=<image>
  kubectl get pods | rs | deployments | ds | sts | jobs | cronjobs | svc | ns | cm | secrets
  kubectl describe pod <name> | svc <name>
  kubectl delete pod <name>
  kubectl scale rs <name> --replicas=<num>
  kubectl scale deployment <name> --replicas=<num>
  kubectl set image deployment/<name> <container>=<image>
  kubectl rollout status deployment/<name>
  kubectl rollout history deployment/<name>
  kubectl rollout undo deployment/<name>
  kubectl logs <pod-name>
  kubectl events`,
      newState: state,
      isCorrect: false,
    };
  }

  const parsed = parseCommand(input);

  if (!parsed.isKubectl) {
    return {
      output: `bash: ${parsed.raw.split(" ")[0]}: command not found. Try running a kubectl command.`,
      newState: state,
      isCorrect: false,
    };
  }

  let output = "";
  const nextState: ClusterState = {
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
  };
  let matchedChallenge = false;

  const { verb, resource, name, flags, args } = parsed;

  if (verb === "run") {
    if (!name) {
      output = `error: NAME is required for run`;
    } else {
      const existing = nextState.pods.find((p) => p.name === name);
      if (existing) {
        output = `Error from server (AlreadyExists): pods "${name}" already exists`;
      } else {
        const image = (flags.image as string) || "nginx:latest";
        const newPod: Pod = {
          name,
          image,
          status: "Running",
          node: "worker-node-1",
          ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
          restarts: 0,
          age: "5s",
        };
        nextState.pods.push(newPod);
        output = `pod/${name} created`;
      }
    }
  } else if (verb === "get") {
    if (resource === "pod" || resource === "pods") {
      if (name) {
        const p = nextState.pods.find((p) => p.name === name);
        if (!p) {
          output = `Error from server (NotFound): pods "${name}" not found`;
        } else {
          output = `NAME         READY   STATUS    RESTARTS   AGE\n${p.name.padEnd(12)} 1/1     ${p.status.padEnd(9)} ${String(p.restarts).padEnd(10)} ${p.age}`;
        }
      } else {
        if (nextState.pods.length === 0) {
          output = `No resources found in default namespace.`;
        } else {
          const header = `NAME                        READY   STATUS    RESTARTS   AGE`;
          const rows = nextState.pods.map(
            (p) => `${p.name.padEnd(27)} 1/1     ${p.status.padEnd(9)} ${String(p.restarts).padEnd(10)} ${p.age}`
          );
          output = [header, ...rows].join("\n");
        }
      }
    } else if (resource === "replicaset" || resource === "rs") {
      if (nextState.replicaSets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME                   DESIRED   CURRENT   READY   AGE`;
        const rows = nextState.replicaSets.map(
          (rs) => `${rs.name.padEnd(22)} ${String(rs.desiredReplicas).padEnd(9)} ${String(rs.currentReplicas).padEnd(9)} ${String(rs.readyReplicas).padEnd(7)} ${rs.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "deployment" || resource === "deploy") {
      if (nextState.deployments.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         READY   UP-TO-DATE   AVAILABLE   AGE`;
        const rows = nextState.deployments.map(
          (d) => `${d.name.padEnd(12)} ${d.available}/${d.replicas}     ${String(d.upToDate).padEnd(12)} ${String(d.available).padEnd(11)} ${d.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "daemonset" || resource === "ds") {
      if (nextState.daemonSets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME                   DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE`;
        const rows = nextState.daemonSets.map(
          (ds) => `${ds.name.padEnd(22)} ${String(ds.desiredNodes).padEnd(9)} ${String(ds.currentPods).padEnd(9)} ${String(ds.readyPods).padEnd(7)} ${String(ds.currentPods).padEnd(12)} ${String(ds.readyPods).padEnd(11)} <none>          ${ds.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "statefulset" || resource === "sts") {
      if (nextState.statefulSets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         READY   AGE`;
        const rows = nextState.statefulSets.map(
          (sts) => `${sts.name.padEnd(12)} ${sts.readyReplicas}/${sts.replicas}     ${sts.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "job") {
      if (nextState.jobs.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         COMPLETIONS   DURATION   AGE`;
        const rows = nextState.jobs.map(
          (job) => `${job.name.padEnd(12)} ${job.succeeded}/${job.completions}           12s        ${job.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "cronjob") {
      if (nextState.cronJobs.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE`;
        const rows = nextState.cronJobs.map(
          (cj) => `${cj.name.padEnd(12)} ${cj.schedule.padEnd(13)} False     ${String(cj.active).padEnd(8)} ${cj.lastSchedule.padEnd(15)} ${cj.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "service") {
      if (nextState.services.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE`;
        const rows = nextState.services.map(
          (svc) => `${svc.name.padEnd(12)} ${svc.type.padEnd(14)} ${svc.clusterIP.padEnd(15)} ${svc.externalIP || "<none>        "} ${formatServicePorts(svc.ports).padEnd(9)} ${svc.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "namespace") {
      if (nextState.namespaces.length === 0) {
        output = `No resources found.`;
      } else {
        const header = `NAME              STATUS   AGE`;
        const rows = nextState.namespaces.map(
          (ns) => `${ns.name.padEnd(17)} ${ns.status.padEnd(8)} ${ns.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "configmap") {
      if (nextState.configMaps.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         DATA   AGE`;
        const rows = nextState.configMaps.map(
          (cm) => `${cm.name.padEnd(12)} ${String(Object.keys(cm.data || {}).length).padEnd(6)} ${cm.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else if (resource === "secret") {
      if (nextState.secrets.length === 0) {
        output = `No resources found in default namespace.`;
      } else {
        const header = `NAME         TYPE                                  DATA   AGE`;
        const rows = nextState.secrets.map(
          (sec) => `${sec.name.padEnd(12)} ${sec.type.padEnd(37)} ${String((sec.dataKeys || []).length).padEnd(6)} ${sec.age}`
        );
        output = [header, ...rows].join("\n");
      }
    } else {
      output = `error: the server doesn't have a resource type "${resource || args[0]}"`;
    }
  } else if (verb === "describe") {
    if (resource === "pod") {
      const p = nextState.pods.find((pod) => pod.name === name);
      if (!p) {
        output = `Error from server (NotFound): pods "${name}" not found`;
      } else {
        output = `Name:         ${p.name}
Namespace:    default
Priority:     0
Node:         ${p.node || "worker-node-1"}/172.18.0.3
Status:       ${p.status}
IP:           ${p.ip || "10.244.0.5"}
Containers:
  nginx:
    Container ID:   containerd://simulated-${p.name}
    Image:          ${p.image}
    Port:           80/TCP
    State:          Running
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  20s   default-scheduler  Successfully assigned default/${p.name} to ${p.node || "worker-node-1"}
  Normal  Pulling    19s   kubelet            Pulling image "${p.image}"
  Normal  Pulled     18s   kubelet            Successfully pulled image "${p.image}"
  Normal  Created    18s   kubelet            Created container nginx
  Normal  Started    18s   kubelet            Started container nginx`;
      }
    } else if (resource === "service") {
      const svc = nextState.services.find((s) => s.name === name);
      if (!svc) {
        output = `Error from server (NotFound): services "${name}" not found`;
      } else {
        const selectors = svc.selector ? Object.entries(svc.selector).map(([k, v]) => `${k}=${v}`).join(",") : "<none>";
        const { portNum, targetPort } = getServicePortInfo(svc.ports);
        output = `Name:              ${svc.name}
Namespace:         default
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
Endpoints:         10.244.0.10:80,10.244.0.11:80
Session Affinity:  None
Events:            <none>`;
      }
    } else {
      output = `describe ${resource} ${name || ""} (simulated)`;
    }
  } else if (verb === "logs") {
    const p = nextState.pods.find((pod) => pod.name === name);
    if (!p) {
      output = `Error from server (NotFound): pods "${name}" not found`;
    } else {
      output = `[simulated logs for pod ${p.name}]
2023/10/01 12:00:00 Starting application...
2023/10/01 12:00:01 Listening on port 80...
2023/10/01 12:05:00 GET / 200 OK
2023/10/01 12:05:05 GET /healthz 200 OK`;
    }
  } else if (verb === "events") {
    output = `LAST SEEN   TYPE      REASON      OBJECT       MESSAGE
12s         Normal    Scheduled   pod/nginx    Successfully assigned default/nginx to worker-node-1
11s         Normal    Pulling     pod/nginx    Pulling image "nginx:latest"
10s         Normal    Pulled      pod/nginx    Successfully pulled image "nginx:latest"
10s         Normal    Created     pod/nginx    Created container nginx
9s          Normal    Started     pod/nginx    Started container nginx`;
  } else if (verb === "delete") {
    if (resource === "pod") {
      const targetPod = name
        ? nextState.pods.find((p) => p.name === name)
        : nextState.pods[0];

      if (!targetPod) {
        output = `Error from server (NotFound): pods "${name || ""}" not found`;
      } else {
        nextState.pods = nextState.pods.filter((p) => p.name !== targetPod.name);
        output = `pod "${targetPod.name}" deleted`;

        // Check if Pod belonged to a ReplicaSet (reconciliation loop)
        if (targetPod.ownerRef && targetPod.ownerRef.kind === "ReplicaSet") {
          const parentRs = nextState.replicaSets.find(
            (rs) => rs.name === targetPod.ownerRef?.name
          );
          if (parentRs) {
            const randomSuffix = Math.random().toString(36).substring(2, 7);
            const recreatedPod: Pod = {
              name: `${parentRs.name}-${randomSuffix}`,
              image: parentRs.image,
              status: "Running",
              node: "worker-node-1",
              ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
              restarts: 0,
              ownerRef: { kind: "ReplicaSet", name: parentRs.name },
              age: "1s",
            };
            nextState.pods.push(recreatedPod);
          }
        }
      }
    } else {
      output = `error: resource type "${resource}" not deletable in this lesson`;
    }
  } else if (verb === "scale") {
    const replicasFlag = flags.replicas ? parseInt(String(flags.replicas), 10) : 3;
    if (resource === "replicaset" || resource === "rs") {
      const rs = nextState.replicaSets.find((r) => r.name === name);
      if (!rs) {
        output = `Error from server (NotFound): replicasets.apps "${name}" not found`;
      } else {
        rs.desiredReplicas = replicasFlag;
        rs.currentReplicas = replicasFlag;
        rs.readyReplicas = replicasFlag;
        // Sync pods
        const rsPods = nextState.pods.filter((p) => p.ownerRef?.name === rs.name);
        if (rsPods.length < replicasFlag) {
          const toAdd = replicasFlag - rsPods.length;
          for (let i = 0; i < toAdd; i++) {
            nextState.pods.push({
              name: `${rs.name}-${Math.random().toString(36).substring(2, 7)}`,
              image: rs.image,
              status: "Running",
              node: "worker-node-1",
              ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
              restarts: 0,
              ownerRef: { kind: "ReplicaSet", name: rs.name },
              age: "2s",
            });
          }
        } else if (rsPods.length > replicasFlag) {
          const toRemove = rsPods.length - replicasFlag;
          const keepNames = rsPods.slice(0, rsPods.length - toRemove).map((p) => p.name);
          nextState.pods = nextState.pods.filter(
            (p) => p.ownerRef?.name !== rs.name || keepNames.includes(p.name)
          );
        }
        output = `replicaset.apps/${rs.name} scaled`;
      }
    } else if (resource === "deployment" || resource === "deploy") {
      const dep = nextState.deployments.find((d) => d.name === name);
      if (!dep) {
        output = `Error from server (NotFound): deployments.apps "${name}" not found`;
      } else {
        dep.replicas = replicasFlag;
        dep.available = replicasFlag;
        dep.upToDate = replicasFlag;
        output = `deployment.apps/${dep.name} scaled`;
      }
    }
  } else if (verb === "set" && args[0] === "image") {
    // kubectl set image deployment/my-app nginx=nginx:1.19
    const dep = nextState.deployments.find((d) => d.name === (name || "my-app"));
    if (!dep) {
      output = `Error from server (NotFound): deployments.apps "${name}" not found`;
    } else {
      const imageSpec = args.find((a) => a.includes("="));
      const newImage = imageSpec ? imageSpec.split("=")[1] : "nginx:1.19";
      const oldImage = dep.image;
      dep.image = newImage;
      dep.revision += 1;

      // Old RS scaled down
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
      };
      nextState.replicaSets.push(newRs);

      // Replace Pods with new image pods
      nextState.pods = nextState.pods.filter((p) => p.ownerRef?.kind !== "Deployment" && !p.name.startsWith(dep.name));
      for (let i = 0; i < dep.replicas; i++) {
        nextState.pods.push({
          name: `${newRsName}-${Math.random().toString(36).substring(2, 7)}`,
          image: newImage,
          status: "Running",
          node: "worker-node-1",
          ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: newRsName },
          age: "1s",
        });
      }

      output = `deployment.apps/${dep.name} image updated`;
    }
  } else if (verb === "rollout") {
    const subVerb = args[0];
    const dep = nextState.deployments.find((d) => d.name === (name || "my-app"));
    if (!dep) {
      output = `Error from server (NotFound): deployments.apps "${name || "my-app"}" not found`;
    } else if (subVerb === "status") {
      output = `Waiting for deployment "${dep.name}" rollout to finish: ${dep.upToDate} of ${dep.replicas} updated replicas are available...\ndeployment "${dep.name}" successfully rolled out`;
    } else if (subVerb === "history") {
      output = `deployment.apps/${dep.name} \nREVISION  CHANGE-CAUSE\n1         <none>\n2         <none>`;
    } else if (subVerb === "undo") {
      dep.revision += 1;
      dep.image = "nginx:latest";
      // Scale down current RS, scale up old
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
      // Replace Pods
      nextState.pods = [];
      for (let i = 0; i < dep.replicas; i++) {
        nextState.pods.push({
          name: `${dep.name}-v1-${Math.random().toString(36).substring(2, 7)}`,
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: `10.244.0.${Math.floor(Math.random() * 200) + 10}`,
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: `${dep.name}-v1` },
          age: "2s",
        });
      }
      output = `deployment.apps/${dep.name} rolled back`;
    }
  } else {
    output = `unknown command: kubectl ${verb}`;
  }

  // Validate step completion
  if (currentStep && currentStep.type === "challenge" && currentStep.expected) {
    const exp = currentStep.expected;
    if (exp.verb.toLowerCase() === verb.toLowerCase()) {
      if (!exp.resource || (resource && exp.resource.toLowerCase() === resource.toLowerCase())) {
        if (!exp.name || (name && name.toLowerCase().includes(exp.name.toLowerCase())) || verb === "delete" || verb === "set" || verb === "rollout") {
          matchedChallenge = true;
        }
      }
    }
  }

  return {
    output,
    newState: nextState,
    isCorrect: matchedChallenge,
  };
}
