# Mobile intelligence parity validation

Base: `ddac2c3940731ff3ed6b084adc88d708633aa3a0` in `OZIRA-INC/ozira-ai-mobile`.

Run `npm test` using Node 20 or newer. Tests import the actual normalization,
numbering, request and localStore implementations. Filesystem, transport and
server are explicit in-memory fakes; no provider, database or production calls.

Implemented ordinary chat composite text/image/website display, validated artifact
metadata preservation, projectId continuation from existing project-scoped chats,
and ordered-list numbering. Website preview uses a validated hosted link through
the OS browser and supports sharing that link; inline HTML is never executed.
Opaque bounded HTML remains in metadata for server save/reopen and web export.
Private websites offer explicit native HTML-file export through the OS share
chooser. Office/PDF document metadata is retained; explicit document export uses
a bearer-authenticated binary request with redirects disabled, MIME/size checks
and account lease checks before native sharing. Export cache files are removed
after the chooser closes. SDK54 expo-sharing is added in the lockfile; it was
not installed or tested on a device. Full Project Brain creation/selection UX
and device visual acceptance remain outside this patch. Folder IDs remain folders, never inferred project IDs.

Offline caches now use an authenticated account-specific file. Logout clears the
in-memory scope; switching accounts rejects stale cache responses. Legacy unowned
`ozira-store.json` is deliberately not migrated to a newly signed-in account;
server history remains available. Existing account-scoped files are retained for
their owner's offline use. This is app account isolation, not device-at-rest
encryption. Theme/settings/profile cache follows account scope as well.

The tests cover composite response and request round trips, online/fake-server and
offline persistence, list refresh retaining messages, malformed/foreign/artifact
URLs, staging versus production separation, repeated numbering and fenced code,
logout/account switch isolation, legacy history exclusion, stale-account response
rejection, asynchronous request credential snapshot, direct account-switch deferred callback
guards, document authentication failures, and native file-export cleanup. Backend validation must
also preserve `metadata.webBuild`; a successful mobile fake-server test does not
prove actual backend or deployed behavior.

No Android/iOS build, simulator/device rendering, accessibility audit, live
provider connectivity, deployed persistence, or multi-device acceptance was run.

Security follow-up: the verified session owner keys the app navigator, remounting
all authenticated screens on direct account switches. Chat updates/autosave use
a synchronous owner-epoch lease and abort on teardown. Initial session restore
cannot replace a newer auth event. Regression tests exercise the actual lease
and verify screen guard wiring; a rendered React/device transition remains
unverified.

Final checks: 10/10 offline Node tests passed; all 56 mobile source JavaScript
files parsed with Babel's JSX parser. `git diff --check` passed. Lockfile-only npm
audit initially found 37 baseline findings. The pinned shell-quote 1.11.0 override
removes the critical GHSA-pqg4-j6r4-53mv finding from the React Native →
react-devtools-core tooling chain. Candidate: 36 findings (0 critical, 16 high,
19 moderate, 1 low). Expo54 and RN0.81.5 stay unchanged. Compatible audit-fix
dry-run proposed zero mutations; the postcss fix requests an Expo53 major
downgrade and was rejected. Residual high reachability is not established and
remains release debt. No force upgrade was used.
