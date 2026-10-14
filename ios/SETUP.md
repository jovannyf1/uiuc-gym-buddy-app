# Run the iPhone app

The native app is an Xcode project at `ios/IlliniWorkoutBuddy.xcodeproj`. It uses the same Express API and account data as the website. It targets iOS 17 or newer and needs Xcode 16 or newer to build.

1. Open the project in Xcode. Select the **IlliniWorkoutBuddy** target, choose your Apple development team under **Signing & Capabilities**, and change the placeholder bundle identifier to one that your team can sign.
2. Select an iPhone Simulator or your connected iPhone, then press **Run**. For a physical iPhone, enable Developer Mode if Xcode asks.
3. Start the API on your Mac with `npm ci`, `npm --prefix client ci`, `npm run build`, and `npm start` from the repository root. The Simulator can use the default `http://localhost:8787` server address.
4. For a physical iPhone, put the phone and Mac on the same Wi-Fi network. In the app’s **Server** settings, use `http://<your-mac-local-name>.local:8787` (for example, `http://my-mac.local:8787`), then allow local network access. Find the name with `scutil --get LocalHostName`. A hosted server should use HTTPS.

This local setup works only while the Mac and API are running. The production service will need HTTPS hosting and a stable URL. Illinois NetID sign-in appears only after the server is configured for campus OIDC; until then, the local pilot account form is available only when the server enables it. The app never stores an Illinois password. Schedule screenshots require the server’s `OPENAI_API_KEY`; the key belongs on the server, never in this iPhone project.

The app stores a 30-day, HTTP-only session cookie in iOS’s shared cookie store. Signing out invalidates it on the server. The server address is saved in device preferences; no password or schedule screenshot is saved by the iPhone app.
