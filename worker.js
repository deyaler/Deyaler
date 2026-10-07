// ============================================================
// স্মৃতির দেয়াল | Community Memory Archive
// Cloudflare Worker + Firebase Realtime Database Gateway
// Developed for: Bipul Sheikh
// ============================================================

const FIREBASE_DB_URL =
  "https://jannat-projects-default-rtdb.firebaseio.com";


// ------------------------------------------------------------
// Google OAuth access-token cache
// ------------------------------------------------------------

let cachedAccessToken = null;
let cachedTokenExpiresAt = 0;


// ------------------------------------------------------------
// Base64URL helper
// ------------------------------------------------------------

function base64UrlEncode(input) {
  let bytes;

  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


// ------------------------------------------------------------
// PEM → ArrayBuffer
// ------------------------------------------------------------

function pemToArrayBuffer(pem) {
  const clean = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(clean);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}


// ------------------------------------------------------------
// Create Google OAuth access token
// ------------------------------------------------------------

async function getFirebaseAccessToken(env) {

  const now = Math.floor(Date.now() / 1000);

  if (
    cachedAccessToken &&
    cachedTokenExpiresAt > now + 60
  ) {
    return cachedAccessToken;
  }

  if (
    !env.FIREBASE_CLIENT_EMAIL ||
    !env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error("Firebase Worker secrets are not configured.");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope:
      "https://www.googleapis.com/auth/firebase.database " +
      "https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const encodedHeader = base64UrlEncode(
    JSON.stringify(header)
  );

  const encodedClaim = base64UrlEncode(
    JSON.stringify(claim)
  );

  const unsignedToken =
    encodedHeader + "." + encodedClaim;

  const signature = await crypto.subtle.sign(
    {
      name: "RSASSA-PKCS1-v1_5"
    },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt =
    unsignedToken +
    "." +
    base64UrlEncode(signature);

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body:
        "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer" +
        "&assertion=" +
        encodeURIComponent(jwt)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      "Google OAuth failed: " +
      errorText
    );
  }

  const data = await response.json();

  cachedAccessToken = data.access_token;

  cachedTokenExpiresAt =
    now + Number(data.expires_in || 3600);

  return cachedAccessToken;
}


// ------------------------------------------------------------
// Firebase REST request
// ------------------------------------------------------------

async function firebaseRequest(
  env,
  path,
  options = {}
) {

  const token =
    await getFirebaseAccessToken(env);

  const url =
    FIREBASE_DB_URL +
    path +
    ".json?access_token=" +
    encodeURIComponent(token);

  const response = await fetch(
    url,
    {
      method: options.method || "GET",

      headers: {
        "Content-Type": "application/json"
      },

      body: options.body
        ? JSON.stringify(options.body)
        : undefined
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      "Firebase error " +
      response.status +
      ": " +
      text
    );
  }

  if (!text) {
    return null;
  }

  return JSON.parse(text);
}


// ------------------------------------------------------------
// HTML escaping
// ------------------------------------------------------------

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// ------------------------------------------------------------
// JSON response
// ------------------------------------------------------------

function jsonResponse(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET, OPTIONS",

        "Access-Control-Allow-Headers":
          "Content-Type"
      }
    }
  );
}


// ------------------------------------------------------------
// OPTIONS
// ------------------------------------------------------------

function handleOptions() {

  return new Response(null, {
    status: 204,

    headers: {
      "Access-Control-Allow-Origin": "*",

      "Access-Control-Allow-Methods":
        "GET, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type"
    }
  });
}


// ------------------------------------------------------------
// Get single person
// ------------------------------------------------------------

