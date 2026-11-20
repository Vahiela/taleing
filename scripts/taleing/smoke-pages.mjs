import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const build = path.resolve("excalidraw-app/build");
const upstreamBuild = process.env.TALEING_UPSTREAM_BUILD;
const prefix = "/taleing/";
const mime = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const isTaleing = pathname.startsWith(prefix);
  const root = isTaleing ? build : upstreamBuild;
  if (!root) {
    res.writeHead(404).end();
    return;
  }
  const relative = isTaleing
    ? pathname.slice(prefix.length)
    : pathname.slice(1);
  const file = path.resolve(
    root,
    relative.endsWith("/") || !relative ? relative + "index.html" : relative,
  );
  try {
    assert(file.startsWith(path.resolve(root) + path.sep));
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(await readFile(path.join(root, "404.html")));
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const taleing = process.env.TALEING_SMOKE_URL || origin + prefix;
let browser;

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const open = async (url) => {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await context.addInitScript(() => {
      // Exercise the app's browser download/input fallback in headless Chromium.
      delete window.showOpenFilePicker;
      delete window.showSaveFilePicker;
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("canvas.interactive").waitFor();
    return page;
  };

  const page = await open(taleing);
  page.setDefaultTimeout(10_000);
  await page.locator(".taleing-wordmark").waitFor();
  assert.equal(
    await page.getByRole("link", { name: /sign up|Excalidraw CLI/i }).count(),
    0,
  );
  const { request } = page;
  assert.equal(await page.title(), "Taleing Whiteboard");
  const manifestResponse = await request.get(taleing + "manifest.webmanifest");
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.start_url, prefix);
  assert.equal(manifest.file_handlers[0].action, prefix);
  for (const { src } of [...manifest.icons, ...(manifest.screenshots || [])]) {
    assert.equal(
      (await request.get(new URL(src, taleing).href)).status(),
      200,
      src,
    );
  }
  assert.match(
    await (await request.get(taleing + "LICENSE")).text(),
    /Copyright \(c\) 2020 Excalidraw/,
  );
  assert.equal((await request.get(taleing + "version.json")).status(), 200);
  assert.match(
    await (await request.get(taleing + "sitemap.xml")).text(),
    /<loc>https:\/\/vahiela\.github\.io\/taleing\/?<\/loc>/,
  );
  assert.equal(
    (await request.get(taleing + "excalidraw-plus-export/")).status(),
    404,
  );
  const notFound = await request.get(taleing + "missing-document/");
  assert.equal(notFound.status(), 404);
  assert.match(await notFound.text(), /href="\/taleing\/">Open Taleing/);

  const assetUrls = await page
    .locator(
      'head link[rel="preload"][as="font"], head link[rel="icon"], head link[rel="stylesheet"], head script[src]',
    )
    .evaluateAll((nodes) => nodes.map((node) => node.href ?? node.src));
  assert(assetUrls.some((url) => url.endsWith(".woff2")));
  for (const url of assetUrls) {
    assert(url.startsWith(taleing), url);
    assert.equal((await request.get(url)).status(), 200, url);
  }
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.endsWith("/taleing/sw.js"),
  );
  await page.context().setOffline(true);
  await page.reload();
  await page.locator("canvas.interactive").waitFor();
  await page.context().setOffline(false);
  console.log(
    "Pages assets, scoped service worker, offline reload, and 404 passed",
  );

  const fontPage = await open(taleing);
  const fontRequests = new Set();
  fontPage.on("request", (request) => {
    if (request.resourceType() === "font") {
      fontRequests.add(request.url());
    }
  });
  await fontPage.keyboard.press("t");
  await fontPage.getByTestId("font-family-show-fonts").click();
  const fonts = await fontPage.evaluate(async () => {
    const samples = [
      ["Excalifont", "Taleing"],
      ["Nunito", "Taleing"],
      ["Comic Shanns", "Taleing"],
      ["Cascadia", "Taleing"],
      ["Lilita One", "Taleing"],
      ["Virgil", "Taleing"],
      ["Liberation Sans", "Taleing"],
      ["Xiaolai", "地图"],
    ];
    return Promise.all(
      samples.map(async ([family, sample]) => {
        try {
          const faces = await document.fonts.load(`20px "${family}"`, sample);
          return [family, faces.some((face) => face.status === "loaded")];
        } catch {
          return [family, false];
        }
      }),
    );
  });
  for (const [family, loaded] of fonts) {
    assert(loaded, `Could not load the ${family} font`);
  }
  assert(fontRequests.size > 0);
  for (const url of fontRequests) {
    assert(url.startsWith(taleing + "fonts/"), url);
  }
  await fontPage.context().close();
  console.log(
    "Bundled canvas fonts and CJK fallback loaded from Taleing Pages",
  );

  const activeScene = async (tab) =>
    tab.evaluate(() =>
      JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
        (el) => !el.isDeleted,
      ),
    );
  const waitForCount = async (tab, count) =>
    tab.waitForFunction(
      (length) =>
        JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
          (el) => !el.isDeleted,
        ).length === length,
      count,
      { timeout: 10_000 },
    );
  const drag = async (tab, from, to) => {
    await tab.mouse.move(...from);
    await tab.mouse.down();
    await tab.mouse.move(...to, { steps: 8 });
    await tab.mouse.up();
  };
  await page.keyboard.press("r");
  await drag(page, [350, 325], [485, 395]);
  await waitForCount(page, 1);
  const [rectangle] = await activeScene(page);
  assert.equal(rectangle.type, "rectangle");
  await page.keyboard.press("v");
  await page.mouse.click(400, 325);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (x) => JSON.parse(localStorage.getItem("excalidraw") || "[]")[0]?.x > x,
    rectangle.x,
  );
  await page.keyboard.press("o");
  await drag(page, [595, 335], [685, 400]);
  await waitForCount(page, 2);
  await page.keyboard.press("Control+z");
  await waitForCount(page, 1);
  await page.keyboard.press("Control+Shift+z");
  await waitForCount(page, 2);
  await page.keyboard.press("Control+z");
  await waitForCount(page, 1);
  await page.keyboard.press("v");
  await page.mouse.click(405, 325);
  await page.keyboard.press("Control+c");
  await page.mouse.move(660, 375);
  await page.keyboard.press("Control+v");
  await waitForCount(page, 2);
  await page.keyboard.press("Control+z");
  await waitForCount(page, 1);
  console.log(
    "Drawing, selection, keyboard movement, undo/redo, and clipboard passed",
  );

  const cutPage = await open(taleing);
  await cutPage.keyboard.press("l");
  await drag(cutPage, [350, 300], [650, 300]);
  await waitForCount(cutPage, 1);
  const [originalLine] = await activeScene(cutPage);
  await cutPage.locator(".App-toolbar").getByTestId("toolbar-cut").click();
  await cutPage.mouse.click(500, 300);
  await waitForCount(cutPage, 2);
  const halves = await activeScene(cutPage);
  assert(halves.every((el) => el.type === "line" && !el.polygon));
  const seamX = originalLine.x + originalLine.width / 2;
  assert.equal(halves[0].x + halves[0].points.at(-1)[0], seamX);
  assert.equal(halves[1].x, seamX);
  await cutPage.keyboard.press("Control+z");
  await waitForCount(cutPage, 1);
  assert.equal((await activeScene(cutPage))[0].id, originalLine.id);
  await cutPage.keyboard.press("Control+Shift+z");
  await waitForCount(cutPage, 2);
  await cutPage.keyboard.press("r");
  await drag(cutPage, [400, 400], [600, 550]);
  await waitForCount(cutPage, 3);
  await cutPage.keyboard.press("Shift+c");
  // Starting inside the rectangle must leave it alone.
  await drag(cutPage, [500, 450], [500, 590]);
  // A full crossing should cut the rectangle, while leaving both line
  // segments in place.
  await drag(cutPage, [500, 370], [500, 590]);
  await waitForCount(cutPage, 4);
  const polygons = (await activeScene(cutPage)).filter((el) => el.polygon);
  assert.equal(polygons.length, 2);
  for (const polygon of polygons) {
    assert.equal(polygon.type, "line");
    assert.deepEqual(polygon.points[0], polygon.points.at(-1));
  }
  await cutPage.keyboard.press("l");
  await cutPage.mouse.click(740, 425);
  await cutPage.mouse.move(820, 505);
  await cutPage.mouse.click(820, 505);
  await cutPage.mouse.move(900, 425);
  await cutPage.mouse.click(900, 425);
  await cutPage.keyboard.press("Enter");
  await waitForCount(cutPage, 5);
  const curve = (await activeScene(cutPage)).at(-1);
  assert.equal(curve.points.length, 3);
  assert(curve.roundness);
  await cutPage.getByRole("button", { name: "Cut", exact: true }).click();
  await drag(cutPage, [775, 405], [775, 525]);
  await waitForCount(cutPage, 6);
  const curvePieces = (await activeScene(cutPage)).slice(-2);
  for (const piece of curvePieces) {
    assert.deepEqual(piece.roundness, curve.roundness);
  }
  assert(curvePieces.reduce((count, el) => count + el.points.length, 0) <= 7);
  await cutPage.context().close();
  console.log(
    "Cut toolbar, shortcut, rounded lines, shape splitting, and undo/redo passed",
  );

  const phone = await browser.newContext({
    locale: "en-US",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const phonePage = await phone.newPage();
    await phonePage.goto(taleing, { waitUntil: "domcontentloaded" });
    const cut = phonePage
      .locator(".mobile-toolbar")
      .getByRole("button", { name: "Cut", exact: true });
    await cut.tap();
    assert.equal(await cut.getAttribute("aria-pressed"), "true");
  } finally {
    await phone.close();
  }

  const selectMenu = async (tab, testId) => {
    const item = tab.getByTestId(testId);
    if (!(await item.isVisible())) {
      await tab.getByTestId("main-menu-trigger").click();
    }
    await item.click();
  };
  const importFile = async (tab, file) => {
    const chooser = tab.waitForEvent("filechooser");
    await selectMenu(tab, "load-button");
    await (await chooser).setFiles(file);
  };
  const download = async (tab, button) => {
    const [file] = await Promise.all([
      tab.waitForEvent("download"),
      button.click(),
    ]);
    return {
      name: file.suggestedFilename(),
      buffer: await readFile(await file.path()),
    };
  };
  const saveScene = async (tab) => {
    await selectMenu(tab, "json-export-button");
    const file = await download(
      tab,
      tab.getByRole("button", { name: "Save to file", exact: true }),
    );
    assert.match(file.name, /\.excalidraw$/);
    await tab.keyboard.press("Escape");
    return file;
  };
  const fixture = "packages/excalidraw/tests/fixtures/";
  const imageData = (await readFile(fixture + "deer.png")).toString("base64");
  const transfer = await page.evaluateHandle((base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([data], "deer.png", { type: "image/png" }));
    return dataTransfer;
  }, imageData);
  await page.locator("canvas.interactive").dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: 600,
    clientY: 415,
  });
  await transfer.dispose();
  await waitForCount(page, 2);
  const image = (await activeScene(page)).find(
    (element) => element.type === "image",
  );
  assert(image?.fileId);
  await page.mouse.click(765, 510);
  const sceneFile = await saveScene(page);
  const saved = JSON.parse(sceneFile.buffer);
  const savedElements = saved.elements.filter((element) => !element.isDeleted);
  assert.equal(saved.type, "excalidraw");
  assert.equal(saved.version, 2);
  assert.equal(saved.elements[0].id, rectangle.id);
  assert.match(saved.files[image.fileId].dataURL, /^data:image\//);

  await selectMenu(page, "image-export-button");
  const png = await download(
    page,
    page.getByRole("button", { name: /Export to PNG/i }),
  );
  assert.equal(png.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const svg = await download(
    page,
    page.getByRole("button", { name: /Export to SVG/i }),
  );
  assert.match(svg.buffer.toString(), /<svg\b/);
  await page.keyboard.press("Escape");

  await page.reload();
  await page.locator("canvas.interactive").waitFor();
  assert.equal((await activeScene(page))[0].id, rectangle.id);
  const blank = await open(taleing);
  await importFile(blank, { ...sceneFile, mimeType: "application/json" });
  await waitForCount(blank, savedElements.length);
  assert.equal((await activeScene(blank))[0].id, rectangle.id);
  console.log(
    "Image insertion, drawing-file import/export, PNG/SVG, and refresh passed",
  );

  const openLibrary = async (tab) => {
    const sidebar = tab.getByRole("button", { name: "Library", exact: true });
    if ((await sidebar.getAttribute("aria-pressed")) !== "true") {
      await sidebar.click();
    }
  };
  const libraryMenu = (tab) =>
    tab
      .locator(".library-menu-dropdown-container")
      .getByTestId("dropdown-menu-button");
  const importLibrary = async (tab, file) => {
    await openLibrary(tab);
    await libraryMenu(tab).click();
    const chooser = tab.waitForEvent("filechooser");
    await tab.getByTestId("lib-dropdown--load").click();
    await (await chooser).setFiles(file);
  };
  const exportLibrary = async (tab) => {
    await libraryMenu(tab).click();
    const file = await download(tab, tab.getByTestId("lib-dropdown--export"));
    assert.match(file.name, /\.excalidrawlib$/);
    const data = JSON.parse(file.buffer);
    assert.equal(data.type, "excalidrawlib");
    assert.equal(data.version, 2);
    assert(
      data.libraryItems.some((item) =>
        item.elements.some((el) => el.id === "A"),
      ),
    );
    return file;
  };
  await importLibrary(blank, fixture + "fixture_library.excalidrawlib");
  const libraryFile = await exportLibrary(blank);
  await blank.reload();
  await blank.locator("canvas.interactive").waitFor();
  await openLibrary(blank);
  await exportLibrary(blank);
  console.log(
    "Legacy library import, current library export, and library persistence passed",
  );

  if (!process.env.VITE_APP_WS_SERVER_URL) {
    await page.getByTestId("main-menu-trigger").click();
    assert.equal(
      await page.getByText("Live collaboration...", { exact: true }).count(),
      0,
    );
    await page.keyboard.press("Escape");
  }
  if (!process.env.VITE_APP_BACKEND_V2_POST_URL) {
    await selectMenu(page, "json-export-button");
    assert.equal(
      await page.getByRole("button", { name: "Export to Link" }).count(),
      0,
    );
    await page.keyboard.press("Escape");
  }

  if (upstreamBuild) {
    const upstream = await open(origin + "/");
    await importFile(upstream, { ...sceneFile, mimeType: "application/json" });
    await waitForCount(upstream, savedElements.length);
    const upstreamFile = await saveScene(upstream);
    const reimport = await open(taleing);
    await importFile(reimport, {
      ...upstreamFile,
      mimeType: "application/json",
    });
    await waitForCount(reimport, savedElements.length);
    for (const tab of [upstream, reimport]) {
      assert.deepEqual(
        (await activeScene(tab)).map(({ id, type, x, y, width, height }) => ({
          id,
          type,
          x,
          y,
          width,
          height,
        })),
        savedElements.map(({ id, type, x, y, width, height }) => ({
          id,
          type,
          x,
          y,
          width,
          height,
        })),
      );
    }
    assert.equal(
      JSON.parse(upstreamFile.buffer).files[image.fileId].dataURL,
      saved.files[image.fileId].dataURL,
    );
    await importLibrary(upstream, {
      ...libraryFile,
      mimeType: "application/json",
    });
    const upstreamLibrary = await exportLibrary(upstream);
    await importLibrary(reimport, {
      ...upstreamLibrary,
      mimeType: "application/json",
    });
    const reimportedLibrary = await exportLibrary(reimport);
    assert.deepEqual(
      JSON.parse(reimportedLibrary.buffer).libraryItems,
      JSON.parse(libraryFile.buffer).libraryItems,
    );
    console.log(
      "Two-way drawing and library round trips with the pinned upstream app passed",
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
