
const FIREBASE_DB_URL =
  "https://jannat-projects-default-rtdb.firebaseio.com";

const FIREBASE_TOKEN_URL =
  "https://oauth2.googleapis.com/token";

const FIREBASE_SCOPE =
  "https://www.googleapis.com/auth/firebase.database " +
  "https://www.googleapis.com/auth/userinfo.email";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // HEALTH CHECK
      if (path === "/api/health" && request.method === "GET") {
        return json({
          success: true,
          service: "Deyaler Firebase Gateway",
          status: "online"
        });
      }

      // PERSON ID CHECK
      if (
        path === "/api/person/check" &&
        request.method === "GET"
      ) {
        const id = getValidId(url.searchParams.get("id"));

        if (!id) {
          return json({
            success: false,
            message: "Person ID is required"
          }, 400);
        }

        const person = await firebaseGet(
          `/people/${encodeURIComponent(id)}`,
          env
        );

        return json({
          success: true,
          exists: !!person,
          ...(person ? { id } : {})
        });
      }

      // CREATE PERSON
      // POST /api/person/create
      if (
        path === "/api/person/create" &&
        request.method === "POST"
      ) {
        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            success: false,
            message: "Invalid JSON"
          }, 400);
        }

        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body)
        ) {
          return json({
            success: false,
            message: "Invalid request body"
          }, 400);
        }

        const id = getValidId(body.id);

        if (!id) {
          return json({
            success: false,
            message: "Invalid Person ID"
          }, 400);
        }

        const requiredFields = [
          "name",
          "father",
          "village",
          "upazilla",
          "zilla",
          "dateOfBirth"
        ];

        for (const field of requiredFields) {
          if (
            typeof body[field] !== "string" ||
            !body[field].trim()
          ) {
            return json({
              success: false,
              message: "Missing field: " + field
            }, 400);
          }
        }

        // Prevent overwriting an existing person.
        const existing = await firebaseGet(
          `/people/${encodeURIComponent(id)}`,
          env
        );

        if (existing) {
          return json({
            success: false,
            message: "Person ID already exists"
          }, 409);
        }

        const personData = {
          id,
          name: body.name.trim(),
          father: body.father.trim(),
          village: body.village.trim(),
          upazilla: body.upazilla.trim(),
          zilla: body.zilla.trim(),
          dateOfBirth: body.dateOfBirth,
          deathDate: String(body.deathDate || ""),
          status: body.status === true,
          key: "",
          visibility: "private",
          todayDate: String(body.todayDate || ""),
          reviewStatus: "under_review",
          storageServer: body.storageServer === "B" ? "B" : "A"
        };

        await firebasePut(
          `/people/${encodeURIComponent(id)}`,
          personData,
          env
        );

        return json({
          success: true,
          id
        }, 201);
      }

      // PUBLIC PERSON PROFILE
      if (
        path === "/api/person" &&
        request.method === "GET"
      ) {
        const id = getValidId(url.searchParams.get("id"));

        if (!id) {
          return json({
            success: false,
            message: "Person ID is required"
          }, 400);
        }

        const person = await firebaseGet(
          `/people/${encodeURIComponent(id)}`,
          env
        );

        if (!person) {
          return json({
            success: false,
            message: "Person not found"
          }, 404);
        }

        if (person.visibility !== "public") {
          return json({
            success: false,
            message: "This profile is private"
          }, 403);
        }

        return json({
          success: true,
          person: publicPerson(person, id)
        });
      }

      // PRIVATE PERSON ACCESS
      if (
        path === "/api/person/access" &&
        request.method === "POST"
      ) {
        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            success: false,
            message: "Invalid JSON"
          }, 400);
        }

        const id = getValidId(body?.id);
        const key = String(body?.key || "");

        if (!id || !key) {
          return json({
            success: false,
            message: "ID and key are required"
          }, 400);
        }

        const person = await firebaseGet(
          `/people/${encodeURIComponent(id)}`,
          env
        );

        if (!person) {
          return json({
            success: false,
            message: "Person not found"
          }, 404);
        }

        if (String(person.key || "") !== key) {
          return json({
            success: false,
            message: "Invalid access key"
          }, 403);
        }

        return json({
          success: true,
          authorized: true,
          person: publicPerson(person, id, true)
        });
      }

      // SEARCH PUBLIC PEOPLE
      if (
        path === "/api/search" &&
        request.method === "GET"
      ) {
        const q = String(
          url.searchParams.get("q") || ""
        ).trim().toLowerCase();

        if (!q) {
          return json({
            success: true,
            query: "",
            count: 0,
            results: []
          });
        }

        const people = await firebaseGet("/people", env) || {};
        const results = [];

        for (const [id, person] of Object.entries(people)) {
          if (
            !person ||
            typeof person !== "object" ||
            person.visibility !== "public"
          ) {
            continue;
          }

          const fields = [
            person.name,
            person.father,
            person.village,
            person.upazilla,
            person.zilla,
            person.id || id
          ];

          const matched = fields.some(value =>
            String(value || "").toLowerCase().includes(q)
          );

          if (!matched) continue;

          results.push({
            id: person.id || id,
            name: person.name || "",
            avatar: person.avatar || "",
            father: person.father || "",
            village: person.village || "",
            upazilla: person.upazilla || "",
            zilla: person.zilla || "",
            dateOfBirth: person.dateOfBirth || "",
            deathDate: person.deathDate || "",
            status: person.status || "",
            gender: person.gender || "",
            visibility: "public"
          });
        }

        results.sort((a, b) =>
          String(a.name).localeCompare(String(b.name), "bn")
        );

        return json({
          success: true,
          query: q,
          count: results.length,
          results: results.slice(0, 100)
        });
      }

      // HOMEPAGE API
      if (
        path === "/api/homepage" &&
        request.method === "GET"
      ) {
        const people = await firebaseGet("/people", env) || {};
        const allPeople = [];

        for (const [id, person] of Object.entries(people)) {
          if (!person || typeof person !== "object") continue;

          allPeople.push({
            id: person.id || id,
            person
          });
        }

        const total = allPeople.length;
        const alive = allPeople.filter(
          item => isAlive(item.person)
        ).length;
        const deceased = total - alive;

        const publicPeople = allPeople.filter(
          item => item.person.visibility === "public"
        );

        const today = getDhakaDate();
        const birthdays = [];

        for (const item of publicPeople) {
          const person = item.person;

          if (
            !isAlive(person) ||
            !isBirthdayToday(person.dateOfBirth, today)
          ) {
            continue;
          }

          birthdays.push({
            id: item.id,
            name: person.name || "",
            avatar: person.avatar || "",
            dateOfBirth: person.dateOfBirth || "",
            father: person.father || "",
            village: person.village || "",
            upazilla: person.upazilla || "",
            zilla: person.zilla || "",
            gender: person.gender || "",
            status: person.status || "alive"
          });
        }

        const deceasedPublic = publicPeople.filter(
          item => !isAlive(item.person)
        );

        let featured = null;

        if (deceasedPublic.length > 0) {
          const index = deterministicIndex(
            today,
            deceasedPublic.length
          );

          const item = deceasedPublic[index];
          const person = item.person;

          featured = {
            id: item.id,
            name: person.name || "",
            avatar: person.avatar || "",
            father: person.father || "",
            village: person.village || "",
            upazilla: person.upazilla || "",
            zilla: person.zilla || "",
            dateOfBirth: person.dateOfBirth || "",
            deathDate: person.deathDate || "",
            gender: person.gender || "",
            status: person.status || "deceased",
            joinDate: person.joinDate || ""
          };
        }

        return json({
          success: true,
          date: today,
          statistics: {
            total,
            alive,
            deceased
          },
          birthdays,
          featured
        });
      }

      // FAMILY TREE API
    
     
      // FAMILY TREE API
      // Exposes opaque IDs, names, gender and relationships only.
      if (
        path === "/api/tree" &&
        request.method === "GET"
      ) {
        const requestedId = getValidId(
          url.searchParams.get("id")
        );

        const people =
          await firebaseGet("/people", env) || {};

        const relationships =
          await firebaseGet("/relationships", env) || {};

        // Generate opaque references without exposing Firebase IDs.
        const secret = String(env.FIREBASE_PRIVATE_KEY || "")
          .replace(/\\n/g, "\n")
          .trim();

        if (!secret) {
          throw new Error("FIREBASE_PRIVATE_KEY is missing");
        }

        const treeKey = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          {
            name: "HMAC",
            hash: "SHA-256"
          },
          false,
          ["sign"]
        );

        async function makeOpaqueId(realId) {
          const signature = await crypto.subtle.sign(
            "HMAC",
            treeKey,
            new TextEncoder().encode(String(realId))
          );

          return "p_" + arrayBufferToBase64Url(signature);
        }

        // Normalize known gender values; never guess from a name.
        function normalizeGender(value) {
          const gender = String(value || "")
            .trim()
            .toLowerCase();

          if ([
            "male", "man", "boy", "পুরুষ", "ছেলে", "ছাত্র"
          ].includes(gender)) {
            return "male";
          }

          if ([
            "female", "woman", "girl", "নারী", "মহিলা",
            "মেয়ে", "মেয়ে", "ছাত্রী"
          ].includes(gender)) {
            return "female";
          }

          return "";
        }

        const safePeople = {};
        const realToOpaque = {};

        for (const [realId, person] of Object.entries(people)) {
          if (
            !person ||
            typeof person !== "object" ||
            Array.isArray(person)
          ) {
            continue;
          }

          const opaqueId = await makeOpaqueId(realId);

          realToOpaque[realId] = opaqueId;

          // Expose only the person's name and normalized gender.
          safePeople[opaqueId] = {
            name: String(person.name || "").trim() || "নাম নেই",
            gender: normalizeGender(person.gender)
          };
        }

        let rootId = null;

        if (requestedId) {
          // Support a real ID supplied by a trusted caller.
          if (realToOpaque[requestedId]) {
            rootId = realToOpaque[requestedId];
          } else {
            // Also accept an opaque ID from the tree API.
            for (const opaqueId of Object.values(realToOpaque)) {
              if (opaqueId === requestedId) {
                rootId = opaqueId;
                break;
              }
            }
          }

          if (!rootId) {
            return json({
              success: false,
              message: "Person not found"
            }, 404);
          }
        }

        const safeRelationships = [];

        for (const relation of Object.values(relationships)) {
          if (
            !relation ||
            typeof relation !== "object" ||
            Array.isArray(relation)
          ) {
            continue;
          }

          const fromRaw =
            relation.from ||
            relation.source ||
            relation.person1 ||
            relation.parent;

          const toRaw =
            relation.to ||
            relation.target ||
            relation.person2 ||
            relation.child;

          const type = String(relation.type || "").trim();

          if (!fromRaw || !toRaw || !type) {
            continue;
          }

          const from = realToOpaque[String(fromRaw)];
          const to = realToOpaque[String(toRaw)];

          if (!from || !to) {
            continue;
          }

          safeRelationships.push({
            from,
            to,
            type
          });
        }

        return json({
          success: true,
          rootId,
          people: safePeople,
          relationships: safeRelationships
        });
      }

      // =====================================================
      // ADMIN GEMINI AGENT — PLAN / READ-ONLY ASSISTANCE
      // POST /api/admin/agent
      // =====================================================
      if (
        path === "/api/admin/agent" &&
        request.method === "POST"
      ) {
        if (!isAdminAuthorized(request, env)) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401);
        }

        if (!env.GEMINI_API_KEY) {
          return json({
            success: false,
            message: "GEMINI_API_KEY is missing"
          }, 500);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            success: false,
            message: "Invalid JSON"
          }, 400);
        }

        const message = String(body?.message || "").trim();

        if (!message || message.length > 4000) {
          return json({
            success: false,
            message: "Message is required (maximum 4000 characters)"
          }, 400);
        }

        // Provide only a limited, relevant set of matching records.
        const allPeople = await firebaseGet("/people", env) || {};
        const searchText = message.toLowerCase();
        const words = searchText.split(/\s+/).filter(Boolean);

        const matchedPeople = Object.entries(allPeople)
          .filter(([id, person]) => {
            if (!person || typeof person !== "object") return false;

            const searchable = [
              id,
              person.id,
              person.name,
              person.father,
              person.village,
              person.upazilla,
              person.zilla
            ].join(" ").toLowerCase();

            return words.some(word => searchable.includes(word));
          })
          .slice(0, 20)
          .map(([id, person]) => ({
            id,
            name: String(person.name || ""),
            father: String(person.father || ""),
            village: String(person.village || ""),
            upazilla: String(person.upazilla || ""),
            zilla: String(person.zilla || ""),
            dateOfBirth: String(person.dateOfBirth || ""),
            deathDate: String(person.deathDate || ""),
            status: person.status ?? "",
            gender: String(person.gender || ""),
            visibility: String(person.visibility || ""),
            reviewStatus: String(person.reviewStatus || "")
          }));

        const allowedFields = [
          "name",
          "father",
          "village",
          "upazilla",
          "zilla",
          "dateOfBirth",
          "deathDate",
          "status",
          "gender",
          "visibility",
          "reviewStatus",
          "joinDate",
          "avatar"
        ];

        const prompt = `
You are the private admin assistant for the Deyaler family-memory website.

User's request:
${message}

Matching Firebase people records:
${JSON.stringify(matchedPeople)}

You must return ONLY valid JSON with this shape:
{
  "reply": "Helpful Bengali response",
  "action": null
}

If the user clearly asks to change a person's existing data, you may propose:
{
  "reply": "Explain the proposed change in Bengali",
  "action": {
    "type": "update_person",
    "id": "existing exact person ID",
    "fields": {
      "allowedField": "new value"
    }
  }
}

Rules:
- Never claim that data has already been changed.
- Propose a change only when the request clearly asks for one.
- The ID must match one of the records above exactly.
- Only use these editable fields: ${allowedFields.join(", ")}.
- Never propose changing "id", "key", credentials, Firebase settings, or arbitrary database paths.
- Do not invent missing personal data.
- visibility must be "public" or "private".
- For status, use the user's explicit requested value; do not infer life/death status.
- If no record matches or the request is unclear, action must be null and ask a clarifying question.
- The website user must confirm a proposed change separately before it is applied.
- Answer in simple Bengali unless the user requests another language.
`;

       const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
        const endpoint =
          "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) +
          ":generateContent";

        const geminiResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [{ text: prompt }]
            }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2
            }
          })
        });

        const geminiData = await geminiResponse.json();

       
