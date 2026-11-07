export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API atau health check endpoint jika dibutuhkan
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", app: "Printifya", timestamp: Date.now() }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Sajikan file statis via binding ASSETS bawaan Freebuff Sites
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // Fallback SPA routing: Jika route tidak cocok dengan file fisik statis,
      // arahkan kembali ke index.html agar React Router yang menangani route di browser
      const indexRequest = new Request(new URL("/", request.url), request);
      return env.ASSETS.fetch(indexRequest);
    }

    return new Response("Not Found", { status: 404 });
  },
};
