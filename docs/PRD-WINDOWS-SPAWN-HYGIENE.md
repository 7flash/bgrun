# PRD: Windows Spawn Hygiene

## Problem

PowerShell probes and detached managed processes open visible console windows on Windows. Managed child environments can also contain both `Path` and `PATH`, leaving executable resolution dependent on which duplicate a child observes.

## Constraints

- Preserve behavior on non-Windows platforms.
- Do not change commands, process ownership, detachment, or stdio behavior.
- Apply fixes in source and regenerate all distribution bundles through the normal build.

## Acceptance Criteria

- [x] PowerShell probes use `windowsHide: true`.
- [x] Managed processes, watcher processes, and the dashboard use `windowsHide: true`.
- [x] Windows parent environments normalize every case variant of `Path` to one `PATH` key.
- [x] The normalized `PATH` retains the original entries and prepends Bun's executable directory.
- [x] Tests and production build pass.

## Solution Sketch

Set Bun's `windowsHide` spawn option on all background and PowerShell spawn sites identified in the 4.1.0 patch. Normalize the PATH key while copying the parent environment before prepending Bun's directory. Add a regression test for mixed-case Windows PATH handling and rebuild the distribution bundles.