if (!geminiResponse.ok) {
  const errorData = await geminiResponse.json().catch(() => ({}));

  const errorMessage =
    errorData?.error?.message ||
    "Gemini API returned an unknown error";

  console.error("Gemini API error:", {
    status: geminiResponse.status,
    message: errorMessage
  });

  return json({
    success: false,
    message: "Gemini API request failed",
    status: geminiResponse.status,
    details: errorMessage
  }, 502);
}


        const responseText =
          geminiData?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("") || "";

        let result;

        try {
          result = JSON.parse(responseText);
        } catch {
          return json({
            success: false,
            message: "Gemini returned an invalid response. Please try again."
          }, 502);
        }

        let proposedAction = null;

        if (result.action && result.action.type === "update_person") {
          const id = getValidId(result.action.id);
          const fields = result.action.fields;

          if (
            id &&
            matchedPeople.some(person => person.id === id) &&
            fields &&
            typeof fields === "object" &&
            !Array.isArray(fields)
          ) {
            const cleanFields = {};

            for (const [field, value] of Object.entries(fields)) {
              if (!allowedFields.includes(field)) continue;

              if (field === "status") {
                if (
                  typeof value !== "string" &&
                  typeof value !== "boolean"
                ) continue;

                cleanFields[field] = value;
                continue;
              }

              if (typeof value !== "string" || value.length > 1000) {
                continue;
              }

              if (
                field === "visibility" &&
                !["public", "private"].includes(value)
              ) {
                continue;
              }

              cleanFields[field] = value;
            }

            if (Object.keys(cleanFields).length > 0) {
              proposedAction = {
                type: "update_person",
                id,
                fields: cleanFields
              };
            }
          }
        }

        return json({
          success: true,
          reply: String(result.reply || "কী করতে হবে তা আরেকটু পরিষ্কার করে বলুন।"),
          action: proposedAction,
          requiresConfirmation: !!proposedAction
        });
      }

      // =====================================================
      // ADMIN GEMINI AGENT — CONFIRMED UPDATE
      // POST /api/admin/agent/confirm
      // =====================================================
      if (
        path === "/api/admin/agent/confirm" &&
        request.method === "POST"
      ) {
        if (!isAdminAuthorized(request, env)) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            success: false,
            message: "Invalid JSON"
          }, 400);
        }

        if (body?.confirm !== true) {
          return json({
            success: false,
            message: "Explicit confirmation is required"
          }, 400);
        }

        const action = body.action;
        const id = getValidId(action?.id);

        if (
          action?.type !== "update_person" ||
          !id ||
          !action.fields ||
          typeof action.fields !== "object" ||
          Array.isArray(action.fields)
        ) {
          return json({
            success: false,
            message: "Invalid update action"
          }, 400);
        }

        const allowedFields = [
          "name",
          "father",
          "village",
          "upazilla",
          "zilla",
          "dateOfBirth",
          "deathDate",
          "status",
          "gender",
          "visibility",
          "reviewStatus",
          "joinDate",
          "avatar"
        ];

        const cleanFields = {};

        for (const [field, value] of Object.entries(action.fields)) {
          if (!allowedFields.includes(field)) {
            return json({
              success: false,
              message: "Field is not allowed: " + field
            }, 400);
          }

          if (field === "status") {
            if (
              typeof value !== "string" &&
              typeof value !== "boolean"
            ) {
              return json({
                success: false,
                message: "Invalid status value"
              }, 400);
            }

            cleanFields[field] = value;
            continue;
          }

          if (typeof value !== "string" || value.length > 1000) {
            return json({
              success: false,
              message: "Invalid value for field: " + field
            }, 400);
          }

          if (
            field === "visibility" &&
            !["public", "private"].includes(value)
          ) {
            return json({
              success: false,
              message: "visibility must be public or private"
            }, 400);
          }

          cleanFields[field] = value;
        }

        if (Object.keys(cleanFields).length === 0) {
          return json({
            success: false,
            message: "No valid fields to update"
          }, 400);
        }

        const existing = await firebaseGet(
          `/people/${encodeURIComponent(id)}`,
          env
        );

        if (!existing || typeof existing !== "object") {
          return json({
            success: false,
            message: "Person not found"
          }, 404);
        }

        // Update only approved fields; leave all other data untouched.
        await firebasePatch(
          `/people/${encodeURIComponent(id)}`,
          cleanFields,
          env
        );

        return json({
          success: true,
          message: "Confirmed changes saved successfully",
          id,
          updatedFields: Object.keys(cleanFields)
        });
      }
      

      // WEBSITE ASSETS
      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Deyaler Worker Error:", error);

      return json({
        success: false,
        message: "Internal server error"
      }, 500);
    }
  }
};


