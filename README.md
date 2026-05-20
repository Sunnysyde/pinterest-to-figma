# Pinterest to Figma

Figma development plugin for importing a public Pinterest board into a tidy canvas section.

Paste a public board URL, click **Add pins to Figma**, and the plugin creates a masonry-style section with each pin imported once. Images and GIFs are imported as image fills. Pinterest videos are imported as still-frame thumbnails with a **VIDEO** badge.

## Requirements

- Figma Desktop
- Node.js 18 or newer
- A public Pinterest board URL

## Run Locally

### One-button start on macOS

Double-click:

```txt
Start Pinterest to Figma.command
```

This starts the local proxy and opens Figma. Keep the terminal window open while importing boards.

Then run **Pinterest to Figma** from **Plugins -> Development** in Figma.

### Manual start

1. Start the local proxy:

   ```sh
   npm start
   ```

2. In Figma Desktop, go to **Plugins -> Development -> Import plugin from manifest...**.
3. Select `manifest.json` from this folder.
4. Run **Pinterest to Figma** from **Plugins -> Development**.
5. Paste a public Pinterest board URL and click **Add pins to Figma**.

The local proxy runs at `http://127.0.0.1:8787`.

## Why The Proxy Exists

Figma plugins cannot reliably fetch Pinterest board pages and media directly because Pinterest blocks many cross-origin browser/plugin requests. The proxy fetches public Pinterest and `pinimg.com` URLs from localhost, then the plugin parses the public board markup and imports the media into Figma.

The proxy only allows Pinterest and Pinimg URLs. It does not require a database, account login, or API key.

## Marketplace Note

This development version expects the proxy to be running separately. If published to the Figma marketplace as-is, users would need to self-host or run the proxy locally before importing boards.

Good options:

- Keep this as a developer/self-hosted tool and document `npm start`.
- Host the proxy yourself and change `LOCAL_PROXY_URL` in `code.js`.
- Ask users to fork/self-host the proxy if you do not want to operate infrastructure.

## Useful Commands

```sh
npm start
node --check code.js
node --check server.js
```

## Files

- `manifest.json`: Figma plugin manifest.
- `code.js`: Figma plugin main thread logic, Pinterest parsing, dedupe, and canvas creation.
- `ui.html`: Plugin UI.
- `server.js`: Local Pinterest/Pinimg fetch proxy.
- `AGENTS.md`: Notes for future coding agents.
