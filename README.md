# acl-rules

A fine-grained access control plugin for Saltcorn, based on
**(Subject, Object, Verb, [Adjectives])** tuples:

- **Subject** - who: a specific user, a role, or a formula over `user` (for group-like membership)
- **Object** - what: a view, page, trigger, api route, or embedded view/page
- **Verb** - the action: `get` or `post`
- **Adjectives** - a condition formula, evaluated against `user`/`state`/`body`, that narrows when the rule applies

Rules are matched in order of specificity/priority; the first matching rule's
effect (allow/deny) decides the outcome. No matching rule means the plugin
has no opinion and Saltcorn's normal role check governs.

It builds on the `authorize_view` / `authorize_page` / `authorize_trigger` /
`authorize_api` plugin hooks added to Saltcorn core in 1.7.

## Status

Early development - this is currently an empty shell with no rule storage,
hooks, or admin UI yet.
