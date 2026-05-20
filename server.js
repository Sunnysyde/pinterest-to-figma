const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_HOSTS = [
  "pinterest.",
  "pinimg.com"
];

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://127.0.0.1:${PORT}`);

  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname !== "/fetch") {
    sendText(response, 404, "Not found");
    return;
  }

  const target = requestUrl.searchParams.get("url");
  if (!target || !isAllowedTarget(target)) {
    sendText(response, 400, "Only public Pinterest and pinimg URLs can be fetched.");
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        "accept": acceptHeaderForTarget(target),
        "user-agent": "Mozilla/5.0 PinterestBoardCanvas/0.1"
      },
      redirect: "follow"
    });
    const contentType = upstream.headers.get("content-type") || "text/plain; charset=utf-8";
    const body = await upstream.arrayBuffer();

    if (!upstream.ok && isPinimgTarget(target)) {
      response.writeHead(204, {
        "content-type": "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end();
      return;
    }

    response.writeHead(upstream.status, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    response.end(Buffer.from(body));
  } catch (error) {
    sendText(response, 502, error && error.message ? error.message : "Proxy request failed.");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Pinterest Board Canvas proxy running at http://127.0.0.1:${PORT}`);
});

function isAllowedTarget(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return ALLOWED_HOSTS.some((host) => url.hostname.includes(host));
  } catch (error) {
    return false;
  }
}

function isPinimgTarget(value) {
  try {
    return new URL(value).hostname.includes("pinimg.com");
  } catch (error) {
    return false;
  }
}

function acceptHeaderForTarget(value) {
  if (isPinimgTarget(value)) {
    return "image/jpeg,image/png,image/gif,video/mp4,*/*;q=0.5";
  }

  return "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response, status, value) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
}
