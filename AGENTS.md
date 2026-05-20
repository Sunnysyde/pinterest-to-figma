# Agent Instructions

This repo is a Figma development plugin named **Pinterest to Figma**.

## Goal

Users should be able to paste a public Pinterest board URL and import the board into Figma as one clean section. Each media asset should appear once, preferring high-quality Pinterest media variants.

## Local Workflow

- Work from this directory: `pinterest-board-canvas-plugin`.
- Start the proxy with `npm start`.
- Load `manifest.json` in Figma Desktop as a development plugin.
- Use `https://au.pinterest.com/jessruyter0573/apartment/` as the main smoke-test board unless a user gives a different URL.

## Important Constraints

- The plugin depends on the local proxy in `server.js`; direct Pinterest fetches from Figma are not reliable because of CORS and request blocking.
- `code.js` should use Figma's `figma.createImageAsync()` against direct Pinterest media URLs first, then proxy URLs as fallback. Main-thread byte fetches may return zero bytes inside Figma even when Node smoke tests pass.
- Pinterest videos should import as still-frame thumbnails, not playable videos. Keep the **VIDEO** badge so users can distinguish them.
- Avoid pulling Pinterest UI assets, avatars, favicons, or duplicate resized variants into the final section.
- Keep the UI compact and Figma-native. Current copy:
  - Title: `Pinterest to Figma`
  - Description: `Imports images, GIFs, and video stills directly into the canvas.`
  - Field label: `Pinterest Board URL`
  - Button: `Add pins to Figma`

## Verification

Run these checks after edits:

```sh
node --check code.js
node --check server.js
```

When changing import behavior, also test in Figma Desktop. Do not rely only on Node fetch tests; Figma's plugin runtime behaves differently for media bytes.
