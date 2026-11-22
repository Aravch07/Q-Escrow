// This private gateway is called only by the authenticated application server.
export default {
  async fetch(request, env) {
    const supplied = request.headers.get("Authorization") || "";
    const expected = "Bearer " + env.STORAGE_SECRET;
    if (!env.STORAGE_SECRET || supplied.length !== expected.length) {
      return new Response("Unauthorized", { status: 401 });
    }
    let difference = 0;
    for (let index = 0; index < expected.length; index++) {
      difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    if (difference) return new Response("Unauthorized", { status: 401 });
    const key = new URL(request.url).pathname.slice(1);
    if (!/^(deliveries\/[0-9a-f]{64}|uploads\/[0-9]+\/[0-9a-f]{32}\/[0-9]+|previews\/[0-9a-f]{64}\/[0-9a-f]{64})$/.test(key)) {
      return new Response("Invalid object", { status: 400 });
    }
    const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream" };
    if (request.method === "PUT") {
      const size = Number(request.headers.get("Content-Length"));
      if (!Number.isSafeInteger(size) || size < 0 || size > 36 * 1024 * 1024) {
        return new Response("Invalid size", { status: 413 });
      }
      await env.FILES.put(key, request.body);
      return new Response(null, { status: 204, headers });
    }
    if (request.method === "GET") {
      const range = request.headers.get("Range");
      if (range && !/^bytes=[0-9]+-[0-9]+$/.test(range)) {
        return new Response("Invalid range", { status: 400 });
      }
      const object = await env.FILES.get(key, range ? { range: request.headers } : {});
      if (!object) return new Response("Missing", { status: 404 });
      return new Response(object.body, { status: 200, headers });
    }
    if (request.method === "DELETE") {
      await env.FILES.delete(key);
      return new Response(null, { status: 204, headers });
    }
    return new Response("Method not allowed", { status: 405 });
  }
};
