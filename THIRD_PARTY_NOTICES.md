# Third-Party Notices

**Generated scope:** 2026-08-22, from the committed `package-lock.json` for
Aptiloop 0.1.0 and inspection of the current production web standalone output
and Debian-based container definitions.

This file is an attribution summary, not a replacement for the license files
distributed with third-party components. Aptiloop does not relicense those
components. The authoritative component-by-component inventory is the
CycloneDX SBOM generated from the exact installed tree:

```sh
npm ci
npm run sbom
```

The default output is `.verify/supply-chain/sbom.cdx.json`. Release automation
must retain that SBOM and the upstream license and notice files from the exact
artifacts it distributes. Re-run the command after every lockfile or artifact
change; this static summary is not a substitute for an artifact-specific scan.

## Source dependency inventory

The source distribution installs third-party npm packages under the license
families reported by the current lockfile: MIT, ISC, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, MIT-0, MPL-2.0, CC-BY-4.0,
SIL Open Font License 1.1, LGPL-3.0-or-later, and compound Sharp platform
package expressions that also include Apache-2.0 and, for WebAssembly, MIT.
Consult the generated SBOM and each installed package's license file for exact
versions and terms.

The following components need explicit attention because they are embedded in
web output, carry attribution-sensitive data or fonts, or use reciprocal
licenses.

## Geist fonts

- **Component:** `geist` 1.7.2, including Geist Sans and Geist Mono font files
  embedded in the production web static output.
- **Copyright:** Copyright (c) 2023 Vercel, in collaboration with
  basement.studio.
- **License:** SIL Open Font License, Version 1.1.
- **Upstream:** <https://github.com/vercel/geist-font>
- **License text:** `node_modules/geist/LICENSE.txt` in an exact npm install,
  or <https://scripts.sil.org/OFL>.

The font software remains under the OFL. A distributed copy of the font must
include its copyright notice and the complete OFL 1.1 text. Aptiloop uses the
unmodified font package and does not claim ownership of the font files.

## shadcn/ui-derived component source

- **Component:** selected UI component source generated from or adapted from
  `shadcn/ui` patterns.
- **Copyright:** Copyright (c) 2023 shadcn.
- **License:** MIT License.
- **Upstream:** <https://github.com/shadcn-ui/ui>
- **License text:** <https://github.com/shadcn-ui/ui/blob/main/LICENSE.md>.

Aptiloop's component source has project-specific changes and composition. The
upstream MIT copyright and permission notice remain applicable to material
derived from shadcn/ui.

## caniuse-lite browser support data

- **Component:** `caniuse-lite` 1.0.30001806.
- **Author/attribution:** Ben Briggs and the caniuse-lite contributors.
- **License:** Creative Commons Attribution 4.0 International (CC-BY-4.0).
- **Upstream:** <https://github.com/browserslist/caniuse-lite>
- **License text:** `node_modules/caniuse-lite/LICENSE` in an exact npm
  install, or <https://creativecommons.org/licenses/by/4.0/legalcode>.

The package is present in the inspected production web standalone output. No
Aptiloop modification to its browser compatibility data is declared. Preserve
this attribution, the license link, and an indication of changes if a future
release modifies that data.

## Sharp and libvips

- **Component:** `sharp` 0.35.3 — Apache License 2.0.
- **Native binding for the verified Linux x64/glibc container target:**
  `@img/sharp-linux-x64` 0.35.3 — Apache License 2.0.
- **libvips bundle for that target:** `@img/sharp-libvips-linux-x64` 1.3.2 —
  GNU Lesser General Public License v3.0 or later (LGPL-3.0-or-later).
- **Upstreams:** <https://github.com/lovell/sharp> and
  <https://github.com/libvips/libvips>.
- **License texts:** <https://www.apache.org/licenses/LICENSE-2.0> and
  <https://www.gnu.org/licenses/lgpl-3.0.html>.

The lockfile also records optional Sharp/libvips packages for other operating
systems and architectures. Their exact versions and compound license
expressions are in the generated SBOM. Include only the platform packages that
are actually present in a distributed artifact, together with their complete
license files. The LGPL applies to the bundled libvips library, not to Aptiloop
as a blanket relicensing statement. Do not remove replacement/relinking or
corresponding-source information supplied by the upstream package.

## Lightning CSS

- **Components in the source/build toolchain:** `lightningcss` 1.33.0 and the
  nested `lightningcss` 1.32.0 used by `@tailwindcss/node`, plus their selected
  platform bindings.
- **License:** Mozilla Public License 2.0 (MPL-2.0).
- **Upstream:** <https://github.com/parcel-bundler/lightningcss>
- **License text:** `node_modules/lightningcss/LICENSE` in an exact npm install,
  or <https://www.mozilla.org/MPL/2.0/>.

These packages are development/build dependencies in the current lockfile and
were not found as runtime packages in the inspected production web standalone
output. If a distribution includes their source or binary files, retain the
MPL notice and make any modifications to MPL-covered files available as
required by MPL-2.0.

## Container operating-system components

The production container definitions derive from
`node:24.15.0-bookworm-slim` at the digest pinned in each Dockerfile. The
orchestrator image additionally installs Debian packages `git` and `python3`,
including their transitive operating-system libraries. Those packages retain
their own Debian/upstream copyright and license terms and are outside the npm
SBOM described above.

For every published container digest, retain the image's
`/usr/share/doc/*/copyright` files and generate an image-specific operating-
system package inventory and SBOM. This document does not claim that one
static Debian package list can describe a future rebuild from the same base
tag or Dockerfile.

## Other third-party packages

The repository and built artifacts contain additional permissively licensed
npm packages. Their exact names, versions, package URLs, integrity hashes, and
declared license identifiers are recorded in `package-lock.json` and the
generated CycloneDX SBOM. Copyright statements and license texts remain in the
packages installed by `npm ci`; preserve them when redistributing source or
artifacts.

Third-party names and trademarks identify their respective projects and do not
imply endorsement of Aptiloop.
