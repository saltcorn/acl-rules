# acl-rules

A fine-grained access control plugin for Saltcorn, based on
**(Subject, Object, Verb)** tuples:

- **Subject** - a user, a role, or a formula over `user`
- **Object** - a view, page, trigger, api route, or embedded view/page
- **Verb** - `get` or `post`

The highest-priority matching rule decides the outcome (ties keep the
earliest-listed rule; default priority for everyone is "first match wins").
A match always overrides Saltcorn's normal role check, in either direction.
No match leaves the role check in charge.

Builds on the `authorize_view`/`authorize_page`/`authorize_trigger`/
`authorize_api` plugin hooks added to Saltcorn core in 1.7.

## Status

Rules live as JSON in this plugin's own `configuration.rules`. `lib/rules.js`
re-checks the current config on every hook call, caching the parsed result
so an unchanged config isn't re-parsed. Editing goes through the plugin's
own `configuration_workflow`
(`/plugins/configure/acl-rules`) via one Form field, rendered by the
`AclRulesEditor` fieldview (`lib/fieldview.js` server side,
`public/acl-rules-editor.js` client side - a list + modal editor over a
hidden JSON textarea).

Object name and Subject value offer real names (views/pages/triggers, role
names/user emails) as datalist suggestions but stay free text, since a rule
can target something not created yet.

Not yet done: manual rule reordering, and a condition formula ("Adjectives")
to narrow a rule beyond subject/object/verb.

## Rule fields

| Field           | Meaning                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `object_kind`   | `view` \| `page` \| `trigger` \| `api`                                                                                                                                                                     |
| `object_name`   | Entity name, or `*` for any. For `api`, the route id (e.g. `scapi/sc_tables`). Secures the whole object, including its viewtemplate custom routes - no sub-route granularity.                              |
| `verb`          | `get` \| `post` \| `any`                                                                                                                                                                                   |
| `subject_type`  | `public` \| `role` \| `user` \| `formula`                                                                                                                                                                  |
| `subject_value` | Comma-separated role names/emails for `role`/`user`, or a formula over `user` for `formula`. Ignored for `public`.                                                                                         |
| `effect`        | `allow` \| `deny`                                                                                                                                                                                          |
| `priority`      | Number, default `0`. Breaks ties among acl-rules' own matching rules, and against another plugin's `authorize_*` hook, higher wins. Editor shows Low/Normal/High (-10/0/10) with a switch to a raw number. |
| `enabled`       | Toggle without deleting.                                                                                                                                                                                   |

A request with no matching enabled rule falls through to Saltcorn's normal
`min_role` check.

## Tests

`tests/rules.test.js` covers `evaluateRules()` directly (object/verb/subject
matching, wildcards, allow/deny/abstain), registering the plugin with an
in-memory `rules` config rather than going through the save form. Run with:

```
saltcorn dev:plugin-test -d /path/to/acl-rules
```
