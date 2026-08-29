export interface ParsedCommand {
  raw: string;
  isKubectl: boolean;
  isShellCommand: boolean;
  shellCmd?: string;
  verb: string;
  resource?: string;
  name?: string;
  flags: Record<string, string | boolean>;
  args: string[];
  file?: string;
  redirectToFile?: string;
  redirectFile?: string;
  outputFormat?: string;
  subVerb?: string;
}

export function normalizeResource(res: string): string {
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
  if (["secret", "secrets", "sec"].includes(r)) return "secret";
  if (["event", "events", "ev"].includes(r)) return "events";
  if (["all"].includes(r)) return "all";
  return r;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed) {
    return { raw: input, isKubectl: false, isShellCommand: false, verb: "", flags: {}, args: [] };
  }

  let commandStr = trimmed;
  let redirectToFile: string | undefined;

  // Handle redirection e.g. > pod.yaml or >> pod.yaml
  const redirectMatch = commandStr.match(/(?:>>|>)\s*([^\s]+)\s*$/);
  if (redirectMatch) {
    redirectToFile = redirectMatch[1];
    commandStr = commandStr.slice(0, redirectMatch.index).trim();
  }

  const tokens = commandStr.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {
      raw: input,
      isKubectl: false,
      isShellCommand: false,
      verb: "",
      flags: {},
      args: [],
      redirectToFile,
      redirectFile: redirectToFile,
    };
  }

  const firstToken = tokens[0].toLowerCase();
  const shellCommands = ["cat", "ls", "vim", "vi", "rm", "touch", "echo", "pwd", "grep", "head", "tail", "clear", "help"];

  let isKubectl = false;
  let cmdTokens = tokens;

  if (tokens[0] === "kubectl" || tokens[0] === "k") {
    isKubectl = true;
    cmdTokens = tokens.slice(1);
  } else if (shellCommands.includes(firstToken)) {
    const verb = firstToken === "vi" ? "vim" : firstToken;
    const positionalArgs = tokens.slice(1);
    const file = positionalArgs[0];
    return {
      raw: input,
      isKubectl: false,
      isShellCommand: true,
      shellCmd: firstToken,
      verb,
      file,
      name: file,
      flags: {},
      args: positionalArgs,
      redirectToFile,
      redirectFile: redirectToFile,
    };
  }

  if (cmdTokens.length === 0) {
    return {
      raw: input,
      isKubectl: true,
      isShellCommand: false,
      verb: "",
      flags: {},
      args: [],
      redirectToFile,
      redirectFile: redirectToFile,
    };
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
      } else if (i + 1 < cmdTokens.length && !cmdTokens[i + 1].startsWith("-") && cmdTokens[i + 1] !== ">" && cmdTokens[i + 1] !== ">>") {
        flags[key] = cmdTokens[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else if (token.startsWith("-")) {
      const parts = token.slice(1).split("=");
      const key = parts[0];
      if (parts.length > 1) {
        flags[key] = parts.slice(1).join("=");
      } else if (i + 1 < cmdTokens.length && !cmdTokens[i + 1].startsWith("-") && cmdTokens[i + 1] !== ">" && cmdTokens[i + 1] !== ">>") {
        flags[key] = cmdTokens[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionalArgs.push(token);
    }
  }

  // Normalize common flags
  if (flags.f && !flags.filename) flags.filename = flags.f;
  if (flags.filename && !flags.f) flags.f = flags.filename;
  if (flags.o && !flags.output) flags.output = flags.o;
  if (flags.output && !flags.o) flags.o = flags.output;
  if (flags.n && !flags.namespace) flags.namespace = flags.n;
  if (flags.namespace && !flags.n) flags.n = flags.namespace;
  if (flags.A || flags["all-namespaces"]) {
    flags.allNamespaces = true;
    flags.A = true;
  }

  const outputFormat = (flags.output || flags.o) as string | undefined;
  let file: string | undefined = (flags.filename || flags.f || flags.file) as string | undefined;
  let resource: string | undefined;
  let name: string | undefined;
  let subVerb: string | undefined;

  if (verb === "run") {
    resource = "pod";
    name = positionalArgs[0];
  } else if (verb === "apply") {
    if (!file && positionalArgs.length > 0) {
      file = positionalArgs[0];
    }
  } else if (verb === "create") {
    if (!file && positionalArgs.length > 0 && (positionalArgs[0].endsWith(".yaml") || positionalArgs[0].endsWith(".yml") || positionalArgs[0].endsWith(".json"))) {
      file = positionalArgs[0];
    } else if (positionalArgs.length > 0) {
      if (positionalArgs[0].includes("/")) {
        const [res, n] = positionalArgs[0].split("/");
        resource = normalizeResource(res);
        name = n;
      } else {
        resource = normalizeResource(positionalArgs[0]);
        name = positionalArgs[1];
      }
    }
  } else if (verb === "delete") {
    if (!file && positionalArgs.length > 0 && (positionalArgs[0].endsWith(".yaml") || positionalArgs[0].endsWith(".yml") || positionalArgs[0].endsWith(".json"))) {
      file = positionalArgs[0];
    } else if (positionalArgs.length > 0) {
      if (positionalArgs[0].includes("/")) {
        const [res, n] = positionalArgs[0].split("/");
        resource = normalizeResource(res);
        name = n;
      } else {
        resource = normalizeResource(positionalArgs[0]);
        name = positionalArgs[1];
      }
    }
  } else if (verb === "get" || verb === "describe") {
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
    subVerb = positionalArgs[0];
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
    isShellCommand: false,
    verb,
    resource,
    name,
    flags,
    args: positionalArgs,
    file,
    redirectToFile,
    redirectFile: redirectToFile,
    outputFormat,
    subVerb,
  };
}
