# Verification scope

The regression suite covers session scheduling, profile identity checks, dialog handling, per-platform device ownership, AI consent and credential storage, browser/IPC boundaries, Android controls, and Windows OCR validation. Tests use mocks and sanitized fixtures and do not send account actions.

The CI matrix checks Node 24 on Windows, macOS, and Linux, plus Node 22 on Linux. Desktop packaging is a separate manual/tag workflow. Successful CI confirms these automated checks only.

Windows has received live desktop, Tinder, Hinge, and Bumble testing during development. Apple Silicon has received basic desktop testing. Linux, Intel Mac, and non-Windows mobile automation require additional native validation. Hinge's current OCR implementation is Windows-only.

Dating-app screen changes can invalidate selectors and interpretation. Start with a short manual verification after an app update. No test suite guarantees uninterrupted unattended sessions or server-side acceptance of each attempted action.
