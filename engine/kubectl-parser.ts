import type { ParsedCommand } from "./types";

/**
 * Semantic kubectl parser.
 *
 * Commands are never compared as strings. They are tokenised and normalised
 * into { verb, subcommand, resource, names, flags } so that `kubectl get po`,
 * `kubectl get pod` and `kubectl get pods` all mean the same thing.
 */

const RESOURCE_ALIASES: Record<string, string> = {
  po: "pods",
  pod: "pods",
  pods: "pods",
  rs: "replicasets",
  replicaset: "replicasets",
  replicasets: "replicasets",
  deploy: "deployments",
  deployment: "deployments",
  deployments: "deployments",
  ds: "daemonsets",
  daemonset: "daemonsets",
  daemonsets: "daemonsets",
  sts: "statefulsets",
  statefulset: "statefulsets",
  statefulsets: "statefulsets",
  job: "jobs",
  jobs: "jobs",
  cj: "cronjobs",
  cronjob: "cronjobs",
  cronjobs: "cronjobs",
  svc: "services",
  service: "services",
  services: "services",
  ep: "endpoints",
  endpoint: "endpoints",
  endpoints: "endpoints",
  ing: "ingresses",
  ingress: "ingresses",
  ingresses: "ingresses",
  cm: "configmaps",
  configmap: "configmaps",
  configmaps: "configmaps",
  secret: "secrets",
  secrets: "secrets",
  pv: "persistentvolumes",
  persistentvolume: "persistentvolumes",
  persistentvolumes: "persistentvolumes",
  pvc: "persistentvolumeclaims",
  persistentvolumeclaim: "persistentvolumeclaims",
  persistentvolumeclaims: "persistentvolumeclaims",
  sc: "storageclasses",
  storageclass: "storageclasses",
  storageclasses: "storageclasses",
  no: "nodes",
  node: "nodes",
  nodes: "nodes",
  ns: "namespaces",
  namespace: "namespaces",
  namespaces: "namespaces",
  ev: "events",
  event: "events",
  events: "events",
  all: "all",
};

const VERB_ALIASES: Record<string, string> = {
  get: "get",
  describe: "describe",
  delete: "delete",
  del: "delete",
  run: "run",
  create: "create",
  apply: "apply",
  edit: "edit",
  scale: "scale",
  set: "set",
  label: "label",
  taint: "taint",
  annotate: "annotate",
  expose: "expose",
  rollout: "rollout",
  logs: "logs",
  exec: "exec",
  explain: "explain",
  top: "top",
  patch: "patch",
};

const VERBS_WITH_SUBCOMMAND = new Set(["rollout", "set", "create"]);

export function normaliseResource(word: string | undefined): string | undefined {
  if (!word) return undefined;
  return RESOURCE_ALIASES[word.toLowerCase()];
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Flags that consume the following token as their value. */
const VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "-l",
  "--selector",
  "-n",
  "--namespace",
  "-f",
  "--filename",
  "-c",
  "--container",
  "--image",
  "--replicas",
  "--to-revision",
  "--labels",
  "--port",
  "--target-port",
  "--node-port",
  "--type",
  "--name",
  "--from-literal",
  "--from-file",
  "--schedule",
  "--overrides",
  "--tail",
]);

const FLAG_ALIASES: Record<string, string> = {
  "-o": "output",
  "--output": "output",
  "-l": "selector",
  "--selector": "selector",
  "-n": "namespace",
  "--namespace": "namespace",
  "-f": "filename",
  "--filename": "filename",
  "-c": "container",
  "--container": "container",
  "-w": "watch",
  "--watch": "watch",
  "-A": "all-namespaces",
  "--all-namespaces": "all-namespaces",
  "-it": "interactive",
  "-i": "interactive",
  "-t": "tty",
};

const REPEATABLE = new Set(["from-literal", "from-file"]);

function flagName(raw: string): string {
  return FLAG_ALIASES[raw] ?? raw.replace(/^--?/, "");
}

