figma.showUI(__html__, { width: 360, height: 224, themeColors: true });

const SECTION_PADDING = 56;
const GAP = 24;
const CARD_WIDTH = 220;
const CARD_RADIUS = 14;
const MAX_IMAGE_BYTES = 4096 * 4096 * 4;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const LOCAL_PROXY_URL = "http://127.0.0.1:8787/fetch?url=";

figma.ui.onmessage = async (message) => {
  if (message.type === "import-board") {
    try {
      await importBoard(message.url);
      figma.ui.postMessage({ type: "done" });
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        message: serializeError(error)
      });
    }
  }

  if (message.type === "create-board") {
    try {
      await createBoardSection(message.payload);
      figma.ui.postMessage({ type: "done" });
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        message: serializeError(error)
      });
    }
  }

  if (message.type === "close") {
    figma.closePlugin();
  }
};

async function importBoard(sourceUrl) {
  const url = normalizePinterestUrl(sourceUrl);
  if (!url) {
    throw new Error("Paste a public Pinterest board URL.");
  }

  figma.ui.postMessage({ type: "status", message: "Fetching Pinterest board..." });
  const board = await fetchPinterestBoard(url);

  if (board.media.length === 0) {
    throw new Error("I could not find media on that public board. Check that the board is public and the URL points to a board, not a single pin.");
  }

  figma.ui.postMessage({ type: "status", message: `Found ${board.media.length} pin${board.media.length === 1 ? "" : "s"}. Downloading media...` });
  const hydrated = await hydrateMedia(board.media);
  await createBoardSection({
    title: board.title,
    sourceUrl: url,
    media: hydrated
  });
}

async function createBoardSection(payload) {
  const media = Array.isArray(payload.media) ? payload.media : [];

  if (media.length === 0) {
    throw new Error("No media was found for that board.");
  }

  const sectionName = payload.title || "Pinterest board";
  const sectionOrigin = nextSectionOrigin(sectionName);
  const section = figma.createSection();
  section.name = sectionName;
  section.x = sectionOrigin.x;
  section.y = sectionOrigin.y;

  const columns = media.length <= 3 ? media.length : Math.min(5, Math.ceil(Math.sqrt(media.length * 1.4)));
  const cardHeights = [];

  for (const item of media) {
    const ratio = clamp(item.width && item.height ? item.height / item.width : 1.25, 0.65, 1.75);
    cardHeights.push(Math.round(CARD_WIDTH * ratio));
  }

  const columnHeights = Array.from({ length: columns }, () => 0);
  const startY = SECTION_PADDING;
  const nodes = [];

  for (let index = 0; index < media.length; index += 1) {
    const item = media[index];
    const column = shortestColumn(columnHeights);
    const x = SECTION_PADDING + column * (CARD_WIDTH + GAP);
    const y = startY + columnHeights[column];
    const node = await createMediaCard(item, index + 1, CARD_WIDTH, cardHeights[index]);
    node.x = x;
    node.y = y;
    section.appendChild(node);
    nodes.push(node);
    columnHeights[column] += cardHeights[index] + GAP;
  }

  const width = SECTION_PADDING * 2 + columns * CARD_WIDTH + (columns - 1) * GAP;
  const height = startY + Math.max(...columnHeights) - GAP + SECTION_PADDING;
  section.resizeWithoutConstraints(width, height);

  figma.viewport.scrollAndZoomIntoView([section, ...nodes]);
}

function nextSectionOrigin(title) {
  const matchingSections = figma.currentPage.children.filter((node) => (
    node.type === "SECTION" &&
    node.name === title &&
    typeof node.x === "number" &&
    typeof node.y === "number" &&
    typeof node.width === "number"
  ));

  if (matchingSections.length === 0) {
    return {
      x: figma.viewport.center.x - 700,
      y: figma.viewport.center.y - 450
    };
  }

  const rightEdge = Math.max(...matchingSections.map((node) => node.x + node.width));
  const topEdge = Math.min(...matchingSections.map((node) => node.y));
  return {
    x: rightEdge + 240,
    y: topEdge
  };
}

