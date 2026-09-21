// ACL rules plugin: (Subject, Object, Verb) access control via authorize_* hooks. See README.md.

const Form = require("@saltcorn/data/models/form");
const Workflow = require("@saltcorn/data/models/workflow");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const Trigger = require("@saltcorn/data/models/trigger");
const User = require("@saltcorn/data/models/user");
const { getState } = require("@saltcorn/data/db/state");
const { evaluateRules, parseRules } = require("./lib/rules");
const { AclRulesEditor } = require("./lib/fieldview");

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Rules",
        form: async () => {
          // fetched here since fieldview.run() must stay synchronous
          const [views, pages, triggers, users] = await Promise.all([
            View.find(),
            Page.find(),
            Trigger.find({}),
            User.find({}),
          ]);
          const objectNames = {
            view: views.map((v) => v.name),
            page: pages.map((p) => p.name),
            trigger: triggers.map((t) => t.name),
          };
          const subjectValues = {
            role: (getState().roles || []).map((r) => r.role),
            user: users.map((u) => u.email),
          };
          return new Form({
            blurb:
              "Access rules as (Subject, Object, Verb) tuples. Among matching " +
              "enabled rules, the highest priority decides allow/deny (ties go " +
              "to the earliest-listed rule); no match leaves Saltcorn's normal " +
              "role check in charge.",
            fields: [
              {
                name: "rules",
                label: "Rules",
                type: "String",
                fieldview: "AclRulesEditor",
                attributes: { objectNames, subjectValues },
              },
            ],
            validator: (vals) => {
              const { error } = parseRules(vals.rules);
              return error; // undefined => valid, Form treats that as no error
            },
          });
        },
      },
    ],
  });

const authorizeHook = (kind) => () => async (request, user) =>
  evaluateRules(kind, request, user);
const authorize_view = authorizeHook("view");
const authorize_page = authorizeHook("page");
const authorize_trigger = authorizeHook("trigger");
const authorize_api = authorizeHook("api");

module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: "acl-rules",
  configuration_workflow,
  fieldviews: () => ({ AclRulesEditor }), // must be (cfg)=>value once configuration_workflow is set
  headers: () => [{ script: "/plugins/public/acl-rules/acl-rules-editor.js" }],
  authorize_view,
  authorize_page,
  authorize_trigger,
  authorize_api,
};