// ============================================================
// FIREBASE GET
// ============================================================

async function firebaseGet(path, env) {
  const token = await getFirebaseAccessToken(env);

  const response = await fetch(
    FIREBASE_DB_URL + path + ".json",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Firebase GET failed: ${response.status} ${errorText}`
    );
  }

  return await response.json();
}


// ============================================================
// FIREBASE PUT
// ============================================================

async function firebasePut(path, data, env) {
  const token = await getFirebaseAccessToken(env);

  const response = await fetch(
    FIREBASE_DB_URL + path + ".json",
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Firebase PUT failed: ${response.status} ${errorText}`
    );
  }

  return await response.json();
}


// ============================================================
// FIREBASE ACCESS TOKEN
// ============================================================

async function getFirebaseAccessToken(env) {
  if (!env.FIREBASE_CLIENT_EMAIL) {
    throw new Error("FIREBASE_CLIENT_EMAIL is missing");
  }

  if (!env.FIREBASE_PRIVATE_KEY) {
    throw new Error("FIREBASE_PRIVATE_KEY is missing");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: FIREBASE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
    scope: FIREBASE_SCOPE
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));

  const unsignedToken = encodedHeader + "." + encodedPayload;

  const privateKeyPem = env.FIREBASE_PRIVATE_KEY
    .replace(/\\n/g, "\n")
    .trim();

  const privateKey = await importPrivateKey(privateKeyPem);

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt =
    unsignedToken + "." + arrayBufferToBase64Url(signature);

  const tokenResponse = await fetch(
    FIREBASE_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      })
    }
  );

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();

    throw new Error(
      `Google OAuth failed: ${tokenResponse.status} ${errorText}`
    );
  }

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    throw new Error(
      "Google OAuth did not return access_token"
    );
  }

  return tokenData.access_token;
}


