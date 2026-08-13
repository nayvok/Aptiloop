# Architecture Decision Records

ADRs record approved architecture direction at the date shown in each file. ADRs 0001–0009 were recorded on 2026-08-08 as **Approved Core Alpha target** decisions. ADR 0010 records the later owner-approved **Implemented baseline** licensing decision that supersedes ADR 0009. A decision status is not runtime evidence.

Several decisions now have later **Implemented baseline** evidence. Consult the [roadmap](../../ROADMAP.md), current specifications, and dated audits for implementation status. Do not retrofit newer runtime claims into an older ADR; record a superseding decision when the architecture changes materially.

| ADR                                                 | Decision                                  | Dated status                               |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| [0001](0001-local-first-core.md)                    | Local-first Core                          | **Approved Core Alpha target**, 2026-08-08 |
| [0002](0002-course-pack-contract.md)                | Declarative Course Pack contract          | **Approved Core Alpha target**, 2026-08-08 |
| [0003](0003-finite-lesson-engine.md)                | Finite Lesson Engine                      | **Approved Core Alpha target**, 2026-08-08 |
| [0004](0004-pi-runtime.md)                          | Pi as a restricted model runtime          | **Approved Core Alpha target**, 2026-08-08 |
| [0005](0005-deterministic-learning-kernel.md)       | Deterministic Learning Kernel             | **Approved Core Alpha target**, 2026-08-08 |
| [0006](0006-source-snapshots-knowledge-capsules.md) | Source Snapshots and Knowledge Capsules   | **Approved Core Alpha target**, 2026-08-08 |
| [0007](0007-execution-fabric-backends.md)           | Execution Fabric and environment backends | **Approved Core Alpha target**, 2026-08-08 |
| [0008](0008-adaptive-studio.md)                     | Adaptive Studio product system            | **Approved Core Alpha target**, 2026-08-08 |
| [0009](0009-licensing-model.md)                     | Superseded AGPL licensing proposal        | **Approved Core Alpha target**, 2026-08-08 |
| [0010](0010-apache-2-project-license.md)            | Apache-2.0 project license                | **Implemented baseline**, 2026-08-13       |

## Status rules

- **Implemented baseline** requires direct repository or runtime evidence recorded outside the original decision.
- **Approved Core Alpha target** means the decision is binding but may still have incomplete implementation or acceptance gates.
- **Proposed pending owner approval** requires a new owner decision before implementation as settled scope.
- **Future** is outside Core Alpha.

ADR 0010 supersedes ADR 0009's AGPL proposal and records the applied Apache-2.0 grant for covered first-party repository materials. User/imported content, third-party obligations, branding, and tagged distribution remain separate review boundaries.
