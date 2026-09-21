const { getState } = require("@saltcorn/data/db/state");
const { evaluateRules, parseRules } = require("../lib/rules");
const {
  afterAll,
  beforeAll,
  describe,
  it,
  expect,
} = require("@saltcorn/db-common/test_expect");

getState().registerPlugin("base", require("@saltcorn/data/base-plugin"));

afterAll(require("@saltcorn/data/db").close);
beforeAll(async () => {
  // works when the cli command is called with '-f' like this:
  //   saltcorn dev:plugin-test -d [PATH_TO_LOCAL_PLUGIN]/acl-rules
  await getState().refresh(true);
});

// registers the plugin with a fixed rules config - evaluateRules() always
// reads getState().plugin_cfgs["acl-rules"] fresh, so this is enough to
// drive it directly without going through the save form
function setRules(rules) {
  getState().registerPlugin("acl-rules", require(".."), {
    rules: JSON.stringify(rules),
  });
}

const admin = { id: 1, role_id: 1, email: "admin@foo.com" };
const staff = { id: 2, role_id: 40, email: "staff@foo.com" };
const anon = undefined;

const viewRequest = (name, overrides) => ({
  action: "get",
  view: { name },
  req: {},
  ...overrides,
});

describe("acl-rules: evaluateRules", () => {
  it("abstains (returns null) when there are no rules", () => {
    setRules([]);
    expect(evaluateRules("view", viewRequest("Any"), admin)).toBe(null);
  });

  it("abstains when no rule's object matches", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "OtherView",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("MyView"), admin)).toBe(null);
  });

  it("matches object_name '*' for any object", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "*",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("AnyView"), admin)).toMatchObject({
      decision: "deny",
    });
  });

  it("subject_type public matches anyone, including no user", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "allow",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), anon)).toMatchObject({
      decision: "allow",
    });
  });

  it("subject_type role matches by role name, not id", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "role",
        subject_value: "staff",
        effect: "allow",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), staff)).toMatchObject({
      decision: "allow",
    });
    // admin's role name is "admin", not "staff" - no match, abstain
    expect(evaluateRules("view", viewRequest("V"), admin)).toBe(null);
  });

  it("subject_type role matches case-insensitively", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "role",
        subject_value: "STAFF",
        effect: "allow",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), staff)).toMatchObject({
      decision: "allow",
    });
  });

  it("subject_type role accepts a comma-separated list of names", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "role",
        subject_value: "admin, staff",
        effect: "allow",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), staff)).toMatchObject({
      decision: "allow",
    });
    expect(evaluateRules("view", viewRequest("V"), admin)).toMatchObject({
      decision: "allow",
    });
  });

  it("subject_type user matches by email, case-insensitively", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "user",
        subject_value: "Admin@Foo.com",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toMatchObject({
      decision: "deny",
    });
    expect(evaluateRules("view", viewRequest("V"), staff)).toBe(null);
    expect(evaluateRules("view", viewRequest("V"), anon)).toBe(null);
  });

  it("subject_type formula evaluates over user", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "formula",
        subject_value: "user.id === 2",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), staff)).toMatchObject({
      decision: "deny",
    });
    expect(evaluateRules("view", viewRequest("V"), admin)).toBe(null);
  });

  it("a broken subject formula fails closed (never matches)", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "formula",
        subject_value: "user.((",
        effect: "allow",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toBe(null);
  });

  it("verb must match unless the rule verb is 'any'", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "post",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(
      evaluateRules("view", viewRequest("V", { action: "get" }), admin)
    ).toBe(null);
    expect(
      evaluateRules("view", viewRequest("V", { action: "post" }), admin)
    ).toMatchObject({ decision: "deny" });
  });

  it("a disabled rule is skipped", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "deny",
        enabled: false,
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toBe(null);
  });

  it("with equal priority, the first matching rule wins over later ones", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "allow",
      },
      {
        id: "r2",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toMatchObject({
      decision: "allow",
    });
  });

  it("a higher-priority match wins over an earlier lower-priority one", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "allow", // priority defaults to 0
      },
      {
        id: "r2",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "deny",
        priority: 10,
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toMatchObject({
      decision: "deny",
      priority: 10,
    });
  });

  it("only applies to the matching object_kind", () => {
    setRules([
      {
        id: "r1",
        object_kind: "page",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toBe(null);
    expect(
      evaluateRules(
        "page",
        { action: "get", page: { name: "V" }, req: {} },
        admin
      )
    ).toMatchObject({ decision: "deny" });
  });

  it("matches api rules against request.route", () => {
    setRules([
      {
        id: "r1",
        object_kind: "api",
        object_name: "scapi/sc_tables",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(
      evaluateRules(
        "api",
        { action: "get", route: "scapi/sc_tables", req: {} },
        admin
      )
    ).toMatchObject({ decision: "deny" });
    expect(
      evaluateRules(
        "api",
        { action: "get", route: "scapi/other", req: {} },
        admin
      )
    ).toBe(null);
  });

  it("defaults priority to 0, and passes through an explicit value", () => {
    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toEqual({
      decision: "deny",
      priority: 0,
    });

    setRules([
      {
        id: "r1",
        object_kind: "view",
        object_name: "V",
        verb: "any",
        subject_type: "public",
        effect: "deny",
        priority: 10,
      },
    ]);
    expect(evaluateRules("view", viewRequest("V"), admin)).toEqual({
      decision: "deny",
      priority: 10,
    });
  });

  it("ignores a corrupt stored config and abstains", () => {
    getState().registerPlugin("acl-rules", require(".."), {
      rules: "not json",
    });
    expect(evaluateRules("view", viewRequest("V"), admin)).toBe(null);
  });

  it("keeps other valid rules when one stored rule is individually invalid", () => {
    getState().registerPlugin("acl-rules", require(".."), {
      rules: JSON.stringify([
        { id: "bad", object_kind: "view" }, // missing required fields
        {
          id: "r2",
          object_kind: "view",
          object_name: "V",
          verb: "any",
          subject_type: "public",
          effect: "deny",
        },
      ]),
    });
    expect(evaluateRules("view", viewRequest("V"), admin)).toMatchObject({
      decision: "deny",
    });
  });
});

describe("acl-rules: parseRules", () => {
  it("accepts an empty/missing rules string", () => {
    expect(parseRules(undefined)).toEqual({ rules: [] });
    expect(parseRules("")).toEqual({ rules: [] });
  });

  it("rejects invalid JSON", () => {
    expect(parseRules("{not json").error).toMatch(/not valid JSON/);
  });

  it("rejects a non-array", () => {
    expect(parseRules("{}").error).toMatch(/must be a JSON array/);
  });

  it("rejects a rule missing a required field", () => {
    expect(
      parseRules(JSON.stringify([{ id: "r1", object_kind: "view" }])).error
    ).toBeTruthy();
  });

  it("rejects a non-numeric priority", () => {
    const rule = {
      id: "r1",
      object_kind: "view",
      object_name: "V",
      verb: "any",
      subject_type: "public",
      effect: "deny",
      priority: "high",
    };
    expect(parseRules(JSON.stringify([rule])).error).toMatch(
      /priority must be a number/
    );
  });

  it("rejects an empty subject_value for role/user/formula", () => {
    const base = {
      id: "r1",
      object_kind: "view",
      object_name: "V",
      verb: "any",
      effect: "deny",
    };
    for (const subject_type of ["role", "user", "formula"]) {
      expect(
        parseRules(JSON.stringify([{ ...base, subject_type }])).error
      ).toMatch(/subject_value is required/);
    }
    // public doesn't need one
    expect(
      parseRules(JSON.stringify([{ ...base, subject_type: "public" }])).error
    ).toBeFalsy();
  });

  it("rejects a whitespace-only object_name or subject_value", () => {
    const base = {
      id: "r1",
      object_kind: "view",
      verb: "any",
      subject_type: "role",
      subject_value: "staff",
      effect: "deny",
    };
    expect(
      parseRules(JSON.stringify([{ ...base, object_name: "   " }])).error
    ).toMatch(/object_name is required/);
    expect(
      parseRules(
        JSON.stringify([{ ...base, object_name: "V", subject_value: "   " }])
      ).error
    ).toMatch(/subject_value is required/);
  });

  it("rejects a non-boolean enabled", () => {
    const rule = {
      id: "r1",
      object_kind: "view",
      object_name: "V",
      verb: "any",
      subject_type: "public",
      effect: "deny",
      enabled: "false",
    };
    expect(parseRules(JSON.stringify([rule])).error).toMatch(
      /enabled must be a boolean/
    );
  });

  it("accepts a well-formed rule list", () => {
    const rules = [
      {
        id: "r1",
        object_kind: "view",
        object_name: "*",
        verb: "any",
        subject_type: "public",
        effect: "deny",
      },
    ];
    expect(parseRules(JSON.stringify(rules))).toEqual({ rules });
  });
});
