# UI Control Matrix

> Required by SPEC §6.2: "A file UI_CONTROL_MATRIX.md must exist listing all controls and handlers."
>
> Every IPC-triggering UI control must have a listed handler, and every handler must have a listed control.

---

## Top Bar Controls

| Control | Type | IPC Channel / Action | Handler Location |
|---|---|---|---|
| Env input | text input | (config state only – no IPC) | `app/renderer/App.tsx` state |
| Browser select | dropdown | (config state only – no IPC) | `app/renderer/App.tsx` state |
| Headed toggle | checkbox | (config state only – no IPC) | `app/renderer/App.tsx` state |
| Auth select | dropdown | (config state only – no IPC) | `app/renderer/App.tsx` state |
| Policy select | dropdown | (config state + confirmation) | `app/renderer/components/TopBar.tsx` |
| ▶ Run button | button | delegates to active screen | `app/renderer/App.tsx` → `screenRunRef` |

---

## Chat Screen Controls

| Control | Type | IPC Channel | Handler Location |
|---|---|---|---|
| ▶ Run button | button | `executeCommand` | `app/main/ipc/handlers.ts` |
| Ctrl+Enter / ⌘+Enter | keyboard shortcut | `executeCommand` | `app/main/ipc/handlers.ts` |
| 💾 Save as Test button | button | `saveTest` | `app/main/ipc/handlers.ts` |

---

## IPC Handlers

| Channel | Trigger(s) | Handler Location | Notes |
|---|---|---|---|
| `executeCommand` | Chat ▶ Run, TopBar ▶ Run (in Chat) | `app/main/ipc/handlers.ts` | Persists Run to `runs/` |
| `executeTest` | (wired in future milestone – Test Library) | `app/main/ipc/handlers.ts` | Persists Run to `runs/` |
| `getRunHistory` | (wired in future milestone – Runs screen) | `app/main/ipc/handlers.ts` | Reads `runs/*.json` |
| `saveTest` | Chat 💾 Save as Test | `app/main/ipc/handlers.ts` | Persists TestCase to `tests/` |

---

## Planned Controls (Future Milestones)

| Control | Screen | IPC Channel | Notes |
|---|---|---|---|
| Run test button | Test Library | `executeTest` | MVP2 |
| Export button | Run History | `ExportRun` | MVP2 |
| Update Session button | Settings | `UpdateSession` | MVP2 |
