export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "WORKER IS RUNNING",
          path: url.pathname
        }),
        {
          headers: {
            "content-type": "application/json; charset=UTF-8"
          }
        }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
