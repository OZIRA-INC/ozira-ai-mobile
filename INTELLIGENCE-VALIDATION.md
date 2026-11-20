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

Private-image follow-up: generated chat images, thumbnails and library/viewer
sources attach session headers only after validating `/img` assets and
canonicalizing approved same-environment aliases onto the configured API origin.
Foreign origins, other environments, data URLs and non-image paths receive no
bearer header. Explicit image save/share downloads authenticated bytes with a
captured account token, redirects disabled, no-store, MIME/size validation and an
account lease before native export. Temporary export files are removed. Stable
image URLs remain in saved conversations. Backend access checks/no-store and
native cache/display behavior require deployed/device acceptance.

Updated validation: 11/11 offline tests passed, including image header snapshots,
foreign/environment credential exclusion, 401 rejection and display wiring; 56
source files parsed and diff checks passed.

Device compatibility: image sources include the same persisted `ozira_device_id`
and platform label used by normal API calls. A shared, deduplicated initializer
prevents simultaneous callers minting different IDs. The navigator waits for
initialization; image sources remain closed without an initialized ID. Binary
image/document downloads reuse that initializer while retaining the account
credential snapshot from before awaiting storage. Server `authSessions.js`
explicitly treats device headers as display metadata; canonical identity/session
claims, not client device IDs, grant access. Device/header compatibility does not
replace server authorization. Regression covers delayed identity initialization,
one storage read, no second ID, and the original account token.

## Release Gate 2 independent source review

Reviewed PR #2 at `98be9257933942ef32292b926a7f33fed7c47ae8` against
`ddac2c3940731ff3ed6b084adc88d708633aa3a0`. Two additional source defects were
corrected after that candidate: same-account conversation changes now remount
the chat content, aborting and invalidating old callbacks before another
conversation owns the UI; new image generation uses the shared `/api/chat`
path with selected project/history and retains composite metadata. Source-image
edits transmit the same selected scope to the existing edit endpoint. The
backend candidate must include its corresponding direct-image scope checks.

The regression suite executes the actual screen send handler with deferred
chat/image/research/vision responses and teardown, verifies no stale update,
and checks the scoped image request and retained composite result. This is
offline handler/contract evidence, not rendered React Native/device acceptance.

Native acceptance is **BLOCKED** in this execution environment: `adb`,
`emulator`, `sdkmanager`, `javac`, `gradle`, `xcodebuild`, `xcrun` and `eas` are
not installed on PATH. OpenJDK 21 runtime is present, but no Android SDK,
device/emulator, generated native project, or approved cloud-build binding was
established. Existing EAS development/preview profiles specify internal APKs;
their presence is not account authorization or a successful build. No new
SDK, device infrastructure, cloud build, signing identity or credential was
created. Installation, launch, native rendering/sharing, background/resume,
session-expiry cache behavior and cross-device live acceptance remain BLOCKED.

Document generation/download is distinct from input document understanding.
The existing mobile attachment path reads text; PDF/Office input parsing and
native document-upload acceptance are not implemented or established here.

Gate 2 dependency stabilization keeps installed Expo54.0.36 and RN0.81.5 unchanged.
Targeted pinned overrides update vulnerable branches; React Navigation core7.24.0
removes the query-string/decoder chain and Metro0.83.8 removes image-size without
an incompatible filename-to-buffer override. Audit now reports0 critical,0 high,
18 moderate and1 low; lower-severity findings are retained.24 tests pass with real
installed dependencies. Android/iOS offline JavaScript exports pass, which does
not establish a native APK/IPA build or device acceptance. XML consumer tests
verify valid API compatibility; arbitrary invalid element names are not validated
by the underlying DOM APIs. No blanket security certification is claimed.

Gate3: the exact emotional statement follows ordinary chat (explicit Research
mode remains separate); source accuracy flags are not accepted as proof.
Delayed text-to-speech provider/audio-mode/file callbacks now use the existing
account lease plus playback cancellation epoch so prior-account audio cannot
start after stop/navigation/account switch.30 offline tests pass, including the
actual TTS module at delayed boundaries. Actual native speakers/permissions and
background/resume remain unverified.

Pinned compatible consumer updates for glob14.0.4, minimatch11.0.5 and uuid11.1.1
remove all remaining moderate findings while Expo54.0.36/RN0.81.5 remain unchanged.
Fresh audit:0 critical/high/moderate,13 low package rows all inherited from one
unfixed deepmerge4.3.1 leaf (GHSA-gcqx-w48m-w2h4). Its returned-object prototype
poisoning was reproduced; it is retained as explicit build-configuration risk,
not suppressed or declared unreachable. Native/config regression review and
release-owner risk disposition remain required. Fresh lockfile installation,
installed consumer contracts and offline Android/iOS JavaScript exports passed;
these are not native installation or device acceptance.
