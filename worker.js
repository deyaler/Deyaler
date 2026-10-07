export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // CORS / OPTIONS
    // ==========================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }


    // ==========================================
    // HEALTH CHECK
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return json({
        success: true,
        service: "Deyaler Firebase Gateway",
        status: "online"
      });
    }


    // ==========================================
    // PERSON EXISTENCE CHECK
    //
    // /api/person/check?id=xxxxxx
    //
    // Upload page-এর জন্য
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/person/check"
    ) {
      try {

        const id = getValidId(
          url.searchParams.get("id")
        );

        if (!id) {
          return json({
            success: false,
            error: "Invalid Person ID"
          }, 400);
        }


        const data =
          await firebaseGet(
            env,
            "/people/" + encodeURIComponent(id)
          );


        return json({
          success: true,
          exists: data !== null
        });


      } catch (error) {

        return json({
          success: false,
          error: error.message
        }, 500);

      }
    }


    // ==========================================
    // PUBLIC PERSON API
    //
    // /api/person?id=Bipul
    //
    // IMPORTANT:
    // key/private data কখনো পাঠাবে না
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/person"
    ) {
      try {

        const id = getValidId(
          url.searchParams.get("id")
        );

        if (!id) {
          return json({
            success: false,
            error: "Person ID is required"
          }, 400);
        }


        const person =
          await firebaseGet(
            env,
            "/people/" + encodeURIComponent(id)
          );


        if (person === null) {
          return json({
            success: false,
            error: "Person not found"
          }, 404);
        }


        return json({
          success: true,
          person: publicPerson(person, id)
        });


      } catch (error) {

        return json({
          success: false,
          error: error.message
        }, 500);

      }
    }


    // ==========================================
    // FAMILY / PRIVATE ACCESS
    //
    // POST /api/person/access
    //
    // Body:
    // {
    //   "id": "xxxxxx",
    //   "key": "xxxxx"
    // }
    //
    // key কখনো response-এ ফেরত যাবে না
    // ==========================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/person/access"
    ) {
      try {

        const body =
          await request.json();


        const id =
          getValidId(body.id);


        const key =
          String(body.key || "").trim();


        if (!id) {
          return json({
            success: false,
            error: "Invalid Person ID"
          }, 400);
        }


        if (!key) {
          return json({
            success: false,
            error: "Access Key is required"
          }, 400);
        }


        const person =
          await firebaseGet(
            env,
            "/people/" + encodeURIComponent(id)
          );


        if (person === null) {
          return json({
            success: false,
            error: "Person not found"
          }, 404);
        }


        const storedKey =
          String(person.key || "").trim();


        if (
          !storedKey ||
          key !== storedKey
        ) {
          return json({
            success: false,
            error: "Invalid Access Key"
          }, 403);
        }


        return json({
          success: true,
          person: publicPerson(
            person,
            id,
            true
          )
        });


      } catch (error) {

        return json({
          success: false,
          error: error.message
        }, 500);

      }
    }


    // ==========================================
    // SEARCH API
    //
    // /api/search?q=Bipul
    //
    // সর্বোচ্চ 50 result
    // key কখনো পাঠাবে না
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/search"
    ) {
      try {

        const query =
          String(
            url.searchParams.get("q") || ""
          )
          .trim()
          .toLowerCase();


        if (!query) {
          return json({
            success: false,
            error: "Search query is required"
          }, 400);
        }


        if (query.length < 2) {
          return json({
            success: false,
            error:
              "Search query must contain at least 2 characters"
          }, 400);
        }


        if (query.length > 100) {
          return json({
            success: false,
            error: "Search query is too long"
          }, 400);
        }


        const people =
          await firebaseGet(
            env,
            "/people"
          );


        const results = [];


        if (
          people &&
          typeof people === "object"
        ) {

          for (
            const [id, person]
            of Object.entries(people)
          ) {

            if (
              !person ||
              typeof person !== "object"
            ) {
              continue;
            }


            const visibility =
              String(
                person.visibility || "private"
              )
              .trim()
              .toLowerCase();


            /*
              Search result-এ private/family
              profile-এর sensitive data দেওয়া হবে না।

              তবে নাম/ID দিয়ে result দেখা যাবে।
            */

            const searchableText = [
              id,
              person.name,
              person.father,
              person.village,
              person.upazilla,
              person.zilla
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();


            if (
              searchableText.includes(query)
            ) {

              results.push({
                id: person.id || id,
                name: person.name || "",
                father:
                  visibility === "public"
                    ? (person.father || "")
                    : "",
                village:
                  visibility === "public"
                    ? (person.village || "")
                    : "",
                upazilla:
                  visibility === "public"
                    ? (person.upazilla || "")
                    : "",
                zilla:
                  visibility === "public"
                    ? (person.zilla || "")
                    : "",
                avatar:
                  visibility === "public"
                    ? (person.avatar || "")
                    : "",
                gender:
                  person.gender || "",
                status:
                  person.status ?? true,
                visibility
              });

            }


            if (
              results.length >= 50
            ) {
              break;
            }

          }

        }


        return json({
          success: true,
          query,
          total: results.length,
          results
        });


      } catch (error) {

        return json({
          success: false,
          error: error.message
        }, 500);

      }
    }


    // ==========================================
    // HOMEPAGE API
    //
    // /api/homepage
    //
    // index.html-এর জন্য
    // পুরো database browser-এ পাঠাবে না
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/homepage"
    ) {
      try {

        const people =
          await firebaseGet(
            env,
            "/people"
          );


        const list = [];


        if (
          people &&
          typeof people === "object"
        ) {

          for (
            const [id, person]
            of Object.entries(people)
          ) {

            if (
              !person ||
              typeof person !== "object"
            ) {
              continue;
            }


            const visibility =
              String(
                person.visibility || "private"
              )
              .trim()
              .toLowerCase();


            /*
              Homepage-এ শুধুমাত্র public
              record ব্যবহার করা হবে।
            */

            if (
              visibility !== "public"
            ) {
              continue;
            }


            list.push({
              id: person.id || id,
              name: person.name || "",
              father: person.father || "",
              village: person.village || "",
              upazilla: person.upazilla || "",
              zilla: person.zilla || "",
              avatar: person.avatar || "",
              gender: person.gender || "",
              status: person.status ?? true,
              dateOfBirth:
                person.dateOfBirth || ""
            });

          }

        }


        const total =
          list.length;


        const alive =
          list.filter(
            person => isAlive(person)
          ).length;


        const deceased =
          list.filter(
            person => !isAlive(person)
          ).length;


        // ======================================
        // TODAY
        // ======================================

        const today =
          getDhakaDate();


        // ======================================
        // BIRTHDAYS
        // ======================================

        const birthdays =
          list
            .filter(person => {

              if (!isAlive(person)) {
                return false;
              }

              return isBirthdayToday(
                person.dateOfBirth,
                today
              );

            })
            .slice(0, 6)
            .map(person => ({
              id: person.id,
              name: person.name
            }));


        // ======================================
        // FEATURED MEMORY
        // ======================================

        const deceasedPeople =
          list.filter(
            person =>
              !isAlive(person) &&
              person.id
          );


        let featured = null;


        if (
          deceasedPeople.length
        ) {

          const index =
            deterministicIndex(
              today,
              deceasedPeople.length
            );


          const person =
            deceasedPeople[index];


          featured = {
            id: person.id,
            name: person.name || "",
            father: person.father || "",
            village: person.village || "",
            upazilla: person.upazilla || "",
            zilla: person.zilla || ""
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


      } catch (error) {

        return json({
          success: false,
          error: error.message
        }, 500);

      }
    }


    // ==========================================
    // FAMILY TREE API
    //
    // /api/tree?id=Bipul
    //
    // এখন public people/relationships-এর
    // প্রয়োজনীয় অংশ server-side তৈরি করবে।
    //
    // সরাসরি /people বা /relationships
    // browser-এ expose করবে না।
    // ==========================================

    if (
      request.method === "GET" &&
      url.pathname === "/api/tree"
    ) {
      try {

        const id =
          getValidId(
            url.searchParams.get("id")
          );


        if (!id) {
          return json({
            success: false,
            error: "Person ID is required"
          }, 400);
        }


        const [
          people,
          relationships
        ] = await Promise.all([

          firebaseGet(
            env,
            "/people"
          ),

          firebaseGet(
            env,
            "/relationships"
          )

        ]);


        if (
          !people ||
          !people[id]
        ) {
          return json({
            success: false,
            error: "Person not found"
          }, 404);
        }


        /*
          শুধুমাত্র public people
          tree-এর browser response-এ যাবে।

          Private/family data সরাসরি
          leak হবে না।
        */

        const safePeople = {};


        for (
          const [personId, person]
          of Object.entries(
            people || {}
          )
        ) {

          if (
            !person ||
            typeof person !== "object"
          ) {
            continue;
          }


          const visibility =
            String(
              person.visibility || "private"
            )
            .trim()
            .toLowerCase();


          if (
            visibility !== "public"
          ) {
            continue;
          }


          safePeople[personId] =
            publicPerson(
              person,
              personId
            );

        }


        /*
          Main person public না হলে
          tree দেখানো হবে না।
        */

        if (!safePeople[id]) {
          return json({
            success: false,
            error:
              "This person's family tree is not publicly available"
          }, 403);
        }


        const safeRelationships = {};


        if (
          relationships &&
          typeof relationships === "object"
        ) {

          for (
            const [relId, rel]
            of Object.entries(
              relationships
            )
          ) {

            if (
              !rel ||
              typeof rel !== "object"
            ) {
              continue;
            }


            const from =
              String(
                rel.from || ""
              ).trim();


            const to =
              String(
                rel.to || ""
              ).trim();


            if (
              safePeople[from] &&
              safePeople[to]
            ) {

              safeRelationships[relId] = {
                from,
                to,
                type:
                  String(
                    rel.type || ""
                  ).trim()
              };

            }

          }

        }


        return json({
          success: true,
          mainId: id,
          people: safePeople,
          relationships:
            safeRelationships
        });


      } catch (error) {

        return json({
          success: false,
          error: error.message
        }, 500);

      }
    }


    // ==========================================
    // REMOVE /api/firebase-test
    //
    // Production-এ database count
    // প্রকাশ করার দরকার নেই।
    // ==========================================


    // ==========================================
    // STATIC WEBSITE
    // ==========================================

    return env.ASSETS.fetch(request);
  }
};


