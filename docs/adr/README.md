# Architecture Decision Records

ADRs record approved architecture direction at the date shown in each file. Every current ADR in this directory was recorded on 2026-08-08 with status **Approved Core Alpha target**. That status is a decision status, not proof that the decision was implemented at the time.

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
| [0009](0009-licensing-model.md)                     | Licensing model engineering direction     | **Approved Core Alpha target**, 2026-08-08 |

## Status rules

- **Implemented baseline** requires direct repository or runtime evidence recorded outside the original decision.
- **Approved Core Alpha target** means the decision is binding but may still have incomplete implementation or acceptance gates.
- **Proposed pending owner approval** requires a new owner decision before implementation as settled scope.
- **Future** is outside Core Alpha.

ADR 0009 is an engineering direction only. The repository still has no project license grant, and professional legal review remains required before any license or distribution decision is applied.
