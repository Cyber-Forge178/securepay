# SecurePay

SecurePay is a PWA prototype for demonstrating safer digital-payment flows, including device binding, cryptographic authorization, QR intent protection, replay protection, inheritance/new-device recovery, continuous identity monitoring, and suspicious repeated-payment detection.

## Project structure

```text
SecurePay/
├── index.html
├── manifest.json
├── sw.js
├── icon.svg
├── css/
│   └── style.css
├── js/
│   └── app.js
└── README.md
```

## Run locally

Use a local HTTPS/localhost server (for example VS Code Live Server) because camera and browser security features require a secure context.

## GitHub Pages

Upload the contents of this folder to a GitHub repository and enable GitHub Pages. The app uses relative paths so the PWA assets work from a repository subpath.

## Important

This is a hackathon/demo prototype. Production payments should move authorization, transaction validation, replay prevention, suspicious-activity decisions, and balance changes to a trusted backend with appropriate Firebase Authentication/Firestore Security Rules or Cloud Functions.
