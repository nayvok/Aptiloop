# Contributing to Aptiloop

## Status

**Implemented baseline**

Aptiloop welcomes focused fixes and improvements that preserve the product,
security, privacy, data, and architecture boundaries in [AGENTS.md](AGENTS.md).

## Before contributing

- Open an issue or discussion before substantial product or architecture work.
- Keep changes focused and include tests appropriate to the affected boundary.
- Do not submit private learner data, credentials, databases, backups, provider
  payloads, proprietary Course material, or generated artifacts containing
  them.
- Record the origin and license of any third-party code, content, asset, font,
  fixture, translation, or generated material included in a contribution.
- Do not add a dependency without reviewing its security, license, runtime,
  and distribution impact.

## Contribution terms

Unless you explicitly state otherwise in writing, an intentional contribution
submitted for inclusion in Aptiloop is provided under Section 5 of the
[Apache License 2.0](LICENSE), without additional terms or conditions.

By submitting a contribution, you represent that you have the right to do so:
the work is yours, or you have identified and complied with every applicable
third-party license and attribution requirement. Copyright remains with each
contributor; no copyright assignment is implied.

User-created and imported Courses, learner data, credentials, databases,
backups, and exports are not contributions merely because Aptiloop processes
or stores them.

## Verification

Run the smallest focused checks that prove the change, followed by the
applicable repository gate:

```sh
npm run verify
npm run test:e2e
```

`npm run verify` does not include E2E. Report the two results separately.