// ============================================================
// IMPORT PRIVATE KEY
// ============================================================

async function importPrivateKey(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
}


// ============================================================
// PUBLIC PERSON RESPONSE
// ============================================================

function publicPerson(person, id, authorized = false) {
  return {
    id: person.id || id,
    name: person.name || "",
    avatar: person.avatar || "",
    gender: person.gender || "",
    dateOfBirth: person.dateOfBirth || "",
    deathDate: person.deathDate || "",
    status: person.status || "",
    father: person.father || "",
    village: person.village || "",
    upazilla: person.upazilla || "",
    zilla: person.zilla || "",
    joinDate: person.joinDate || "",
    todayDate: person.todayDate || "",
    reviewStatus: person.reviewStatus || "",
    visibility: person.visibility || "",
    storageServer: person.storageServer || ""
  };
}


// ============================================================
// VALID PERSON ID
// ============================================================

function getValidId(value) {
  if (value === null || value === undefined) return null;

  const id = String(value).trim();

  if (!id) return null;

  if (
    id.length > 200 ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes(".") ||
    id.includes("#") ||
    id.includes("$") ||
    id.includes("[") ||
    id.includes("]")
  ) {
    return null;
  }

  return id;
}


// ============================================================
// ALIVE CHECK
// ============================================================

function isAlive(person) {
  if (!person) return false;

  const status = String(person.status || "")
    .trim()
    .toLowerCase();

  if (
    status === "deceased" ||
    status === "dead" ||
    status === "মৃত"
  ) {
    return false;
  }

  if (
    person.deathDate &&
    String(person.deathDate).trim() !== ""
  ) {
    return false;
  }

  return true;
}


