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

// Step 1: Construct the Login URL
app.get(
  "/auth/instagram",
  passport.authenticate("facebook", {
    scope: [
      "email",
      "public_profile",
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
        // Assuming user selects the first page
        const page = pages[0];
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
  console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

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
