export interface ParsedCommand {
  raw: string;
  isKubectl: boolean;
  verb: string;
  resource?: string;
  name?: string;
  flags: Record<string, string | boolean>;
  args: string[];
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return { raw: input, isKubectl: false, verb: "", flags: {}, args: [] };
  }

  let isKubectl = false;
  let cmdTokens = tokens;

  if (tokens[0] === "kubectl" || tokens[0] === "k") {
    isKubectl = true;
    cmdTokens = tokens.slice(1);
  }

  if (cmdTokens.length === 0) {
    return { raw: input, isKubectl: true, verb: "", flags: {}, args: [] };
  }

  const verb = cmdTokens[0]?.toLowerCase() || "";
  const flags: Record<string, string | boolean> = {};
  const positionalArgs: string[] = [];

  for (let i = 1; i < cmdTokens.length; i++) {
    const token = cmdTokens[i];
    if (token.startsWith("--")) {
      const parts = token.slice(2).split("=");
      const key = parts[0];
      if (parts.length > 1) {
        flags[key] = parts.slice(1).join("=");
      } else if (i + 1 < cmdTokens.length && !cmdTokens[i + 1].startsWith("-")) {
        flags[key] = cmdTokens[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else if (token.startsWith("-")) {
      const key = token.slice(1);
      if (i + 1 < cmdTokens.length && !cmdTokens[i + 1].startsWith("-")) {
        flags[key] = cmdTokens[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionalArgs.push(token);
    }
  }

  let resource: string | undefined;
  let name: string | undefined;

  const normalizeResource = (res: string): string => {
    const r = res.toLowerCase();
    if (["pod", "pods", "po"].includes(r)) return "pod";
    if (["replicaset", "replicasets", "rs"].includes(r)) return "replicaset";
    if (["deployment", "deployments", "deploy"].includes(r)) return "deployment";
    if (["daemonset", "daemonsets", "ds"].includes(r)) return "daemonset";
    if (["statefulset", "statefulsets", "sts"].includes(r)) return "statefulset";
    if (["job", "jobs"].includes(r)) return "job";
    if (["cronjob", "cronjobs", "cj"].includes(r)) return "cronjob";
    if (["service", "services", "svc"].includes(r)) return "service";
    if (["namespace", "namespaces", "ns"].includes(r)) return "namespace";
    if (["node", "nodes", "no"].includes(r)) return "node";
    if (["configmap", "configmaps", "cm"].includes(r)) return "configmap";
    if (["secret", "secrets"].includes(r)) return "secret";
    return r;
  };

  if (verb === "run") {
    resource = "pod";
    name = positionalArgs[0];
  } else if (verb === "get" || verb === "describe" || verb === "delete") {
    if (positionalArgs.length > 0) {
      if (positionalArgs[0].includes("/")) {
        const [res, n] = positionalArgs[0].split("/");
        resource = normalizeResource(res);
        name = n;
      } else {
        resource = normalizeResource(positionalArgs[0]);
        name = positionalArgs[1];
      }
    }
  } else if (verb === "scale") {
    if (positionalArgs.length > 0) {
      if (positionalArgs[0].includes("/")) {
        const [res, n] = positionalArgs[0].split("/");
        resource = normalizeResource(res);
        name = n;
      } else {
        resource = normalizeResource(positionalArgs[0]);
        name = positionalArgs[1];
      }
    }
  } else if (verb === "create") {
    if (positionalArgs.length > 0) {
      resource = normalizeResource(positionalArgs[0]);
      name = positionalArgs[1];
    }
  } else if (verb === "set") {
    if (positionalArgs[0] === "image") {
      resource = "deployment";
      if (positionalArgs[1]?.includes("/")) {
        const [, n] = positionalArgs[1].split("/");
        name = n;
      } else {
        name = positionalArgs[2];
      }
    }
  } else if (verb === "rollout") {
    const subVerb = positionalArgs[0];
    if (["status", "history", "undo", "restart"].includes(subVerb)) {
      const target = positionalArgs[1];
      if (target?.includes("/")) {
        const [res, n] = target.split("/");
        resource = normalizeResource(res);
        name = n;
      } else {
        resource = normalizeResource(target || "deployment");
        name = positionalArgs[2];
      }
    }
  } else if (verb === "logs") {
    if (positionalArgs.length > 0) {
      if (positionalArgs[0].includes("/")) {
        const [res, n] = positionalArgs[0].split("/");
        resource = normalizeResource(res);
        name = n;
      } else {
        resource = "pod";
        name = positionalArgs[0];
      }
    }
  } else if (verb === "events") {
    resource = "events";
  }

  return {
    raw: input,
    isKubectl,
    verb,
    resource,
    name,
    flags,
    args: positionalArgs,
  };
}