async function fetchPinterestBoard(url) {
  const htmlCandidates = [url];
  const rssUrl = pinterestRssUrl(url);
  if (rssUrl) {
    htmlCandidates.push(rssUrl);
  }

  const errors = [];
  for (const candidate of htmlCandidates) {
    try {
      const text = await fetchText(candidate);
      const media = parsePinterestMedia(text).slice(0, 150);
      if (media.length > 0) {
        return {
          title: parsePinterestTitle(text) || "Pinterest board",
          media
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.length > 0 ? errors[errors.length - 1] : "Pinterest did not return usable board media.");
}

async function fetchText(url) {
  const response = await fetch(proxyUrl(url));

  if (!response.ok) {
    throw new Error(`Pinterest returned ${response.status} for ${url}`);
  }

  return await response.text();
}

function proxyUrl(url) {
  if (/^https?:\/\/([^/]+\.)?(pinterest|pinimg)\./i.test(url)) {
    return LOCAL_PROXY_URL + encodeURIComponent(url);
  }
  return url;
}

async function hydrateMedia(media) {
  const hydrated = new Array(media.length);
  const batchSize = 8;

  for (let index = 0; index < media.length; index += batchSize) {
    figma.ui.postMessage({
      type: "status",
      message: `Downloading ${index + 1}-${Math.min(index + batchSize, media.length)}/${media.length}...`
    });

    const batch = media.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(async (item, offset) => {
      const imageUrl = mediaImageSource(item);
      const bytes = await fetchMediaBytes(imageUrl, MAX_IMAGE_BYTES);

      return {
        index: index + offset,
        item: {
          kind: item.kind,
          url: item.url,
          poster: item.poster,
          width: item.width,
          height: item.height,
          bytes,
          videoBytes: []
        }
      };
    }));

    for (const result of results) {
      hydrated[result.index] = result.item;
    }
  }
  return hydrated;
}

async function fetchMediaBytes(url, maxBytes) {
  if (!url) return [];

  for (const candidate of mediaDownloadCandidates(url)) {
    try {
      const response = await fetch(proxyUrl(candidate));
      if (!response.ok || response.status === 204) continue;

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) continue;

      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length > 0 && data.length <= maxBytes) {
        return Array.from(data);
      }
    } catch (error) {
      // Try the next Pinterest size variant before giving up.
    }
  }

  return [];
}

function parsePinterestMedia(text) {
  const media = [];
  extractStructuredMedia(text, media);
  extractMediaUrls(text, media);
  return dedupeMedia(media);
}

function extractStructuredMedia(text, media) {
  const scriptPattern = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = scriptPattern.exec(text);
  while (match) {
    const jsonText = htmlDecode(match[1]).trim();
    if (jsonText.indexOf("pinimg") !== -1 || jsonText.indexOf("pinterest") !== -1) {
      try {
        walkJson(JSON.parse(jsonText), media);
      } catch (error) {
        extractMediaUrls(jsonText, media);
      }
    }
    match = scriptPattern.exec(text);
  }
}

function walkJson(value, media) {
  if (!value || media.length > 600) return;

  if (typeof value === "string") {
    pushMedia(value, media);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(item, media);
    }
    return;
  }

  if (typeof value === "object") {
    const maybeUrl = value.url || value.src || nestedValue(value, ["originals", "url"]) || nestedValue(value, ["images", "orig", "url"]);
    if (typeof maybeUrl === "string") {
      const width = numberOrNull(value.width);
      const height = numberOrNull(value.height);
      pushMedia(maybeUrl, media, width, height, value.poster);
    }

    const keys = Object.keys(value);
    for (const key of keys) {
      walkJson(value[key], media);
    }
  }
}

