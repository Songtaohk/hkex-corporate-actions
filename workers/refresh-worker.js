const WINDOW_SECONDS = 24 * 60 * 60;

function json(payload, init = {}, origin = "*") {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function getAllowedOrigin(request) {
  return request.headers.get("origin") || "*";
}

async function dispatchGithubWorkflow(env) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WORKFLOW || "deploy-pages.yml";
  const ref = env.GITHUB_REF || "main";

  if (!owner || !repo || !env.GITHUB_TOKEN) {
    throw new Error("GitHub workflow configuration is incomplete");
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "hkex-corporate-actions-refresh-worker",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${body}`);
  }
}

const refreshWorker = {
  async fetch(request, env) {
    const origin = getAllowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ message: "Only POST is supported" }, { status: 405 }, origin);
    }

    if (!env.REFRESH_LIMITS) {
      return json({ message: "Rate limit storage is not configured" }, { status: 500 }, origin);
    }

    const ip = getClientIp(request);
    const key = `refresh:${ip}`;
    const existing = await env.REFRESH_LIMITS.get(key, "json");

    if (existing?.nextAllowedAt) {
      return json(
        {
          message: "This IP has already requested a refresh in the last 24 hours.",
          nextAllowedAt: existing.nextAllowedAt,
        },
        { status: 429 },
        origin,
      );
    }

    const now = Date.now();
    const nextAllowedAt = new Date(now + WINDOW_SECONDS * 1000).toISOString();
    await env.REFRESH_LIMITS.put(
      key,
      JSON.stringify({ requestedAt: new Date(now).toISOString(), nextAllowedAt }),
      { expirationTtl: WINDOW_SECONDS },
    );

    try {
      await dispatchGithubWorkflow(env);
    } catch (error) {
      await env.REFRESH_LIMITS.delete(key);
      return json(
        { message: error instanceof Error ? error.message : "Refresh dispatch failed" },
        { status: 502 },
        origin,
      );
    }

    return json(
      {
        message: "已提交後台刷新，資料生成及發布通常需要數分鐘。",
        nextAllowedAt,
      },
      { status: 202 },
      origin,
    );
  },
};

export default refreshWorker;
