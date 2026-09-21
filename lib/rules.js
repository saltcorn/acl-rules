// Rule storage, matching and evaluation for the (Subject, Object, Verb) model. Rules live in configuration.rules as JSON; hooks read them fresh every call.

const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { eval_expression } = require("@saltcorn/data/models/expression");

const PLUGIN_NAME = "acl-rules";
// _sc_roles.id -> _sc_roles.role name, populated by core, no DB call needed
const roleNameForId = (role_id) =>
  (getState().roles || []).find((r) => r.id === role_id)?.role || null;

const OBJECT_KINDS = ["view", "page", "trigger", "api"];
const SUBJECT_TYPES = ["public", "role", "user", "formula"];
const VERBS = ["get", "post", "any"];
const EFFECTS = ["allow", "deny"];

// Validates a single rule. Returns an error string, or null if valid.
function validateRule(r, where) {
  if (!r || typeof r !== "object") return `${where}: not an object`;
  if (!r.id) return `${where}: missing id`;
  if (!OBJECT_KINDS.includes(r.object_kind))
    return `${where}: invalid object_kind "${r.object_kind}"`;
  if (!String(r.object_name || "").trim())
    return `${where}: object_name is required`;
  if (!VERBS.includes(r.verb)) return `${where}: invalid verb "${r.verb}"`;
  if (!SUBJECT_TYPES.includes(r.subject_type))
    return `${where}: invalid subject_type "${r.subject_type}"`;
  if (r.subject_type !== "public" && !String(r.subject_value || "").trim())
    return `${where}: subject_value is required for subject_type "${r.subject_type}"`;
  if (!EFFECTS.includes(r.effect))
    return `${where}: invalid effect "${r.effect}"`;
  if (r.priority !== undefined && typeof r.priority !== "number")
    return `${where}: priority must be a number`;
  if (r.enabled !== undefined && typeof r.enabled !== "boolean")
    return `${where}: enabled must be a boolean`;
  return null;
}

// Parses and validates a rules JSON string. Returns {rules} or {error} - gates a save, all-or-nothing.
function parseRules(json) {
  if (!json) return { rules: [] };
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { error: `Rules are not valid JSON: ${e.message}` };
  }
  if (!Array.isArray(parsed)) return { error: "Rules must be a JSON array" };
  for (const [i, r] of parsed.entries()) {
    const error = validateRule(r, `rule ${i + 1}`);
    if (error) return { error };
  }
  return { rules: parsed };
}

// cache keyed on tenant + raw string, not object identity (which changes on
// every read) - avoids re-parsing when the rules haven't actually changed
const parsedRulesCache = new Map(); // tenant schema -> { raw, rules }

// Rules currently in effect, never throws. Drops only individually-invalid
// rules, so one corrupt entry can't silently disable the rest, deny rules included.
function getRules() {
  const cfg = getState().plugin_cfgs[PLUGIN_NAME];
  if (!cfg || typeof cfg.rules !== "string") return [];
  const tenant = db.getTenantSchema();
  const cached = parsedRulesCache.get(tenant);
  if (cached && cached.raw === cfg.rules) return cached.rules;
  let parsed;
  try {
    parsed = JSON.parse(cfg.rules);
  } catch (e) {
    getState().log(
      2,
      `acl-rules: stored rules are not valid JSON, ignoring: ${e.message}`
    );
    parsedRulesCache.set(tenant, { raw: cfg.rules, rules: [] });
    return [];
  }
  if (!Array.isArray(parsed)) {
    getState().log(2, "acl-rules: stored rules are not a JSON array, ignoring");
    parsedRulesCache.set(tenant, { raw: cfg.rules, rules: [] });
    return [];
  }
  const rules = [];
  parsed.forEach((r, i) => {
    const error = validateRule(r, `rule ${i + 1}`);
    if (error)
      getState().log(2, `acl-rules: dropping invalid stored rule: ${error}`);
    else rules.push(r);
  });
  parsedRulesCache.set(tenant, { raw: cfg.rules, rules });
  return rules;
}

function objectNameMatches(rule, kind, request) {
  if (kind === "api")
    return rule.object_name === "*" || rule.object_name === request.route;
  const entity = request[kind]; // request.view / request.page / request.trigger
  const name = entity && entity.name;
  return rule.object_name === "*" || rule.object_name === name;
}

function verbMatches(rule, request) {
  return rule.verb === "any" || rule.verb === request.action;
}

function subjectMatches(rule, user) {
  const role_id = user && user.id ? user.role_id : 100;
  switch (rule.subject_type) {
    case "public":
      return true;
    case "role": {
      const roleName = roleNameForId(role_id);
      return (
        !!roleName &&
        splitNames(rule.subject_value)
          .map((s) => s.toLowerCase())
          .includes(roleName.toLowerCase())
      );
    }
    case "user":
      return (
        !!(user && user.email) &&
        splitNames(rule.subject_value)
          .map((s) => s.toLowerCase())
          .includes(String(user.email).toLowerCase())
      );
    case "formula":
      try {
        return !!eval_expression(
          rule.subject_value,
          { user },
          user,
          `acl-rules subject formula (rule ${rule.id})`
        );
      } catch (e) {
        getState().log(
          2,
          `acl-rules: subject formula error in rule ${rule.id}: ${e.message}`
        );
        return false; // fail closed - a broken formula never matches
      }
    default:
      return false;
  }
}

function splitNames(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Among enabled matches, highest priority wins; ties keep the earliest one
// (so default priority 0 for everyone means "first match wins", as before).
function evaluateRules(kind, request, user) {
  const rules = getRules();
  let best = null;
  let bestPriority = -Infinity;
  for (const rule of rules) {
    if (rule.enabled === false || rule.object_kind !== kind) continue;
    if (!objectNameMatches(rule, kind, request)) continue;
    if (!verbMatches(rule, request)) continue;
    if (!subjectMatches(rule, user)) continue;
    const priority = Number(rule.priority) || 0;
    if (!best || priority > bestPriority) {
      best = rule;
      bestPriority = priority;
    }
  }
  if (!best) return null;
  return {
    decision: best.effect === "allow" ? "allow" : "deny",
    priority: bestPriority,
  };
}

module.exports = {
  PLUGIN_NAME,
  OBJECT_KINDS,
  SUBJECT_TYPES,
  VERBS,
  EFFECTS,
  parseRules,
  getRules,
  evaluateRules,
};
