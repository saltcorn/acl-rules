// AclRulesEditor: String field ("rules" as JSON) - renders a hidden textarea + mount point that public/acl-rules-editor.js takes over.

const {
  div,
  textarea,
  script,
  domReady,
  text,
} = require("@saltcorn/markup/tags");
const { OBJECT_KINDS, SUBJECT_TYPES, VERBS, EFFECTS } = require("./rules");

// escapes "<" so an embedded name containing "</script>" can't break out of this tag
const safeJsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const AclRulesEditor = {
  type: "String",
  isEdit: true,
  blockDisplay: true,
  run: (nm, v, attrs, cls) => {
    const rndId = `acl_rules_${Math.floor(Math.random() * 16777215).toString(
      16
    )}`;
    const opts = {
      textareaId: `input${nm}`,
      mountId: `${rndId}_mount`,
      objectKinds: OBJECT_KINDS,
      subjectTypes: SUBJECT_TYPES,
      verbs: VERBS,
      effects: EFFECTS,
      // real names, fetched async by index.js's configuration_workflow
      objectNames: (attrs && attrs.objectNames) || {},
      subjectValues: (attrs && attrs.subjectValues) || {},
    };
    return div(
      { class: [cls, "acl-rules-editor-wrap"] },
      textarea(
        {
          name: nm,
          id: `input${nm}`,
          style: "display:none",
        },
        text(v || "[]")
      ),
      div({ id: opts.mountId }),
      script(
        domReady(
          `window.initAclRulesEditor && window.initAclRulesEditor(${safeJsonForScript(
            opts
          )})`
        )
      )
    );
  },
};

module.exports = { AclRulesEditor };
