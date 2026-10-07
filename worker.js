export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==============================
    // HEALTH CHECK
    // ==============================
    if (url.pathname === "/api/health") {
      return json({
        success: true,
        service: "Deyaler Firebase Gateway",
        status: "online"
      });
    }

    // ==============================
    // PERSON API
    // /api/person?id=Bipul
    // ==============================
    if (url.pathname === "/api/person") {
      try {
        const id = url.searchParams.get("id");

        if (!id) {
          return json({
            success: false,
            error: "Person ID is required"
          }, 400);
        }

        // নিরাপদ ID validation
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
          return json({
            success: false,
            error: "Invalid Person ID"
          }, 400);
        }

        // Firebase access token
        const accessToken = await getFirebaseAccessToken(env);

        // Firebase থেকে নির্দিষ্ট person
        const firebaseUrl =
          "https://jannat-projects-default-rtdb.firebaseio.com/people/" +
          encodeURIComponent(id) +
          ".json";

        const response = await fetch(firebaseUrl, {
          headers: {
            Authorization: "Bearer " + accessToken
          }
        });

        const data = await response.json();

        if (!response.ok) {
          return json({
            success: false,
            error: "Firebase request failed",
            details: data
          }, 500);
        }

        if (data === null) {
          return json({
            success: false,
            error: "Person not found"
          }, 404);
        }

        return json({
          success: true,
          person: data
        });

      } catch (error) {
        return json({
          success: false,
          error: error.message
        }, 500);
      }
    }

    // ==============================
    // TEMPORARY FIREBASE TEST
    // ==============================
    if (url.pathname === "/api/firebase-test") {
      try {
        const accessToken = await getFirebaseAccessToken(env);

        const response = await fetch(
          "https://jannat-projects-default-rtdb.firebaseio.com/people.json",
          {
            headers: {
              Authorization: "Bearer " + accessToken
            }
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return json({
            success: false,
            error: data
          }, 500);
        }

        return json({
          success: true,
          message: "Firebase connection successful",
          peopleFound:
            data && typeof data === "object"
              ? Object.keys(data).length
              : 0
        });

      } catch (error) {
        return json({
          success: false,
          error: error.message
        }, 500);
      }
    }

    // ==============================
    // STATIC WEBSITE
    // ==============================
    return env.ASSETS.fetch(request);
  }
};


// ==========================================
// FIREBASE ACCESS TOKEN
// ==========================================

async function getFirebaseAccessToken(env) {

  if (!env.FIREBASE_CLIENT_EMAIL) {
    throw new Error("FIREBASE_CLIENT_EMAIL পাওয়া যায়নি");
  }

  if (!env.FIREBASE_PRIVATE_KEY) {
    throw new Error("FIREBASE_PRIVATE_KEY পাওয়া যায়নি");
  }

  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

  const pemContents = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(
    atob(pemContents),
    c => c.charCodeAt(0)
  );

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);

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

  const encode = obj =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const unsignedToken =
    encode(header) + "." + encode(claim);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt =
    unsignedToken + "." + signatureBase64;

  const tokenResponse = await fetch(
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

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new Error(
      "Google OAuth failed: " +
      JSON.stringify(tokenData)
    );
  }

  return tokenData.access_token;
}


// ==========================================
// JSON RESPONSE
// ==========================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}