export function parseCommand(raw: string): ParsedCommand {
  const base: ParsedCommand = {
    raw: raw.trim(),
    ok: false,
    verb: "",
    names: [],
    execArgs: [],
    flags: {},
    repeated: {},
  };

  const tokens = tokenize(raw);
  if (tokens.length === 0) return { ...base, error: "empty command" };

  const binary = tokens[0].toLowerCase();
  const isKubectl = binary === "kubectl" || binary === "k";
  const isShellTool = binary === "curl" || binary === "wget" || binary === "cat";
  if (!isKubectl && !isShellTool) {
    return {
      ...base,
      error: `${tokens[0]}: command not found. This lab speaks kubectl (plus curl, cat and help).`,
    };
  }

  const separator = tokens.indexOf("--");
  const execArgs = separator === -1 ? [] : tokens.slice(separator + 1);
  const rest = tokens.slice(1, separator === -1 ? undefined : separator);

  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const repeated: Record<string, string[]> = {};

  const remember = (key: string, value: string | boolean) => {
    flags[key] = value;
    if (REPEATABLE.has(key) && typeof value === "string") {
      repeated[key] = [...(repeated[key] ?? []), value];
    }
  };

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }
    if (token.includes("=")) {
      const [key, ...valueParts] = token.split("=");
      remember(flagName(key), valueParts.join("="));
      continue;
    }
    if (VALUE_FLAGS.has(token) && i + 1 < rest.length && !rest[i + 1].startsWith("-")) {
      remember(flagName(token), rest[i + 1]);
      i++;
      continue;
    }
    remember(flagName(token), true);
  }

  if (isShellTool) {
    return {
      ...base,
      ok: true,
      verb: binary === "wget" ? "curl" : binary,
      names: positional,
      execArgs,
      flags,
      repeated,
    };
  }

  if (positional.length === 0) {
    return { ...base, flags, repeated, error: "kubectl needs a verb, e.g. `kubectl get pods`." };
  }

  const verb = VERB_ALIASES[positional[0].toLowerCase()];
  if (!verb) {
    return {
      ...base,
      flags,
      repeated,
      error: `unknown command "${positional[0]}" for "kubectl". Type "help" to see what this lab supports.`,
    };
  }

  let index = 1;
  let subcommand: string | undefined;
  if (VERBS_WITH_SUBCOMMAND.has(verb) && positional[index]) {
    const candidate = positional[index].toLowerCase();
    const resolvesToResource = Boolean(normaliseResource(candidate));
    // `create deployment` is a resource; `create secret` is a subcommand.
    if (verb === "create" && resolvesToResource && candidate !== "secret" && candidate !== "secrets") {
      subcommand = undefined;
    } else {
      subcommand = candidate;
      index++;
    }
  }

  let resource: string | undefined;
  const names: string[] = [];

  for (; index < positional.length; index++) {
    const token = positional[index];
    if (token.includes("/")) {
      const [kind, name] = token.split("/");
      const resolved = normaliseResource(kind);
      if (resolved) {
        resource = resource ?? resolved;
        if (name) names.push(name);
        continue;
      }
    }
    const resolved = normaliseResource(token);
    if (resolved && !resource) {
      resource = resolved;
      continue;
    }
    names.push(token);
  }

  return { raw: raw.trim(), ok: true, verb, subcommand, resource, names, execArgs, flags, repeated };
}

export interface ExpectedCommand {
  verb?: string;
  subcommand?: string;
  resource?: string;
  name?: string;
  /** Flags that must be present; `true` means "present with any value". */
  flags?: Record<string, string | number | boolean>;
  /** A substring that must appear in the raw command, for exec/curl style steps. */
  contains?: string;
  /** Any of these alternatives satisfies the step. */
  anyOf?: ExpectedCommand[];
}

/** Intent-based matching: does this command satisfy what the lesson asked for? */
export function matchesExpectation(
  parsed: ParsedCommand,
  expected: ExpectedCommand,
): boolean {
  if (expected.anyOf?.length) {
    return expected.anyOf.some((alternative) => matchesExpectation(parsed, alternative));
  }
  if (expected.contains && !parsed.raw.toLowerCase().includes(expected.contains.toLowerCase())) {
    return false;
  }
  if (expected.verb) {
    if (!parsed.ok || parsed.verb !== expected.verb.toLowerCase()) return false;
  }
  if (expected.subcommand && parsed.subcommand !== expected.subcommand.toLowerCase()) return false;
  if (expected.resource) {
    const wanted = normaliseResource(expected.resource) ?? expected.resource;
    if (parsed.resource !== wanted) return false;
  }
  if (expected.name && !parsed.names.includes(expected.name)) return false;

  if (expected.flags) {
    for (const [key, value] of Object.entries(expected.flags)) {
      const actual = parsed.flags[key];
      if (actual === undefined) return false;
      if (value === true) continue;
      if (String(actual) !== String(value)) return false;
    }
  }
  return true;
}
