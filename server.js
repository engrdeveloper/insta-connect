// server.js
const express = require("express");
const bodyParser = require("body-parser");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const axios = require("axios");
const session = require("express-session");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(
  session({
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);

// Following permissions are required for configuring webhook for messages: https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/
// - instagram_basic
// - instagram_manage_messages
// - pages_manage_metadata

// instagram_basic depends:https://developers.facebook.com/docs/permissions/#permission-dependencies
//  - pages_read_engagement
//  - pages_show_list

// business_management is required as instagram is conencted to business page
// email and public_profile are required for login

// Following permissions are required for the messging: https://developers.facebook.com/docs/messenger-platform/instagram/
// - instagram_basic
// - instagram_manage_messages
// - pages_manage_metadata
// - pages_show_list
// - business_management

// Configure Passport.js
passport.use(
  new FacebookStrategy(
    {
      clientID: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      callbackURL: REDIRECT_URI,
      profileFields: ["id", "displayName", "photos", "email"],
      enableProof: true,
    },
    function (accessToken, refreshToken, profile, done) {
      // Save tokens and profile information
      const longLivedToken = accessToken;
      return done(null, { profile, longLivedToken });
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());

// Construct the Login URL
app.get(
  "/auth/instagram",
  passport.authenticate("facebook", {
    scope: [
      "email",
      "public_profile",
      "pages_messaging",
      "business_management",
      "instagram_basic",
      "instagram_manage_messages",
      "pages_manage_metadata",
      "pages_show_list",
      "pages_read_engagement",
    ],
  })
);

// Step 3: Capture User access token
app.get(
  "/instagram/callback",
  passport.authenticate("facebook", { failureRedirect: "/" }),
  (req, res) => {
    const { longLivedToken } = req.user;

    // Use the long-lived token to get the user's page and Instagram business account
    axios
      .get(
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longLivedToken}`
      )
      .then((response) => {
        const pages = response.data.data;

        // For each page subscribe webhook
        for (const page of pages) {
          webhookSubscribe(page.access_token, page.id);
        }
        res.json({
          userToken: longLivedToken,
          pages,
        });
      })
      .catch((error) => {
        console.error("Error getting user pages:", error);
        res.status(500).send("Error getting user pages");
      });
  }
);

app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log(`\u{1F7EA} Received webhook:`);
  console.dir(body, { depth: null });

  // Process incoming message event
  if (body.object && body.entry) {
    body.entry.forEach((entry) => {
      sendReply(entry.messaging[0].sender.id, PAGE_ACCESS_TOKEN);
    });
  }
  res.status(200).end();
});

/**
 * Sends a reply message to the sender.
 * @param {string} senderId - The ID of the sender.
 * @param {string} pageAccessToken - The access token for the page.
 */
const sendReply = async (senderId, pageAccessToken) => {
  try {
    // Send a message to the sender using the Facebook Graph API
    await axios.post(`https://graph.facebook.com/v20.0/me/messages`, {
      recipient: {
        id: senderId,
      },
      message: {
        text: "Thanks for your Message",
      },
      access_token: pageAccessToken,
    });
    console.log("Reply sent successfully");
  } catch (error) {
    console.error("Error sending reply:", error.response.data);
  }
};

/**
 * Subscribes the webhook to the specified page.
 * @param {string} pageAccessToken - The access token for the page.
 * @param {string} pageId - The ID of the page.
 */
const webhookSubscribe = async (pageAccessToken, pageId) => {
  try {
    // Subscribe the webhook to the page for the 'messages' field.
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`,
      {
        subscribed_fields: ["messages"], // The field to subscribe to.
        access_token: pageAccessToken, // The access token for the page.
      }
    );
    console.log("Webhook subscribed successfully:", response.data);
  } catch (error) {
    // Log the error if there was an issue subscribing to the webhook.
    console.error("Error subscribing to webhook:", error.response.data);
  }
};

// accepts GET requests at the /webhook endpoint. You need this URL to setup webhook initially.
// info on verification request payload: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // check the mode and token sent are correct
  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    // respond with 200 OK and challenge token from the request
    res.status(200).send(challenge);
    console.log("Webhook verified successfully!");
  } else {
    // respond with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