async function getPerson(env, id) {

  if (!id) {
    return jsonResponse(
      {
        success: false,
        error: "Person ID is required."
      },
      400
    );
  }

  // Basic ID protection
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return jsonResponse(
      {
        success: false,
        error: "Invalid person ID."
      },
      400
    );
  }

  const person =
    await firebaseRequest(
      env,
      "/people/" + encodeURIComponent(id)
    );

  if (!person) {
    return jsonResponse(
      {
        success: false,
        error: "Person not found."
      },
      404
    );
  }

  return jsonResponse({
    success: true,
    data: person
  });
}


// ------------------------------------------------------------
// Get all people
//
// IMPORTANT:
// This endpoint is intentionally NOT exposed publicly.
// Never create /api/people.json or similar.
// ------------------------------------------------------------


// ------------------------------------------------------------
// Search
//
// Firebase Realtime Database does not naturally perform
// contains-search efficiently.
//
// For the first secure version we retrieve the data SERVER-SIDE,
// process it here, and return only matching records.
//
// Later we can optimize this with a dedicated search index.
// ------------------------------------------------------------

async function searchPeople(env, query) {

  query =
    String(query || "")
      .trim()
      .toLowerCase();

  if (!query) {
    return jsonResponse({
      success: true,
      data: []
    });
  }

  if (query.length < 2) {
    return jsonResponse({
      success: true,
      data: []
    });
  }

  // Safety limit
  if (query.length > 100) {
    query = query.substring(0, 100);
  }

  const people =
    await firebaseRequest(
      env,
      "/people"
    );

  if (!people || typeof people !== "object") {
    return jsonResponse({
      success: true,
      data: []
    });
  }

  const results = [];

  for (const key of Object.keys(people)) {

    const person = people[key];

    if (!person || typeof person !== "object") {
      continue;
    }

    const searchable = [
      person.id,
      person.name,
      person.father,
      person.village,
      person.upazilla,
      person.zilla,
      person.key
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (searchable.includes(query)) {

      results.push({
        id: person.id || key,
        name: person.name || "",
        father: person.father || "",
        village: person.village || "",
        upazilla: person.upazilla || "",
        zilla: person.zilla || "",
        dateOfBirth: person.dateOfBirth || "",
        deathDate: person.deathDate || "",
        status: person.status || "",
        avatar: person.avatar || "",
        visibility: person.visibility ?? true
      });
    }

    // Never return unlimited search results
    if (results.length >= 50) {
      break;
    }
  }

  return jsonResponse({
    success: true,
    count: results.length,
    data: results
  });
}


// ------------------------------------------------------------
// Statistics
// ------------------------------------------------------------

async function getStatistics(env) {

  const people =
    await firebaseRequest(
      env,
      "/people"
    );

  let total = 0;
  let alive = 0;
  let deceased = 0;

  if (people && typeof people === "object") {

    for (const key of Object.keys(people)) {

      const person = people[key];

      if (!person || typeof person !== "object") {
        continue;
      }

      total++;

      const status =
        String(person.status || "")
          .toLowerCase();

      if (
        status.includes("deceased") ||
        status.includes("মৃত") ||
        person.deathDate
      ) {
        deceased++;
      } else {
        alive++;
      }
    }
  }

  return jsonResponse({
    success: true,

    data: {
      total,
      alive,
      deceased
    }
  });
}


// ------------------------------------------------------------
// Birthday
// ------------------------------------------------------------

async function getBirthday(env) {

  const people =
    await firebaseRequest(
      env,
      "/people"
    );

  const now =
    new Date();

  const month =
    String(now.getMonth() + 1)
      .padStart(2, "0");

  const day =
    String(now.getDate())
      .padStart(2, "0");

  const results = [];

  if (people && typeof people === "object") {

    for (const key of Object.keys(people)) {

      const person = people[key];

      if (!person || !person.dateOfBirth) {
        continue;
      }

      const date =
        String(person.dateOfBirth);

      // Supports YYYY-MM-DD
      if (
        date.length >= 10 &&
        date.substring(5, 7) === month &&
        date.substring(8, 10) === day
      ) {

        results.push({
          id: person.id || key,
          name: person.name || "",
          dateOfBirth: date,
          avatar: person.avatar || ""
        });
      }
    }
  }

  return jsonResponse({
    success: true,
    data: results.slice(0, 20)
  });
}


// ------------------------------------------------------------
// Featured memory
// ------------------------------------------------------------

async function getFeatured(env) {

  const people =
    await firebaseRequest(
      env,
      "/people"
    );

  if (!people || typeof people !== "object") {
    return jsonResponse({
      success: true,
      data: null
    });
  }

  const keys =
    Object.keys(people);

  if (!keys.length) {
    return jsonResponse({
      success: true,
      data: null
    });
  }

  // Deterministic selection.
  // Later this can be replaced with a dedicated featured field.
  const key =
    keys[0];

  const person =
    people[key];

  if (!person) {
    return jsonResponse({
      success: true,
      data: null
    });
  }

  return jsonResponse({
    success: true,

    data: {
      id: person.id || key,
      name: person.name || "",
      avatar: person.avatar || "",
      village: person.village || "",
      upazilla: person.upazilla || "",
      zilla: person.zilla || "",
      dateOfBirth: person.dateOfBirth || "",
      deathDate: person.deathDate || ""
    }
  });
}


// ------------------------------------------------------------
// Main router
// ------------------------------------------------------------

async function handleApi(request, env) {

  const url =
    new URL(request.url);

  const path =
    url.pathname;

  // ----------------------------------------------------------
  // Person
  //
  // /api/person?id=ABC123
  // ----------------------------------------------------------

  if (path === "/api/person") {

    const id =
      url.searchParams.get("id");

    return await getPerson(
      env,
      id
    );
  }


  // ----------------------------------------------------------
  // Search
  //
  // /api/search?q=bipul
  // ----------------------------------------------------------

  if (path === "/api/search") {

    const query =
      url.searchParams.get("q");

    return await searchPeople(
      env,
      query
    );
  }


  // ----------------------------------------------------------
  // Statistics
  // ----------------------------------------------------------

  if (path === "/api/statistics") {

    return await getStatistics(
      env
    );
  }


  // ----------------------------------------------------------
  // Birthday
  // ----------------------------------------------------------

  if (path === "/api/birthday") {

    return await getBirthday(
      env
    );
  }


  // ----------------------------------------------------------
  // Featured
  // ----------------------------------------------------------

  if (path === "/api/featured") {

    return await getFeatured(
      env
    );
  }


  // ----------------------------------------------------------
  // Health check
  // ----------------------------------------------------------

  if (path === "/api/health") {

    return jsonResponse({
      success: true,
      service: "Deyaler Firebase Gateway",
      status: "online"
    });
  }


  return jsonResponse(
    {
      success: false,
      error: "API endpoint not found."
    },
    404
  );
}


// ------------------------------------------------------------
// Worker entry point
// ------------------------------------------------------------

export default {

  async fetch(request, env) {

    // CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    const url =
      new URL(request.url);

    // --------------------------------------------------------
    // API
    // --------------------------------------------------------

    if (
      url.pathname.startsWith("/api/")
    ) {

      if (request.method !== "GET") {

        return jsonResponse(
          {
            success: false,
            error: "Method not allowed."
          },
          405
        );
      }

      try {

        return await handleApi(
          request,
          env
        );

      } catch (error) {

        console.error(
          "Worker error:",
          error
        );

        return jsonResponse(
          {
            success: false,
            error:
              "Internal server error."
          },
          500
        );
      }
    }


    // --------------------------------------------------------
    // Website static files
    //
    // ASSETS binding will serve:
    // index.html
    // find.html
    // details.html
    // upload.html
    // etc.
    // --------------------------------------------------------

    if (env.ASSETS) {

      return env.ASSETS.fetch(
        request
      );
    }


    return new Response(
      "Deyaler Worker is running.",
      {
        status: 200,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }
};
