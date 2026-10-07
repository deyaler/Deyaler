export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Firebase connection test
    if (url.pathname === "/api/firebase-test") {
      try {
        if (!env.FIREBASE_CLIENT_EMAIL) {
          return json({
            success: false,
            error: "FIREBASE_CLIENT_EMAIL পাওয়া যায়নি"
          }, 500);
        }

        if (!env.FIREBASE_PRIVATE_KEY) {
          return json({
            success: false,
            error: "FIREBASE_PRIVATE_KEY পাওয়া যায়নি"
          }, 500);
        }

        // Private key-এর \n ঠিক করা
        const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

        // PEM key import
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

        // JWT তৈরি
        const now = Math.floor(Date.now() / 1000);

        const header = {
          alg: "RS256",
          typ: "JWT"
        };

        const claim = {
          iss: env.FIREBASE_CLIENT_EMAIL,
          scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
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

        const jwt = unsignedToken + "." + signatureBase64;

        // Google OAuth token
        const tokenResponse = await fetch(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body:
              "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer" +
              "&assertion=" + encodeURIComponent(jwt)
          }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
          return json({
            success: false,
            step: "google_oauth",
            error: tokenData
          }, 500);
        }

        // Firebase read test
        const firebaseResponse = await fetch(
          "https://jannat-projects-default-rtdb.firebaseio.com/people.json",
          {
            headers: {
              Authorization: "Bearer " + tokenData.access_token
            }
          }
        );

        const firebaseData = await firebaseResponse.json();

        if (!firebaseResponse.ok) {
          return json({
            success: false,
            step: "firebase",
            error: firebaseData
          }, 500);
        }

        return json({
          success: true,
          message: "Firebase connection successful",
          peopleFound:
            firebaseData && typeof firebaseData === "object"
              ? Object.keys(firebaseData).length
              : 0
        });

      } catch (error) {
        return json({
          success: false,
          error: error.message
        }, 500);
      }
    }

    // Normal health test
    if (url.pathname === "/api/health") {
      return json({
        success: true,
        service: "Deyaler Firebase Gateway",
        status: "online"
      });
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8"
      }
    }
  );
}