// ============================================================
// DHAKA DATE
// ============================================================

function getDhakaDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}


// ============================================================
// BIRTHDAY CHECK
// ============================================================

function isBirthdayToday(dateOfBirth, today) {
  if (!dateOfBirth || !today) return false;

  const dobParts = String(dateOfBirth).trim().split("-");
  const todayParts = String(today).trim().split("-");

  if (dobParts.length < 3 || todayParts.length < 3) {
    return false;
  }

  return (
    dobParts[1] === todayParts[1] &&
    dobParts[2] === todayParts[2]
  );
}


// ============================================================
// DETERMINISTIC INDEX
// ============================================================

function deterministicIndex(date, length) {
  if (!length || length <= 0) return 0;

  let hash = 0;

  for (let i = 0; i < date.length; i++) {
    hash = (
      ((hash << 5) - hash + date.charCodeAt(i)) | 0
    );
  }

  return Math.abs(hash) % length;
}


// ============================================================
// BASE64URL HELPERS
// ============================================================

function base64urlEncode(text) {
  return arrayBufferToBase64Url(
    new TextEncoder().encode(text)
  );
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        Math.min(i + chunkSize, bytes.length)
      )
    );
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders()
      }
    }
  );
}


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

// ============================================================
// ADMIN AUTHENTICATION FOR THE NEW AGENT ENDPOINTS
// ============================================================

function isAdminAuthorized(request, env) {
  const configuredToken = String(env.ADMIN_TOKEN || "");

  if (!configuredToken) return false;

  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) return false;

  const suppliedToken = match[1].trim();

  if (!suppliedToken || suppliedToken.length > 500) return false;

  // Compare without returning token values or logging them.
  const a = new TextEncoder().encode(suppliedToken);
  const b = new TextEncoder().encode(configuredToken);

  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}


// ============================================================
// FIREBASE PATCH — UPDATE SELECTED FIELDS ONLY
// ============================================================

async function firebasePatch(path, data, env) {
  const token = await getFirebaseAccessToken(env);

  const response = await fetch(
    FIREBASE_DB_URL + path + ".json",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Firebase PATCH failed: ${response.status} ${errorText}`
    );
  }

  return await response.json();
}
