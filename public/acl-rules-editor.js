// AclRulesEditor client widget: plain DOM + Bootstrap modal, list + modal editor over an in-memory `rules` array kept in sync with the hidden textarea.
(function () {
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null) return;
      if (k === "class") e.className = v;
      else if (k.startsWith("on") && typeof v === "function")
        e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (children || []).forEach((c) => {
      if (c == null) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function blankRule() {
    return {
      id: "r" + Math.random().toString(36).slice(2, 10),
      object_kind: "view",
      object_name: "",
      verb: "any",
      subject_type: "role",
      subject_value: "",
      effect: "allow",
      priority: 0,
      enabled: true,
    };
  }

  const PRIORITY_PRESETS = { low: -10, normal: 0, high: 10 };
  const presetKeyForValue = (v) =>
    Object.keys(PRIORITY_PRESETS).find(
      (k) => PRIORITY_PRESETS[k] === Number(v),
    ) || null;

  // modal field defs, shown in this order; showUnless(rule) hides a field
  const FIELDS = [
    {
      key: "object_kind",
      label: "Object kind",
      kind: "select",
      opts: "objectKinds",
    },
    {
      key: "object_name",
      label: "Object name",
      kind: "text",
      placeholder: "name or *",
      datalistSource: "objectNames", // suggestions only - free text so a not-yet-created target still works
      datalistKeyField: "object_kind",
      datalistExtra: ["*"], // always offered - the only real suggestion for api, which has no fixed name list
      dynamicLabel: (rule) =>
        ({
          view: "View name",
          page: "Page name",
          trigger: "Trigger name",
          api: "API route",
        })[rule.object_kind] || "Object name",
    },
    { key: "verb", label: "Verb", kind: "select", opts: "verbs" },
    {
      key: "subject_type",
      label: "Subject type",
      kind: "select",
      opts: "subjectTypes",
      optionLabels: {
        // display only - stored value matches lib/rules.js's subjectMatches() switch
        public: "Anyone (no restriction)",
        role: "Specific role(s)",
        user: "Specific user(s)",
        formula: "Formula over user",
      },
    },
    {
      key: "subject_value",
      label: "Subject value",
      kind: "text",
      placeholder: "role/user or formula",
      showUnless: (rule) => rule.subject_type === "public", // "Anyone" is a wildcard, nothing to narrow
      dynamicLabel: (rule) =>
        ({ role: "Role(s)", user: "User(s)", formula: "Formula" })[
          rule.subject_type
        ] || "Subject value",
      dynamicPlaceholder: (rule) =>
        ({
          role: "e.g. Admin,Staff (comma-separated role names)",
          user: "e.g. admin@foo.com,staff@foo.com (comma-separated emails)",
          formula: 'e.g. user.department === "Sales"',
        })[rule.subject_type] || "",
      datalistSource: "subjectValues", // suggestions only - role/user values stay free text
      datalistKeyField: "subject_type",
    },
    { key: "effect", label: "Effect", kind: "select", opts: "effects" },
    {
      key: "priority",
      label: "Priority",
      kind: "priority",
      sublabel: "Higher wins when rules conflict, even from another plugin.",
    },
    { key: "enabled", label: "Enabled", kind: "checkbox" },
  ];

  // display grouping: a pair renders side by side, a singleton full width - must cover every FIELDS key once
  const FIELD_GROUPS = [
    ["object_kind", "object_name"],
    ["verb"],
    ["subject_type", "subject_value"],
    ["priority"],
    ["effect", "enabled"],
  ];

  // catches a FIELDS/FIELD_GROUPS mismatch - a left-out field would otherwise silently never render
  (function checkFieldGroupsCoverFields() {
    const grouped = FIELD_GROUPS.flat();
    const fieldKeys = FIELDS.map((f) => f.key);
    const missing = fieldKeys.filter((k) => !grouped.includes(k));
    const extra = grouped.filter((k) => !fieldKeys.includes(k));
    if (missing.length || extra.length)
      console.error("acl-rules editor: FIELD_GROUPS doesn't match FIELDS.", {
        missing,
        extra,
      });
  })();

  window.initAclRulesEditor = function (opts) {
    const textarea = document.getElementById(opts.textareaId);
    const mount = document.getElementById(opts.mountId);
    if (!textarea || !mount) return;
    if (mount.dataset.aclRulesInit) return; // avoid double-init
    mount.dataset.aclRulesInit = "1";

    let rules;
    try {
      rules = JSON.parse(textarea.value || "[]");
      if (!Array.isArray(rules)) rules = [];
    } catch (e) {
      rules = [];
    }

    function sync() {
      textarea.value = JSON.stringify(rules);
      // setting .value doesn't fire "change" - the plugin config page autosaves on it, so dispatch one
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // --- modal (shared for add and edit) ---
    const modalId = opts.mountId + "_modal";
    let editingIndex = null; // null => creating a new rule
    const modalInputs = {};

    function fieldControl(f) {
      if (f.kind === "priority") {
        const select = el("select", { class: "form-select" }, [
          el("option", { value: "low" }, ["Low (-10)"]),
          el("option", { value: "normal" }, ["Normal (0)"]),
          el("option", { value: "high" }, ["High (10)"]),
        ]);
        const number = el("input", {
          type: "number",
          class: "form-control",
          step: "1",
        });
        number.hidden = true;
        const switchLink = el(
          "a",
          {
            href: "javascript:void(0)",
            class: "small",
            onclick: () => {
              const toNumber = !select.hidden;
              select.hidden = toNumber;
              number.hidden = !toNumber;
              switchLink.textContent = toNumber
                ? "Use Low/Normal/High"
                : "Use a custom number";
              if (toNumber) number.value = PRIORITY_PRESETS[select.value];
              else select.value = presetKeyForValue(number.value) || "normal";
            },
          },
          ["Use a custom number"],
        );
        modalInputs.priority_select = select;
        modalInputs.priority_number = number;
        modalInputs.priority_switch = switchLink;
        return el("div", {}, [select, number, switchLink]);
      }
      if (f.kind === "select") {
        const sel = el("select", { class: "form-select" });
        opts[f.opts].forEach((o) =>
          sel.appendChild(
            el("option", { value: o }, [
              (f.optionLabels && f.optionLabels[o]) || o,
            ]),
          ),
        );
        modalInputs[f.key] = sel;
        return sel;
      }
      if (f.kind === "checkbox") {
        const inp = el("input", {
          type: "checkbox",
          class: "form-check-input",
        });
        modalInputs[f.key] = inp;
        return el("div", { class: "form-check" }, [inp]);
      }
      const attrs = {
        type: "text",
        class: "form-control",
        placeholder: f.placeholder || "",
      };
      if (f.datalistSource) {
        const datalistId = `${opts.mountId}_${f.key}_list`;
        attrs.list = datalistId;
        const datalist = el("datalist", { id: datalistId });
        fieldDatalists[f.key] = datalist;
        const inp = el("input", attrs);
        modalInputs[f.key] = inp;
        return el("span", {}, [inp, datalist]);
      }
      const inp = el("input", attrs);
      modalInputs[f.key] = inp;
      return inp;
    }

    const fieldsByKey = {};
    FIELDS.forEach((f) => (fieldsByKey[f.key] = f));

    const fieldWrappers = {};
    const fieldLabels = {};
    const fieldDatalists = {};
    function fieldEntry(key) {
      const f = fieldsByKey[key];
      const label = el("label", { class: "form-label" }, [f.label]);
      const children = [label, fieldControl(f)];
      if (f.sublabel)
        children.push(
          el("small", { class: "form-text text-muted d-block" }, [f.sublabel]),
        );
      const wrapper = el("div", { class: "mb-3" }, children);
      fieldWrappers[key] = wrapper;
      fieldLabels[key] = label;
      return wrapper;
    }

    const modalBody = el(
      "div",
      { class: "modal-body" },
      FIELD_GROUPS.map((keys) =>
        keys.length === 1
          ? fieldEntry(keys[0])
          : el(
              "div",
              { class: "row" },
              keys.map((k) => el("div", { class: "col-6" }, [fieldEntry(k)])),
            ),
      ),
    );

    function updateFieldVisibility() {
      const rule = {
        object_kind: modalInputs.object_kind.value,
        subject_type: modalInputs.subject_type.value,
      };
      FIELDS.forEach((f) => {
        if (f.showUnless) fieldWrappers[f.key].hidden = f.showUnless(rule);
        if (f.dynamicLabel)
          fieldLabels[f.key].textContent = f.dynamicLabel(rule);
        if (f.dynamicPlaceholder)
          modalInputs[f.key].placeholder = f.dynamicPlaceholder(rule);
        if (f.datalistSource) {
          const datalist = fieldDatalists[f.key];
          const names = [
            ...(f.datalistExtra || []),
            ...((opts[f.datalistSource] || {})[rule[f.datalistKeyField]] || []),
          ];
          datalist.innerHTML = "";
          names.forEach((n) =>
            datalist.appendChild(el("option", { value: n })),
          );
        }
      });
    }
    modalInputs.object_kind.addEventListener("change", updateFieldVisibility);
    modalInputs.subject_type.addEventListener("change", updateFieldVisibility);
    // a value typed for the old kind/type (e.g. a view name, a role list)
    // rarely makes sense for the new one - only on an actual user change,
    // not on modal open, where updateFieldVisibility() also runs
    modalInputs.object_kind.addEventListener("change", () => {
      modalInputs.object_name.value = "";
    });
    modalInputs.subject_type.addEventListener("change", () => {
      modalInputs.subject_value.value = "";
    });

    const saveBtn = el(
      "button",
      { type: "button", class: "btn btn-primary", onclick: onModalSave },
      ["Save"],
    );

    const modalEl = el(
      "div",
      { class: "modal fade", id: modalId, tabindex: "-1" },
      [
        el("div", { class: "modal-dialog" }, [
          el("div", { class: "modal-content" }, [
            el("div", { class: "modal-header" }, [
              el("h5", { class: "modal-title" }, ["Rule"]),
              el("button", {
                type: "button",
                class: "btn-close",
                "data-bs-dismiss": "modal",
              }),
            ]),
            modalBody,
            el("div", { class: "modal-footer" }, [
              el(
                "button",
                {
                  type: "button",
                  class: "btn btn-secondary",
                  "data-bs-dismiss": "modal",
                },
                ["Cancel"],
              ),
              saveBtn,
            ]),
          ]),
        ]),
      ],
    );
    document.body.appendChild(modalEl);
    const bsModal = window.bootstrap && new window.bootstrap.Modal(modalEl);

    function openModal(index) {
      editingIndex = index;
      const rule = index == null ? blankRule() : rules[index];
      FIELDS.forEach((f) => {
        if (f.kind === "priority") {
          const val = Number(rule.priority) || 0;
          const presetKey = presetKeyForValue(val);
          modalInputs.priority_select.value = presetKey || "normal";
          modalInputs.priority_number.value = val;
          modalInputs.priority_select.hidden = !presetKey;
          modalInputs.priority_number.hidden = !!presetKey;
          modalInputs.priority_switch.textContent = presetKey
            ? "Use a custom number"
            : "Use Low/Normal/High";
          return;
        }
        const inp = modalInputs[f.key];
        if (f.kind === "checkbox") inp.checked = rule[f.key] !== false;
        else
          inp.value =
            rule[f.key] || (f.kind === "select" ? inp.options[0].value : "");
      });
      updateFieldVisibility();
      if (bsModal) bsModal.show();
    }

    function onModalSave() {
      const rule = {
        id: editingIndex == null ? blankRule().id : rules[editingIndex].id,
      };
      FIELDS.forEach((f) => {
        if (fieldWrappers[f.key].hidden) return; // don't save a hidden field's stale value
        if (f.kind === "priority") {
          rule.priority = modalInputs.priority_select.hidden
            ? Number(modalInputs.priority_number.value) || 0
            : PRIORITY_PRESETS[modalInputs.priority_select.value];
          return;
        }
        const inp = modalInputs[f.key];
        rule[f.key] = f.kind === "checkbox" ? inp.checked : inp.value;
      });
      if (!rule.object_name) {
        modalInputs.object_name.classList.add("is-invalid");
        return;
      }
      modalInputs.object_name.classList.remove("is-invalid");
      if (rule.subject_type !== "public" && !rule.subject_value) {
        modalInputs.subject_value.classList.add("is-invalid");
        return;
      }
      modalInputs.subject_value.classList.remove("is-invalid");
      if (editingIndex == null) rules.push(rule);
      else rules[editingIndex] = rule;
      sync();
      renderList();
      if (bsModal) bsModal.hide();
    }

    // --- list ---
    function subjectSummary(rule) {
      if (rule.subject_type === "public") return "Anyone";
      return `${rule.subject_type}: ${rule.subject_value || ""}`;
    }

    function activeCell(rule) {
      const active = rule.enabled !== false;
      return el("td", { style: "text-align:center" }, [
        el(
          "span",
          {
            style: `color:${active ? "#198754" : "#dc3545"}; font-weight:bold`,
            title: active ? "Active" : "Inactive",
          },
          [active ? "✓" : "✗"],
        ),
      ]);
    }

    function prioritySummary(rule) {
      const value = Number(rule.priority) || 0;
      const key = presetKeyForValue(value);
      return key
        ? `${key[0].toUpperCase()}${key.slice(1)} (${value})`
        : String(value);
    }

    // display-only sort, never reorders the stored `rules` array. Defaults
    // to priority descending - highest (most likely to win) on top.
    let sortKey = "priority";
    let sortDir = -1;

    function renderList() {
      mount.innerHTML = "";
      const headers = [
        { label: "Kind" },
        { label: "Object" },
        { label: "Verb" },
        { label: "Subject" },
        { label: "Effect" },
        { key: "priority", label: "Priority" },
        { label: "Active" },
        { label: "" },
      ];
      const thead = el("thead", {}, [
        el(
          "tr",
          {},
          headers.map((h) =>
            el(
              "th",
              h.key
                ? {
                    style: "cursor:pointer; user-select:none",
                    title:
                      "Sort - display only, doesn't reorder the saved rule list (which still breaks priority ties)",
                    onclick: () => {
                      sortDir = sortKey === h.key ? -sortDir : -1;
                      sortKey = h.key;
                      renderList();
                    },
                  }
                : {},
              [
                h.label +
                  (h.key && sortKey === h.key
                    ? sortDir === 1
                      ? " ▲"
                      : " ▼"
                    : ""),
              ],
            ),
          ),
        ),
      ]);
      const tbody = el("tbody");
      const order = rules.map((_, i) => i);
      if (sortKey === "priority")
        order.sort(
          (a, b) =>
            sortDir *
            ((Number(rules[a].priority) || 0) -
              (Number(rules[b].priority) || 0)),
        );
      order.forEach((i) => {
        const rule = rules[i];
        const cell = (text) => el("td", {}, [text]);
        tbody.appendChild(
          el("tr", {}, [
            cell(rule.object_kind),
            cell(rule.object_name),
            cell(rule.verb),
            cell(subjectSummary(rule)),
            cell(rule.effect),
            cell(prioritySummary(rule)),
            activeCell(rule),
            el("td", {}, [
              el(
                "button",
                {
                  type: "button",
                  class: "btn btn-sm btn-outline-secondary me-1",
                  onclick: () => openModal(i),
                },
                ["Edit"],
              ),
              el(
                "button",
                {
                  type: "button",
                  class: "btn btn-sm btn-outline-danger",
                  onclick: () => {
                    rules.splice(i, 1);
                    sync();
                    renderList();
                  },
                },
                ["Delete"],
              ),
            ]),
          ]),
        );
      });
      const table = el("table", {
        class: "table table-sm table-bordered align-middle acl-rules-table",
      });
      table.appendChild(thead);
      table.appendChild(tbody);
      mount.appendChild(table);
      mount.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "btn btn-sm btn-primary",
            onclick: () => openModal(null),
          },
          [el("i", { class: "fas fa-plus me-1" }), "Add rule"],
        ),
      );
      sync();
    }

    renderList();

    // safety net - every edit already calls sync()
    const form = textarea.closest("form");
    if (form) form.addEventListener("submit", sync);
  };
})();