function extractMediaUrls(text, media) {
  const normalized = htmlDecode(text);
  const urlPattern = /https?:\\?\/\\?\/[^"'<>\\\s)]+/gi;
  let match = urlPattern.exec(normalized);
  while (match) {
    pushMedia(match[0], media);
    match = urlPattern.exec(normalized);
  }
}

function pushMedia(rawUrl, media, width, height, poster) {
  const url = absolutize(cleanEscapedUrl(rawUrl));
  if (!url || !isPinterestMedia(url)) return;
  const cleanPoster = poster ? absolutize(cleanEscapedUrl(poster)) : "";
  const generatedPoster = looksLikeVideo(url) ? videoPosterCandidates(url)[0] || "" : "";

  media.push({
    kind: looksLikeVideo(url) ? "video" : looksLikeGif(url) ? "gif" : "image",
    url,
    poster: cleanPoster && isPinterestMedia(cleanPoster) ? cleanPoster : (looksLikeVideo(url) ? generatedPoster : url),
    width: width || null,
    height: height || null
  });
}

function dedupeMedia(media) {
  const byAsset = new Map();

  for (const item of media) {
    const url = item.url;
    if (!url) continue;

    const cleanItem = {
      kind: item.kind,
      url,
      poster: item.poster || "",
      width: item.width,
      height: item.height
    };
    const key = canonicalAssetKey(cleanItem);
    const existing = byAsset.get(key);

    if (!existing || mediaQualityScore(cleanItem) > mediaQualityScore(existing)) {
      byAsset.set(key, cleanItem);
    }
  }

  return Array.from(byAsset.values());
}

function parsePinterestTitle(text) {
  const ogTitle = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(htmlDecode((ogTitle && ogTitle[1]) || (title && title[1]) || ""));
}

function pinterestRssUrl(value) {
  const url = normalizePinterestUrl(value);
  if (!url) return "";
  const path = url.replace(/^https?:\/\/[^/]+/i, "").split("?")[0].replace(/\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return `https://www.pinterest.com/${parts[0]}/${parts[1]}.rss`;
}

function normalizePinterestUrl(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^https?:\/\/([^/]+\.)?pinterest\.[^/]+\/.+/i.test(trimmed)) return "";
  return trimmed.split("#")[0];
}

function absolutize(value) {
  if (!value || typeof value !== "string") return "";
  const cleaned = value.trim().replace(/&amp;/g, "&");
  if (cleaned.indexOf("//") === 0) return `https:${cleaned}`;
  if (!/^https?:\/\//i.test(cleaned)) return "";
  return cleaned.split("#")[0];
}

function cleanEscapedUrl(value) {
  return String(value)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/&quot;/g, "")
    .replace(/&#x2F;/g, "/");
}

function canonicalAssetKey(item) {
  const source = item.kind === "video" && item.poster ? item.poster : item.url;
  const url = cleanUrlForComparison(source);
  const pinimgMatch = url.match(/pinimg\.com\/.*?([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]+)(?:[._][^/?#]+)?\.(avif|gif|jpe?g|png|webp|mp4|m3u8)/i);

  if (pinimgMatch) {
    return pinimgMatch[1].toLowerCase();
  }

  return url;
}

function mediaQualityScore(item) {
  const url = cleanUrlForComparison(item.kind === "video" && item.poster ? item.poster : item.url);
  const sizeScore = pinterestSizeScore(url);
  const pixelScore = item.width && item.height ? Math.min(item.width * item.height, MAX_IMAGE_BYTES) / 1000 : 0;
  const typeScore = item.kind === "video" ? 30 : item.kind === "gif" ? 20 : 10;
  const formatScore = figmaSupportedImageUrl(url) || isFigmaVideoUrl(url) ? 10000 : 0;

  return formatScore + sizeScore + pixelScore + typeScore;
}

function pinterestSizeScore(value) {
  const match = value.match(/pinimg\.com\/(?:[^/]+\/)?([^/]+)\//i);
  if (!match) return 0;
  if (match[1] === "originals") return 1;

  const size = Number((match[1].match(/^(\d+)x$/) || [])[1]);
  return Number.isFinite(size) ? size : 0;
}

function cleanUrlForComparison(value) {
  return String(value || "").split("?")[0].split("#")[0];
}

function mediaDownloadCandidates(value) {
  const url = cleanUrlForComparison(value);
  if (looksLikeVideo(url)) {
    return videoPosterCandidates(url);
  }

  const match = url.match(/^(https?:\/\/i\.pinimg\.com\/)(?:originals|[0-9]+x|[a-z0-9_]+)\/(.+)$/i);
  if (!match) return [value];

  const currentSize = (url.match(/i\.pinimg\.com\/([^/]+)\//i) || [])[1];
  const variants = ["736x", "564x", "474x", "236x", "originals"];
  const candidates = currentSize === "originals" ? [] : [url];

  for (const path of pinimgExtensionCandidates(match[2])) {
    for (const size of variants) {
      candidates.push(`${match[1]}${size}/${path}`);
    }
  }

  return Array.from(new Set(candidates));
}

function mediaImageSource(item) {
  if (!item) return "";
  if (item.kind === "video") {
    return item.poster || videoPosterCandidates(item.url)[0] || "";
  }
  return item.url || "";
}

function videoPosterCandidates(value) {
  const url = cleanUrlForComparison(value);
  const match = url.match(/pinimg\.com\/videos\/[^/]+\/[^/]+\/([a-f0-9]{2})\/([a-f0-9]{2})\/([a-f0-9]{2})\/([a-f0-9]+)(?:_[^/.]+)?\.(mp4|mov|webm)$/i);
  if (!match) return [];

  const path = `${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
  return [
    `https://i.pinimg.com/videos/thumbnails/originals/${path}.0000000.jpg`,
    `https://i.pinimg.com/videos/thumbnails/originals/${path}.0000001.jpg`
  ];
}

function pinimgExtensionCandidates(path) {
  if (/\.(gif|jpe?g|png|mp4|mov|webm)$/i.test(path)) return [path];

  const withoutExtension = path.replace(/\.[^.]+$/i, "");
  return [
    `${withoutExtension}.jpg`,
    `${withoutExtension}.png`,
    `${withoutExtension}.gif`,
    path
  ];
}

function isPinterestMedia(value) {
  const url = cleanUrlForComparison(value);
  if (!/\.(avif|gif|jpe?g|png|webp|mp4|m3u8)$/i.test(url)) return false;
  if (/\/(favicons|webapp|images\/api|images\/default_|avatar|logo)/i.test(url)) return false;
  if (/\/(?:\d+x\d+_RS|rs)\//i.test(url)) return false;
  if (/\/\/s\.pinimg\.com\//i.test(url)) return false;

  if (/\/\/v\d+\.pinimg\.com\/videos\//i.test(url)) {
    return looksLikeVideo(url);
  }

  if (/\/\/i\.pinimg\.com\/videos\/thumbnails\//i.test(url)) {
    return figmaSupportedImageUrl(url);
  }

  if (!/\/\/i\.pinimg\.com\//i.test(url)) return false;
  return pinterestSizeScore(url) >= 200 || /\/originals\//i.test(url);
}

function looksLikeVideo(value) {
  return /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(value);
}

function isFigmaVideoUrl(value) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(value);
}

function figmaSupportedImageUrl(value) {
  return /\.(gif|jpe?g|png)(\?|$)/i.test(value);
}

function looksLikeGif(value) {
  return /\.gif(\?|$)/i.test(value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nestedValue(value, keys) {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\| Pinterest.*$/i, "").trim();
}

function serializeError(error) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error.message === "string") return error.message;
  try {
    const keys = Object.keys(error);
    if (keys.length > 0) {
      const copy = {};
      for (const key of keys) {
        copy[key] = error[key];
      }
      return JSON.stringify(copy);
    }
    return JSON.stringify(error);
  } catch (jsonError) {
    return String(error);
  }
}

async function createMediaCard(item, index, width, height) {
  const frame = figma.createFrame();
  frame.name = `${index}. ${item.kind || "media"}`;
  frame.resizeWithoutConstraints(width, height);
  frame.cornerRadius = CARD_RADIUS;
  frame.clipsContent = true;
  frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.97, b: 0.94 } }];
  frame.strokes = [{ type: "SOLID", color: { r: 0.86, g: 0.84, b: 0.79 } }];

  const imageRect = figma.createRectangle();
  imageRect.name = item.kind === "image" ? "Image" : "Poster";
  imageRect.resizeWithoutConstraints(width, height);
  imageRect.cornerRadius = CARD_RADIUS;
  imageRect.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.88, b: 0.82 } }];
  frame.appendChild(imageRect);

  if (!hasMediaFill(imageRect) && item.bytes && item.bytes.length > 0 && item.bytes.length < MAX_IMAGE_BYTES) {
    try {
      const image = figma.createImage(new Uint8Array(item.bytes));
      imageRect.fills = [{
        type: "IMAGE",
        scaleMode: "FILL",
        imageHash: image.hash
      }];
    } catch (error) {
      imageRect.name = "Unsupported image format placeholder";
    }
  }

  if (!hasMediaFill(imageRect) && typeof figma.createImageAsync === "function") {
    const source = mediaImageSource(item);
    for (const candidate of mediaDownloadCandidates(source)) {
      const urls = Array.from(new Set([candidate, proxyUrl(candidate)]));
      for (const imageUrl of urls) {
        try {
          const image = await figma.createImageAsync(imageUrl);
          imageRect.fills = [{
            type: "IMAGE",
            scaleMode: "FILL",
            imageHash: image.hash
          }];
          break;
        } catch (error) {
          // Try the next URL form or Pinterest size variant.
        }
      }
      if (hasMediaFill(imageRect)) break;
    }
  }

  if (item.kind !== "image") {
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });

    const badge = figma.createFrame();
    badge.name = item.kind === "video" ? "Video badge" : "GIF badge";
    badge.resizeWithoutConstraints(item.kind === "video" ? 64 : 48, 28);
    badge.x = 12;
    badge.y = 12;
    badge.cornerRadius = 14;
    badge.fills = [{ type: "SOLID", color: { r: 0.06, g: 0.055, b: 0.05 }, opacity: 0.8 }];
    frame.appendChild(badge);

    const badgeText = figma.createText();
    badgeText.fontName = { family: "Inter", style: "Bold" };
    badgeText.characters = item.kind === "video" ? "VIDEO" : "GIF";
    badgeText.fontSize = 11;
    badgeText.letterSpacing = { value: 0.8, unit: "PIXELS" };
    badgeText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    badgeText.x = item.kind === "video" ? 13 : 14;
    badgeText.y = 8;
    badge.appendChild(badgeText);
  }

  if (item.url) {
    frame.setPluginData("sourceUrl", item.url);
  }

  return frame;
}

function hasMediaFill(node) {
  return Array.isArray(node.fills) && node.fills.some((fill) => fill.type === "IMAGE" || fill.type === "VIDEO");
}

function shortestColumn(columnHeights) {
  let column = 0;
  for (let index = 1; index < columnHeights.length; index += 1) {
    if (columnHeights[index] < columnHeights[column]) {
      column = index;
    }
  }
  return column;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