// ==================================================
// FIREBASE GET
// ==================================================

async function firebaseGet(
  env,
  path
) {

  const accessToken =
    await getFirebaseAccessToken(env);


  const firebaseUrl =
    "https://jannat-projects-default-rtdb.firebaseio.com" +
    path +
    ".json";


  const response =
    await fetch(
      firebaseUrl,
      {
        method: "GET",

        headers: {
          Authorization:
            "Bearer " +
            accessToken
        }
      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    throw new Error(
      "Firebase request failed: " +
      JSON.stringify(data)
    );

  }


  return data;
}


// ==================================================
// PUBLIC PERSON FILTER
// ==================================================

function publicPerson(
  person,
  id,
  authorized = false
) {

  const result = {

    id:
      person.id || id,

    name:
      person.name || "",

    father:
      person.father || "",

    village:
      person.village || "",

    upazilla:
      person.upazilla || "",

    zilla:
      person.zilla || "",

    dateOfBirth:
      person.dateOfBirth || "",

    deathDate:
      person.deathDate || "",

    gender:
      person.gender || "",

    status:
      person.status ?? true,

    avatar:
      person.avatar || "",

    storageServer:
      person.storageServer || "",

    joinDate:
      person.joinDate || "",

    todayDate:
      person.todayDate || "",

    reviewStatus:
      person.reviewStatus || "",

    visibility:
      person.visibility || "private"

  };


  /*
    Access key কখনো ফেরত দেওয়া হবে না।
  */

  return result;
}


// ==================================================
// PERSON ID VALIDATION
// ==================================================

function getValidId(value) {

  const id =
    String(
      value || ""
    ).trim();


  if (
    !/^[A-Za-z0-9_-]{1,100}$/.test(id)
  ) {
    return null;
  }


  return id;
}


// ==================================================
// ALIVE
// ==================================================

function isAlive(person) {

  if (
    person.status === false ||
    String(
      person.status
    ).toLowerCase() === "false"
  ) {
    return false;
  }


  return true;
}


// ==================================================
// DHAKA DATE
// YYYY-MM-DD
// ==================================================

function getDhakaDate() {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Dhaka",

        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(
      new Date()
    );


  const values = {};


  for (
    const part of parts
  ) {
    values[part.type] =
      part.value;
  }


  return (
    values.year +
    "-" +
    values.month +
    "-" +
    values.day
  );
}


// ==================================================
// BIRTHDAY
// ==================================================

function isBirthdayToday(
  dateOfBirth,
  today
) {

  if (!dateOfBirth) {
    return false;
  }


  const value =
    String(
      dateOfBirth
    ).trim();


  const parts =
    value.split("-");


  if (
    parts.length !== 3
  ) {
    return false;
  }


  const todayParts =
    today.split("-");


  return (
    parts[1] === todayParts[1] &&
    parts[2] === todayParts[2]
  );
}


// ==================================================
// DETERMINISTIC FEATURED MEMORY
// ==================================================

function deterministicIndex(
  dateKey,
  length
) {

  if (!length) {
    return 0;
  }


  let hash = 0;


  for (
    let i = 0;
    i < dateKey.length;
    i++
  ) {

    hash =
      (
        hash * 31 +
        dateKey.charCodeAt(i)
      ) >>> 0;

  }


  return hash % length;
}


// ==================================================
// FIREBASE ACCESS TOKEN
// ==================================================

async function getFirebaseAccessToken(
  env
) {

  if (
    !env.FIREBASE_CLIENT_EMAIL
  ) {
    throw new Error(
      "FIREBASE_CLIENT_EMAIL পাওয়া যায়নি"
    );
  }


  if (
    !env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY পাওয়া যায়নি"
    );
  }


  const privateKey =
    env.FIREBASE_PRIVATE_KEY
      .replace(/\\n/g, "\n");


  const pemContents =
    privateKey
      .replace(
        "-----BEGIN PRIVATE KEY-----",
        ""
      )
      .replace(
        "-----END PRIVATE KEY-----",
        ""
      )
      .replace(/\s/g, "");


  const binaryDer =
    Uint8Array.from(
      atob(pemContents),
      c => c.charCodeAt(0)
    );


  const cryptoKey =
    await crypto.subtle.importKey(
      "pkcs8",
      binaryDer.buffer,
      {
        name:
          "RSASSA-PKCS1-v1_5",

        hash:
          "SHA-256"
      },
      false,
      ["sign"]
    );


  const now =
    Math.floor(
      Date.now() / 1000
    );


  const header = {
    alg: "RS256",
    typ: "JWT"
  };


  const claim = {

    iss:
      env.FIREBASE_CLIENT_EMAIL,

    scope:
      "https://www.googleapis.com/auth/firebase.database " +
      "https://www.googleapis.com/auth/userinfo.email",

    aud:
      "https://oauth2.googleapis.com/token",

    iat:
      now,

    exp:
      now + 3600

  };


  const encode =
    obj =>
      btoa(
        JSON.stringify(obj)
      )
      .replace(
        /\+/g,
        "-"
      )
      .replace(
        /\//g,
        "_"
      )
      .replace(
        /=+$/,
        ""
      );


  const unsignedToken =
    encode(header) +
    "." +
    encode(claim);


  const signature =
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(
        unsignedToken
      )
    );


  const signatureBase64 =
    btoa(
      String.fromCharCode(
        ...new Uint8Array(
          signature
        )
      )
    )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/,
      ""
    );


  const jwt =
    unsignedToken +
    "." +
    signatureBase64;


  const tokenResponse =
    await fetch(
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


  const tokenData =
    await tokenResponse.json();


  if (
    !tokenResponse.ok
  ) {

    throw new Error(
      "Google OAuth failed: " +
      JSON.stringify(
        tokenData
      )
    );

  }


  return tokenData.access_token;
}


// ==================================================
// JSON RESPONSE
// ==================================================

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store",

        ...corsHeaders()
      }
    }
  );
}


// ==================================================
// CORS
// ==================================================

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"

  };

}
