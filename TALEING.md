# Taleing baseline

Taleing is the Excalidraw standalone web app maintained by Tales Studio. The upstream baseline is the Excalidraw master commit [2c3dcc06ec807e81ab9437eceb1a8f7a3c590743](https://github.com/excalidraw/excalidraw/commit/2c3dcc06ec807e81ab9437eceb1a8f7a3c590743), with source tree `879e10749e4dbfb941b24e862f9ba000564ae803`. The application and editor packages, React/Vite build, Yarn workspace lockfile, scene and library serializers, and upstream test suite come from that revision.

The [upstream MIT license](LICENSE) and [laser-pointer license](packages/laser-pointer/LICENSE) are retained in source and copied to the Pages artifact. Taleing changes cover deployment, browser and install metadata, self-hosted assets, and configuration for external services. The upstream CI workflows are stored in [.github/upstream-workflows](.github/upstream-workflows) so upstream releases, publishing, and reporting jobs are outside Taleing's active CI.

## Build and test

Use Node 24.22.3 and Yarn 1.22.22 via Corepack. Run these commands from the repository root.

```sh
corepack yarn install --frozen-lockfile
corepack yarn test:typecheck
corepack yarn test:app run
bash scripts/taleing/build-pages.sh
corepack yarn playwright install chromium
node scripts/taleing/smoke-pages.mjs
```

The pinned clean checkout and the Taleing tree passed typechecking, the production build, and 2,715 upstream tests across 154 files. The suite also reported 47 skipped tests and one todo.

The production site is generated at `excalidraw-app/build` and served under `/taleing/`. The GitHub Pages source is **GitHub Actions**. Pushes to `main` run the tests, build, deployment, and public HTTP checks. Pull requests run the build and tests. The workflow also supports manual runs. The first successful deployment and public response check publish the `v0.1.0` baseline release. [GitHub Pages settings](https://github.com/Vahiela/taleing/settings/pages)

To compare the drawing format against the pinned upstream app, build a clean checkout of that commit with `corepack yarn build:app:docker`, then set `TALEING_UPSTREAM_BUILD` to the absolute path of its `excalidraw-app/build` before running the smoke test. It imports a Taleing drawing and library in the upstream app, exports them there, and imports them back into Taleing. Set `TALEING_SMOKE_URL` to exercise a deployed Taleing URL.

## Browser verification

Cloud Chromium verified drawing, selection, keyboard movement, undo and redo, keyboard clipboard shortcuts, image insertion, PNG and SVG downloads, refresh persistence, and offline reload. It also verified a version 1 library import and version 2 export, and both directions of drawing and library file exchange with the clean pinned Excalidraw build. The drawing round trip preserved element IDs, geometry, and the embedded image. The library round trip preserved its items. Project-path checks covered scripts, CSS, fonts, icons, manifest assets, the service worker, the export route, and the 404 page.

Default-build tests confirmed that starting collaboration or exporting a share link without endpoints explains the missing service before creating a room or uploading a drawing. With a loopback test service, encrypted read-only links successfully transferred a drawing between two Chromium sessions. That test covered the scene protocol. Production image storage and service operation still require verification. Live service and cross-browser verification are tracked separately below.

## Hosted feature status

The editor provides local scenes, libraries, and exports entirely in the browser. GitHub Pages hosts the static files. The following services are separate from that deployment.

| Feature | Upstream dependency | Taleing baseline |
| --- | --- | --- |
| Live collaboration and presence | Socket.IO room relay. Upstream's [excalidraw-room](https://github.com/excalidraw/excalidraw-room) is an open-source starting point. Encrypted room persistence uses Firestore, and images use Firebase Storage. | The original controls and protocol remain. Configure `VITE_APP_WS_SERVER_URL` and `VITE_APP_FIREBASE_CONFIG` to enable a separately hosted relay and persistence. Verify two independent browser sessions, late join and reconnect, images, and room reopening. |
| Read-only share links | `POST` sends compressed ciphertext and receives a JSON `id`. `GET` returns ciphertext for that ID. Firebase Storage holds encrypted linked images. The decryption key stays in the URL fragment. | Requires `VITE_APP_BACKEND_V2_POST_URL`, `VITE_APP_BACKEND_V2_GET_URL`, and a configured Firebase bucket. Default builds show an unavailable message. Existing hosted links reference the service that originally stored their content. |
| Public library catalog and submissions | The [Excalidraw libraries catalog](https://libraries.excalidraw.com) serves browseable libraries. Publishing uploads a library, preview, and author metadata to its submission endpoint. | Browse keeps the upstream catalog link with Taleing's return URL. Local library files work independently of the catalog. Publishing requires a configured `VITE_APP_LIBRARY_BACKEND`. Catalog return and submission need separate verification. |
| Text to Diagram and Diagram to Code | Two streaming HTTP endpoints under the upstream AI service. | The original entry points remain. They require a service implementing the upstream request and streaming response formats at `VITE_APP_AI_BACKEND`. The baseline reports that the service needs configuration. |
| Excalidraw+ links, sign-in, and cloud export | The hosted Excalidraw+ application, signed iframe export requests, and the upstream Firebase migration bucket. | Links still go to the original service. The Plus export route is served under `/taleing/`. An authenticated end-to-end Plus round trip remains unverified. Plus subscriptions and hosted workspaces belong to Excalidraw. |
| Remote scene and library URLs, embeds, and external content | File host CORS, content host policies, and availability of the linked site. | The existing URL-based import and embed code is retained. Availability depends on the content host. |
| Telemetry and CDN assets | Upstream analytics, Sentry, and font CDN. | The Pages build omits upstream telemetry and serves the bundled fonts from Taleing. |

The configuration variables above are public client configuration read at build time. Place them in GitHub Actions repository variables and rebuild after changes. Keep service credentials in backend infrastructure. Firebase's web config identifies the project and bucket. It is safe to publish only with service access controls appropriate for a public client.

The upstream room server examined at [03ff435860b508d7cd9e005cfc90f7977ae2a593](https://github.com/excalidraw/excalidraw-room/commit/03ff435860b508d7cd9e005cfc90f7977ae2a593) implements the room, broadcast, and presence events used by the client. Pin the relay before deploying it. A working deployment needs TLS and WebSocket support, an allowed Taleing origin, and a supported Socket.IO handshake. Put limits and retention on the relay, share-link service, and object storage. Review the example upstream Firebase rules before configuring any public project. Those rules allow broad writes. [Firebase Storage setup](https://firebase.google.com/docs/storage/web/start)

A public repository on GitHub Free supports the static site. Firebase Cloud Storage requires Blaze billing, even when usage qualifies for no-cost allowances. Relay hosting, share-link persistence, image bandwidth, and AI inference have separate costs based on provider and usage. This baseline does not provision paid infrastructure. [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [Firebase pricing](https://firebase.google.com/pricing)

## Upstream upgrades

Add or fetch the upstream remote from `https://github.com/excalidraw/excalidraw.git`. Compare `git diff 2c3dcc06ec807e81ab9437eceb1a8f7a3c590743 HEAD` to see the Taleing changes. On a review branch, bring in a specific new upstream commit, review upstream workflow changes outside the active workflow directory, rerun the typecheck and test suite, and repeat the browser tests and file round trips. Update the pin and the release verification record only after the upgrade has been checked.
