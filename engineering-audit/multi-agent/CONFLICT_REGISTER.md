# Conflict Register

| ID | Area | Conflict | Status | Resolution |
|---|---|---|---|---|
| C-001 | Worktree | Many modified and untracked files pre-exist this orchestration run. | Open | Do not revert; avoid broad writes; inspect diffs before any future implementation. |
| C-002 | Shared manifests | Backend, QA, and DevOps may all need route/access/job/OpenAPI manifests. | Watch | Assign one writer per manifest during implementation. |
| C-003 | Membership model | `class_students` and `class_enrollments` cutover touches helpers, RLS, routes, and tests. | Watch | Sequence architecture/backend before UI and QA verification. |
| C-004 | Moving inventory counts | A/B cited 258 admin-client routes; independent review/current check shows 257. | Open | Freeze manifests and rerun counts before Stage 2 tasks. |
| C-005 | Runtime vs static readiness | Static repo gates can pass while live evidence remains red. | Open | Keep repo-owned gates and operator-owned evidence separate in all reports. |
