import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where,
  addDoc, updateDoc, increment, serverTimestamp, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

/*
  ============================================================
  FIREBASE CONFIGURATION
  1. Create a Firebase project.
  2. Register a Web App.
  3. Enable Authentication > Email/Password.
  4. Create Firestore Database.
  5. Create Storage.
  6. Paste the Web App config below.
  ============================================================
*/
const firebaseConfig = {
  apiKey: "AIzaSyD8eKbY5LSUugckmcMupvWiE25zIaD4LpA",
  authDomain: "pay-83fbf.firebaseapp.com",
  projectId: "pay-83fbf",
  storageBucket: "pay-83fbf.firebasestorage.app",
  messagingSenderId: "585866384920",
  appId: "1:585866384920:web:45840cc52911e07ad5d56d",
  measurementId: "G-FSBP52TGY8"
};

let firebaseReady = false;
let app, auth, db;
let currentProfile = null;
let selected = null;
let intent = null;
let stream = null;
let verifyStream = null;
let inheritanceStream = null;
let deviceKeyPair = null;
let inheritanceTimer = null;
let inheritanceSeconds = 60;
let inheritanceFacePassed = false;
let inheritanceUser = null;
let qrIntent = null;
let uploadedQrData = null;
let registrationFaceDescriptor = null;
let registrationLocation = null;
let faceModelsLoaded = false;
let faceModelsLoading = null;
let faceGuardStream = null;
let faceGuardTimer = null;
let faceGuardCheckCount = 0;
let faceGuardRunning = false;
let faceGuardLocked = false;
let faceGuardMismatchCount = 0;
let faceGuardNoFaceCount = 0;
let faceGuardMatchCount = 0;
let faceGuardStartedAt = 0;
let faceGuardRecoveryMode = false;
let faceGuardRecoveryMismatchCount = 0;
let faceGuardPasskeyCount = 0;
let faceGuardBusy = false;
let faceGuardLastDistance = null;
let paymentInProgress = false;
const FACE_MODEL_URLS = [
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights",
  "https://unpkg.com/face-api.js@0.22.2/weights"
];

function setFaceStatus(text, id="inheritFaceStatus") {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  const reg = document.getElementById("faceStatus");
  const regScreen = document.getElementById("register");
  if (reg && regScreen && regScreen.classList.contains("active")) reg.textContent = text;
}

async function loadFaceModels() {
  if (faceModelsLoaded) return true;
  if (faceModelsLoading) return faceModelsLoading;
  if (typeof faceapi === "undefined") throw new Error("Face recognition library did not load. Check your internet connection and reload the page.");

  faceModelsLoading = (async () => {
    let lastError = null;
    for (const base of FACE_MODEL_URLS) {
      try {
        setFaceStatus("Loading face recognition models…");
        const loadOne = async () => {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(base),
            faceapi.nets.faceLandmark68Net.loadFromUri(base),
            faceapi.nets.faceRecognitionNet.loadFromUri(base)
          ]);
        };
        await Promise.race([
          loadOne(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Model download timed out after 20 seconds.")), 20000))
        ]);
        faceModelsLoaded = true;
        setFaceStatus("Face recognition ready. Look at the camera and tap Verify Face.");
        return true;
      } catch (e) {
        lastError = e;
        console.warn("Face model source failed:", base, e);
      }
    }
    faceModelsLoading = null;
    throw new Error("Could not load the face-recognition models. Open this HTML through localhost/HTTPS and make sure internet access is enabled.");
  })();
  return faceModelsLoading;
}

function waitForVideoReady(video, timeout=8000) {
  return new Promise((resolve, reject) => {
    if (video && video.readyState >= 2 && video.videoWidth > 0) return resolve();
    const start = Date.now();
    const timer = setInterval(() => {
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        clearInterval(timer); resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer); reject(new Error("Camera video is not ready yet. Keep your face visible and try again."));
      }
    }, 100);
  });
}

async function getFaceDescriptor(videoOrImage) {
  await loadFaceModels();
  if (videoOrImage instanceof HTMLVideoElement) await waitForVideoReady(videoOrImage);
  const result = await faceapi.detectSingleFace(videoOrImage, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.45}))
    .withFaceLandmarks().withFaceDescriptor();
  if (!result) throw new Error("No clear face detected. Face the camera directly, improve lighting, and keep only one face in view.");
  return Array.from(result.descriptor);
}

function faceDistance(a,b) {
  if (!Array.isArray(a) || a.length !== b.length) return Infinity;
  return Math.sqrt(a.reduce((sum,v,i)=>sum + Math.pow(v-b[i],2),0));
}

const KEY_DB = "securepay_device_keys";
const KEY_STORE = "keys";

function canonicalIntent(i) {
  return [i.id,i.fromUid,i.toUid,i.amount,i.nonce,i.sessionId,i.deviceId,i.expiresAt].join("|");
}

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return b64(hash);
}

function openKeyDB() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(KEY_DB,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(KEY_STORE);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function savePrivateKey(uid,key) {
  const d=await openKeyDB();
  return new Promise((resolve,reject)=>{
    const tx=d.transaction(KEY_STORE,"readwrite");
    tx.objectStore(KEY_STORE).put(key,uid);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}
async function getPrivateKey(uid) {
  const d=await openKeyDB();
  return new Promise((resolve,reject)=>{
    const tx=d.transaction(KEY_STORE,"readonly");
    const req=tx.objectStore(KEY_STORE).get(uid);
    req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
  });
}
async function ensureDeviceKey(uid) {
  let privateKey=await getPrivateKey(uid);
  if(privateKey){
    // Private key is non-exportable and remains in IndexedDB.
    deviceKeyPair={privateKey};
    return privateKey;
  }
  const kp=await crypto.subtle.generateKey(
    {name:"ECDSA",namedCurve:"P-256"}, true, ["sign","verify"]
  );
  const publicJwk=await crypto.subtle.exportKey("jwk",kp.publicKey);
  await savePrivateKey(uid,kp.privateKey);
  deviceKeyPair=kp;
  await setDoc(doc(db,"devices",uid),{
    uid,
    publicKeyJwk:publicJwk,
    algorithm:"ECDSA-P256-SHA256",
    registeredAt:serverTimestamp()
  });
  return kp.privateKey;
}
async function signIntent(i) {
  const privateKey=await ensureDeviceKey(i.fromUid);
  const data=new TextEncoder().encode(canonicalIntent(i));
  const sig=await crypto.subtle.sign(
    {name:"ECDSA",hash:"SHA-256"},privateKey,data
  );
  return b64(sig);
}


try {
  firebaseReady = !Object.values(firebaseConfig).some(v => String(v).includes("PASTE_YOUR"));
  if (firebaseReady) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (e) {
  console.error(e);
  firebaseReady = false;
}

const $ = id => document.getElementById(id);
const money = n => "₹" + Number(n || 0).toLocaleString("en-IN");

function show(id) {
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
  $(id).classList.add("active");
  if (id === "send") searchUsers();
  if (id === "receive" && currentProfile) {
    $("myUpi").textContent = currentProfile.upi;
    generateMyQR();
  }
  if (id === "home") { renderHome(); setTimeout(startFaceGuard, 50); }
  if (id === "history") renderHistory();
  if (id === "security") renderKeyStatus();
}

function setStatus(text, ok=false) {
  const el = $("firebaseStatus");
  if (el) {
    el.textContent = text;
    el.style.color = ok ? "#15803d" : "#b45309";
  }
}

async function startFaceGuard() {
  if (!currentProfile?.faceDescriptor || faceGuardRunning) return;
  if (!navigator.mediaDevices?.getUserMedia) return;

  try {
    const video = $("guardVideo");
    if (!faceGuardStream) {
      faceGuardStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      video.srcObject = faceGuardStream;
      await video.play();
    }

    await loadFaceModels();
    faceGuardRunning = true;
    faceGuardMismatchCount = 0;
    faceGuardNoFaceCount = 0;
    faceGuardMatchCount = 0;
    faceGuardRecoveryMode = false;
    faceGuardRecoveryMismatchCount = 0;
    faceGuardPasskeyCount = 0;
    faceGuardCheckCount = 0;
    faceGuardStartedAt = Date.now();
    faceGuardLocked = false;

    $("faceGuardOverlay")?.classList.add("hidden");
    const guardStatus = $("faceGuardStatus");
    if (guardStatus) guardStatus.textContent = "🟢 LIVE — Continuous Identity Guard is active.";

    // IMPORTANT: use a real repeating interval. The previous implementation
    // chained setTimeout calls, which could stop appearing continuous when a
    // browser delayed/cancelled an asynchronous callback.
    clearInterval(faceGuardTimer);
    faceGuardTimer = setInterval(() => {
      runFaceGuardCheck();
    }, 1500);

    // First check after the camera/model warm-up.
    setTimeout(() => runFaceGuardCheck(), 1200);
  } catch (e) {
    console.warn("Continuous face guard unavailable:", e);
    faceGuardRunning = false;
    const status = $("faceGuardStatus");
    if (status) status.textContent = "Camera guard unavailable. Enable camera permission for continuous protection.";
  }
}

async function runFaceGuardCheck() {
  if (!faceGuardRunning || faceGuardLocked || !currentProfile?.faceDescriptor) return;

  const video = $("guardVideo");
  if (!video || video.readyState < 2 || !video.videoWidth) return;
  if (faceGuardBusy) return;

  // Let the camera settle before the first identity decision.
  if (Date.now() - faceGuardStartedAt < 5000) return;

  faceGuardBusy = true;
  try {
    const detected = await faceapi.detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 })
    ).withFaceLandmarks().withFaceDescriptor();

    faceGuardCheckCount++;

    const status = $("faceGuardStatus");
    const counter = $("faceGuardCheckCounter");
    const homeStatus = $("faceGuardHomeStatus");
    const homeCounter = $("faceGuardCheckCounterHome");
    const mismatch = $("faceGuardMismatchStatus");

    if (counter) counter.textContent = `Live checks: ${faceGuardCheckCount}`;
    if (homeCounter) homeCounter.textContent = `Live checks: ${faceGuardCheckCount}`;

    if (!detected) {
      // No visible face is not evidence of a different person.
      faceGuardNoFaceCount++;
      if (status) status.textContent = `🟡 LIVE — no face visible (check ${faceGuardCheckCount})`;
      if (homeStatus) homeStatus.textContent = `🟡 LIVE — no face visible (check ${faceGuardCheckCount})`;
      return;
    }

    faceGuardNoFaceCount = 0;
    const distance = faceDistance(Array.from(detected.descriptor), currentProfile.faceDescriptor);
    faceGuardLastDistance = distance;

    if (distance <= 0.55) {
      faceGuardMatchCount++;
      faceGuardMismatchCount = 0;
      faceGuardRecoveryMismatchCount = 0;
      if (status) status.textContent = `🟢 LIVE — Face MATCHED (check ${faceGuardCheckCount})`;
      if (homeStatus) homeStatus.textContent = `🟢 LIVE — Face MATCHED (check ${faceGuardCheckCount})`;
      if (mismatch) mismatch.textContent = faceGuardRecoveryMode ? "Identity verified — recovery monitoring active" : "Identity verified";
    } else {
      faceGuardMatchCount = 0;
      faceGuardMismatchCount++;
      if (faceGuardRecoveryMode) {
        // After the user has already proven the secret 3 times, the next
        // mismatch is treated as persistent suspicious activity and logs out.
        if (faceGuardPasskeyCount >= 3) {
          if (status) status.textContent = "🔴 SUSPICIOUS ACTIVITY — repeated face mismatch";
          if (homeStatus) homeStatus.textContent = "🔴 SUSPICIOUS ACTIVITY — repeated face mismatch";
          if (mismatch) mismatch.textContent = "Suspicious activity — logging out";
          logout();
          return;
        }

        faceGuardRecoveryMismatchCount++;
        const msg = `🔴 FACE MISMATCH — passkey required (${faceGuardPasskeyCount + 1}/3)`;
        if (status) status.textContent = msg;
        if (homeStatus) homeStatus.textContent = msg;
        if (mismatch) mismatch.textContent = `Passkey required — security event ${faceGuardPasskeyCount + 1}/3`;
        lockForFaceMismatch();
      } else {
        const msg = `🔴 FACE MISMATCH — different face detected (${faceGuardMismatchCount}/3)`;
        if (status) status.textContent = msg;
        if (homeStatus) homeStatus.textContent = msg;
        if (mismatch) mismatch.textContent = `Mismatch ${faceGuardMismatchCount}/3`;
        if (faceGuardMismatchCount >= 3) lockForFaceMismatch();
      }
    }
  } catch (e) {
    console.debug("Face guard check skipped:", e);
  } finally {
    faceGuardBusy = false;
  }
}

function lockForFaceMismatch() {
  if (faceGuardLocked) return;
  faceGuardLocked = true;
  faceGuardMismatchCount = 0;
  clearInterval(faceGuardTimer);
  faceGuardTimer = null;

  // Invalidate any in-progress payment intent so the detected new user cannot
  // continue an already-prepared transaction.
  intent = null;
  qrIntent = null;
  selected = null;

  $("faceGuardSecret").value = "";
  $("faceGuardStatus").textContent = "Payment operations are locked until identity is verified.";
  $("faceGuardMessage").textContent = "A different face was detected. SecurePay has locked payment functions.";
  $("faceGuardOverlay").classList.remove("hidden");
}

async function unlockFaceGuard() {
  if (!currentProfile || !faceGuardLocked) return;
  const entered = $("faceGuardSecret").value;
  if (!entered) {
    $("faceGuardStatus").textContent = "Enter your secret message.";
    return;
  }

  const hash = await sha256(entered);
  if (hash !== currentProfile.secretHash) {
    $("faceGuardStatus").textContent = "✕ Incorrect secret. SecurePay remains locked.";
    $("faceGuardSecret").value = "";
    return;
  }

  faceGuardPasskeyCount++;
  faceGuardLocked = false;
  faceGuardMismatchCount = 0;
  faceGuardNoFaceCount = 0;
  faceGuardMatchCount = 0;
  faceGuardRecoveryMode = true;
  faceGuardRecoveryMismatchCount = 0;
  faceGuardCheckCount = 0;
  faceGuardStartedAt = Date.now();
  $("faceGuardSecret").value = "";
  $("faceGuardStatus").textContent = `✓ Passkey accepted. Security events: ${faceGuardPasskeyCount}/3. Continuous monitoring restored.`;
  $("faceGuardOverlay").classList.add("hidden");

  // lockForFaceMismatch() stops the interval, so explicitly restart it here.
  clearInterval(faceGuardTimer);
  faceGuardTimer = setInterval(runFaceGuardCheck, 1500);
  setTimeout(runFaceGuardCheck, 1200);
}

function stopFaceGuard() {
  clearInterval(faceGuardTimer);
  faceGuardTimer = null;
  faceGuardRunning = false;
  faceGuardLocked = false;
  faceGuardMismatchCount = 0;
  faceGuardNoFaceCount = 0;
  faceGuardMatchCount = 0;
  faceGuardCheckCount = 0;
  faceGuardStartedAt = 0;
  faceGuardRecoveryMode = false;
  faceGuardRecoveryMismatchCount = 0;
  faceGuardPasskeyCount = 0;
  faceGuardBusy = false;
  if (faceGuardStream) {
    faceGuardStream.getTracks().forEach(t => t.stop());
    faceGuardStream = null;
  }
  const video = $("guardVideo");
  if (video) video.srcObject = null;
  $("faceGuardOverlay")?.classList.add("hidden");
}

async function register() {
  if (!firebaseReady) {
    alert("Firebase is not connected. Check your Firebase configuration and internet connection.");
    return;
  }

  const name = $("rName").value.trim();
  const phone = $("rPhone").value.trim();
  const phoneDigits = phone.replace(/\D/g, "");
  const upi = $("rUpi").value.trim().toLowerCase();
  const location = $("rLocation").value.trim();
  const password = $("rPassword").value;
  const secret = $("rSecret").value;

  if (!name || !phoneDigits || !upi || !password || !secret) {
    alert("Please complete all registration fields.");
    return;
  }
  if (password.length < 6) {
    alert("Use a password of at least 6 characters.");
    return;
  }

  // IMPORTANT: verify/capture the face BEFORE creating the Firebase Auth account.
  // Otherwise a failed registration can leave an Auth account behind and the
  // next attempt produces auth/email-already-in-use.
  if (!registrationFaceDescriptor) {
    $("faceStatus").textContent = "✕ Face capture is required before registration.";
    alert("First open the camera and tap Capture Face. Registration will not continue without a recognized face.");
    return;
  }

  const authEmail = `${phoneDigits}@securepay.demo`;

  try {
    // Check UPI before touching Firebase Authentication.
    const existingUpi = await getDocs(
      query(collection(db, "users"), where("upi", "==", upi), limit(1))
    );
    if (!existingUpi.empty) {
      alert("That UPI ID is already registered. Choose another UPI ID.");
      return;
    }

    let uid;
    let reusedAuthAccount = false;

    try {
      const credential = await createUserWithEmailAndPassword(auth, authEmail, password);
      uid = credential.user.uid;
    } catch (authError) {
      // If the user deleted Firestore data but not Firebase Authentication,
      // the Auth account still exists. Reuse it only when the supplied password
      // proves access to that account.
      if (authError?.code === "auth/email-already-in-use") {
        try {
          const credential = await signInWithEmailAndPassword(auth, authEmail, password);
          uid = credential.user.uid;
          reusedAuthAccount = true;
        } catch (loginError) {
          throw new Error(
            "This phone number already has a Firebase Authentication account. " +
            "If you deleted only Firestore data, use the same password, or delete the old user from Firebase Console > Authentication > Users."
          );
        }
      } else {
        throw authError;
      }
    }

    const secretHash = await sha256(secret);
    const profile = {
      uid,
      name,
      phone,
      upi,
      location: location || "Location not provided",
      locationLat: registrationLocation?.lat ?? null,
      locationLng: registrationLocation?.lng ?? null,
      locationAccuracy: registrationLocation?.accuracy ?? null,
      locationPermission: registrationLocation ? "granted" : "not-granted",
      deviceId: crypto.randomUUID(),
      qrId: "qr_" + crypto.randomUUID(),
      secretHash,
      faceEnrollment: "face-api-descriptor",
      faceDescriptor: registrationFaceDescriptor,
      balance: 10000,
      createdAt: serverTimestamp()
    };

    // Recreate the profile even if its old Firestore document was deleted.
    await setDoc(doc(db, "users", uid), profile);
    currentProfile = { ...profile, balance: 10000 };

    // Fresh device key for this browser/device.
    await ensureDeviceKey(uid);

    setStatus(reusedAuthAccount ? "Existing Auth account restored ✓" : "Firebase connected ✓", true);
    $("faceStatus").textContent = "✓ Face enrolled successfully. Registration complete.";
    stopRegistrationCamera();
    show("home");
  } catch (e) {
    console.error(e);
    alert("Registration failed: " + (e?.message || e));
  }
}

async function login(forceInheritance = false) {
  if (!firebaseReady) {
    alert("Firebase is not connected yet. Paste your Firebase Web App config into this file first.");
    return;
  }
  const phone = $("loginPhone").value.trim().replace(/\D/g,"");
  const upiInput = $("loginUpi").value.trim().toLowerCase();
  const password = $("loginPassword").value;
  if (!upiInput || !phone || !password) { alert("Enter UPI ID, phone and password."); return; }

  try {
    const credential = await signInWithEmailAndPassword(
      auth, `${phone}@securepay.demo`, password
    );
    const snap = await getDoc(doc(db, "users", credential.user.uid));
    if (!snap.exists()) throw new Error("Profile not found.");
    currentProfile = snap.data();
    if ((currentProfile.upi || "").toLowerCase() !== upiInput) {
      await signOut(auth);
      currentProfile = null;
      throw new Error("UPI ID does not match this account.");
    }

    if (forceInheritance) {
      await beginInheritance(currentProfile);
      return;
    }

    await checkDeviceAndContinue();

  } catch (e) {
    alert("Login failed: " + e.message);
  }
}

async function loadCurrentProfile(user) {
  if (!user) {
    currentProfile = null;
    return;
  }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) currentProfile = snap.data();
  if (document.querySelector("#home.active")) renderHome();
}


async function checkDeviceAndContinue() {
  if (!currentProfile) return;
  try {
    const deviceSnap = await getDoc(doc(db,"devices",currentProfile.uid));
    if (!deviceSnap.exists()) {
      // First device after migration/old account: create its key and require verification.
      await ensureDeviceKey(currentProfile.uid);
      show("deviceVerify");
      return;
    }
    const privateKey = await getPrivateKey(currentProfile.uid);
    if (!privateKey) {
      // No local key means this is a new/replacement device.
      await beginInheritance(currentProfile);
      return;
    }
    await ensureDeviceKey(currentProfile.uid);
    // Normal login on the already-registered device goes straight to Home.
    show("home");
  } catch(e) {
    console.error(e);
    show("deviceVerify");
  }
}

async function startVerifyCamera() {
  try {
    $("deviceFaceStatus").textContent="Opening camera…";
    verifyStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
    $("verifyVideo").srcObject=verifyStream;
    await $("verifyVideo").play();
    $("deviceFaceStatus").textContent="Camera active. Loading face recognition…";
    await loadFaceModels();
    $("deviceFaceStatus").textContent="✓ Face recognition ready. Tap Verify registered face.";
  } catch(e) {
    $("deviceFaceStatus").textContent="Camera unavailable. Use the secret-message recovery option.";
    $("secretFallback").classList.remove("hidden");
  }
}

async function verifyFaceDemo() {
  if (!verifyStream) {
    $("secretFallback").classList.remove("hidden");
    $("deviceFaceStatus").textContent="Open the camera first.";
    return;
  }
  try {
    $("deviceFaceStatus").textContent="Loading face recognition model…";
    const currentDescriptor = await getFaceDescriptor($("verifyVideo"));
    const registered = currentProfile?.faceDescriptor;
    if (!registered) {
      $("deviceFaceStatus").textContent="No registered face template found. Re-register this account.";
      $("secretFallback").classList.remove("hidden");
      return;
    }
    const distance = faceDistance(currentDescriptor, registered);
    const threshold = 0.55;
    if (distance <= threshold) {
      $("deviceFaceStatus").textContent=`✓ Face matched the registered user (distance ${distance.toFixed(3)}).`;
      show("home");
    } else {
      $("deviceFaceStatus").textContent=`✕ Face does not match the registered user (distance ${distance.toFixed(3)}).`;
      $("secretFallback").classList.remove("hidden");
    }
  } catch (e) {
    console.error(e);
    $("deviceFaceStatus").textContent="Face recognition could not complete: " + e.message;
    $("secretFallback").classList.remove("hidden");
  }
}

async function verifySecretFallback() {
  const entered=$("verifySecret").value;
  if (!entered) { alert("Enter your secret message."); return; }
  const hash=await sha256(entered);
  if (hash===currentProfile.secretHash) {
    $("deviceFaceStatus").textContent="✓ Recovery verification passed.";
    $("verifySecret").value="";
    show("home");
  } else {
    alert("Incorrect secret message.");
  }
}


function startInheritanceLogin() {
  const upi = $("loginUpi").value.trim().toLowerCase();
  const phone = $("loginPhone").value.trim().replace(/\D/g,"");
  const password = $("loginPassword").value;

  if (!upi || !phone || !password) {
    alert("Enter your UPI ID, phone number and password first.");
    return;
  }
  login(true);
}

function startInheritanceTimer() {
  clearInterval(inheritanceTimer);
  inheritanceSeconds = 60;
  $("inheritTimer").textContent = "60s";
  inheritanceTimer = setInterval(() => {
    inheritanceSeconds--;
    $("inheritTimer").textContent = inheritanceSeconds + "s";
    if (inheritanceSeconds <= 0) {
      clearInterval(inheritanceTimer);
      $("inheritStatus").textContent = "Challenge expired. Start again.";
      $("inheritSecretCard").classList.add("hidden");
      $("inheritFaceStatus").textContent = "Challenge expired.";
      if (inheritanceStream) {
        inheritanceStream.getTracks().forEach(t=>t.stop());
        inheritanceStream=null;
      }
    }
  }, 1000);
}

async function beginInheritance(userProfile) {
  inheritanceUser = userProfile;
  inheritanceFacePassed = false;
  $("inheritSecretCard").classList.add("hidden");
  $("inheritStatus").textContent = "New device detected. Complete the 60-second challenge.";
  $("inheritFaceStatus").textContent = "Start the camera and verify the registered user.";
  $("inheritSecret").value = "";
  show("inheritance");
  startInheritanceTimer();
}

async function startInheritanceCamera() {
  if (inheritanceSeconds <= 0) {
    alert("Challenge expired. Please start the recovery again.");
    return;
  }
  try {
    $("inheritFaceStatus").textContent = "Opening camera…";
    inheritanceStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
    $("inheritVideo").srcObject = inheritanceStream;
    await $("inheritVideo").play();
    $("inheritFaceStatus").textContent = "Camera active. Loading face recognition…";
    await loadFaceModels();
    $("inheritFaceStatus").textContent = "✓ Face recognition ready. Look at the camera and tap Verify Face.";
  } catch (e) {
    $("inheritFaceStatus").textContent =
      "Camera permission was unavailable. The face step cannot be completed.";
    $("inheritStatus").textContent =
      "Camera access is required for this prototype's inheritance challenge.";
  }
}

async function runInheritanceFaceCheck() {
  if (inheritanceSeconds <= 0) return alert("Challenge expired.");
  if (!inheritanceStream) return alert("Open the camera first.");
  try {
    $("inheritFaceStatus").textContent="Checking your face…";
    await waitForVideoReady($("inheritVideo"));
    const currentDescriptor = await getFaceDescriptor($("inheritVideo"));
    const registered = inheritanceUser?.faceDescriptor;
    if (!registered) throw new Error("No registered face template is available.");
    const distance = faceDistance(currentDescriptor, registered);
    const threshold = 0.55;
    if (distance > threshold) {
      inheritanceFacePassed = false;
      $("inheritFaceStatus").textContent=`✕ Face mismatch (distance ${distance.toFixed(3)}).`;
      $("inheritStatus").textContent="Face verification failed. The new device is not trusted.";
      $("inheritSecretCard").classList.add("hidden");
      return;
    }
    inheritanceFacePassed = true;
    $("inheritFaceStatus").textContent=`✓ Face matched the registered user (distance ${distance.toFixed(3)}).`;
    $("inheritStatus").textContent="Face verified. Now complete the secret-message ownership check.";
    $("inheritSecretCard").classList.remove("hidden");
    $("inheritSecret").focus();
  } catch (e) {
    console.error(e);
    inheritanceFacePassed = false;
    $("inheritFaceStatus").textContent="Face recognition failed: " + e.message;
    $("inheritStatus").textContent="Face verification could not be completed.";
  }
}

async function verifyInheritanceSecret() {
  if (inheritanceSeconds <= 0) {
    alert("Challenge expired. Start the recovery again.");
    return;
  }
  if (!inheritanceFacePassed) {
    alert("Complete face verification first.");
    return;
  }

  const entered = $("inheritSecret").value;
  if (!entered) {
    alert("Enter the secret message.");
    return;
  }

  const hash = await sha256(entered);
  if (hash !== inheritanceUser.secretHash) {
    $("inheritStatus").textContent = "Incorrect secret message. Device remains untrusted.";
    alert("Incorrect secret message.");
    return;
  }

  try {
    // This is the key step: the replacement device creates a brand-new key pair.
    const kp = await crypto.subtle.generateKey(
      {name:"ECDSA", namedCurve:"P-256"}, true, ["sign","verify"]
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);

    await savePrivateKey(inheritanceUser.uid, kp.privateKey);

    await setDoc(doc(db, "devices", inheritanceUser.uid), {
      uid: inheritanceUser.uid,
      publicKeyJwk: publicJwk,
      algorithm: "ECDSA-P256-SHA256",
      replacedDevice: true,
      recoveryMethod: "inheritance",
      recoveryAt: serverTimestamp()
    }, {merge:true});

    // Rotate the device ID on the account.
    const newDeviceId = crypto.randomUUID();
    await updateDoc(doc(db, "users", inheritanceUser.uid), {
      deviceId: newDeviceId
    });
    inheritanceUser.deviceId = newDeviceId;
    currentProfile.deviceId = newDeviceId;

    clearInterval(inheritanceTimer);
    if (inheritanceStream) {
      inheritanceStream.getTracks().forEach(t=>t.stop());
      inheritanceStream=null;
    }

    $("inheritStatus").textContent =
      "✓ New device verified. A new cryptographic key has been registered.";
    $("inheritSecret").value = "";

    setTimeout(() => {
      show("home");
    }, 700);
  } catch (e) {
    console.error(e);
    $("inheritStatus").textContent = "Recovery failed. New device was not enrolled.";
    alert("Could not create the new device enrollment: " + e.message);
  }
}

function cancelInheritance() {
  clearInterval(inheritanceTimer);
  if (inheritanceStream) {
    inheritanceStream.getTracks().forEach(t=>t.stop());
    inheritanceStream=null;
  }
  inheritanceUser=null;
  inheritanceFacePassed=false;
  show("login");
}


function renderHome() {
  if (!currentProfile) return;
  $("hello").textContent = "Hello, " + currentProfile.name + " 👋";
  $("balance").textContent = money(currentProfile.balance);
  $("myUpi").textContent = currentProfile.upi;
  $("homeProfileUpi").textContent = currentProfile.upi;
  renderProfileQR();
  loadRecent();
}

async function loadRecent() {
  const box = $("recent");
  if (!box || !currentProfile) return;
  try {
    const q = query(
      collection(db, "transactions"),
      where("participants", "array-contains", currentProfile.uid),
      orderBy("createdAt", "desc"),
      limit(3)
    );
    const snap = await getDocs(q);
    box.innerHTML = snap.empty ? '<p class="muted">No transactions yet.</p>' :
      snap.docs.map(d => {
        const t=d.data();
        return `<p>${t.fromUid===currentProfile.uid?'↗':'↙'} ${money(t.amount)} ${t.fromUid===currentProfile.uid?'to '+t.toUpi:'from '+t.fromUpi}</p>`;
      }).join("");
  } catch (e) {
    box.innerHTML = '<p class="muted">Transactions will appear after Firestore indexes/rules are configured.</p>';
  }
}

async function searchUsers() {
  const box = $("users");
  if (!box || !firebaseReady) return;
  const qtext = ($("search")?.value || "").trim().toLowerCase();
  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => d.data())
      .filter(u => u.uid !== currentProfile?.uid)
      .filter(u => !qtext ||
        u.name.toLowerCase().includes(qtext) ||
        u.upi.toLowerCase().includes(qtext) ||
        u.phone.includes(qtext));

    box.innerHTML = users.length ? users.map(u => `
      <div class="user row">
        <div>
          ${u.photoURL ? `<img src="${u.photoURL}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px">` : ""}
          <b>${u.name}</b>
          <div class="muted tiny">${u.upi}</div>
          <div class="muted tiny">${u.phone}</div>
        </div>
        <button class="secondary" onclick="selectUser('${u.uid}')">PAY</button>
      </div>`).join("") :
      '<p class="muted">No registered users found in the shared database.</p>';
  } catch(e) {
    box.innerHTML = '<p class="muted">Could not load shared users. Check Firestore setup/rules.</p>';
  }
}

async function selectUser(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return;
  selected = snap.data();
  $("selectedName").textContent = selected.name;
  $("selectedUpi").textContent = selected.upi;
  $("payBox").classList.remove("hidden");
  $("payAmount").focus();
}

function createIntent() {
  const amount = Number($("payAmount").value);
  if (!selected || !amount || amount <= 0) {
    alert("Select a user and enter a valid amount.");
    return;
  }
  if (amount > Number(currentProfile.balance || 0)) {
    alert("Insufficient demo balance.");
    return;
  }

  intent = {
    id: crypto.randomUUID(),
    fromUid: currentProfile.uid,
    fromUpi: currentProfile.upi,
    toUid: selected.uid,
    toUpi: selected.upi,
    amount,
    nonce: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    deviceId: currentProfile.deviceId,
    expiresAt: Date.now() + 120000
  };

  $("confirmAmount").textContent = money(amount);
  $("confirmReceiver").textContent = "To " + selected.name + " • " + selected.upi;
  show("confirm");
}

async function authenticate() {
  if (paymentInProgress) return;
  if (!intent || Date.now() > intent.expiresAt) {
    alert("Payment intent expired.");
    show("send");
    return;
  }

  // Prototype biometric gate + real browser cryptographic signing.
  const ok = confirm(
    "Biometric authentication\n\nApprove this exact transaction?\n\n" +
    money(intent.amount) + " → " + intent.toUpi
  );
  if (!ok) return;

  paymentInProgress = true;
  try {
    if (!intent) throw new Error("Payment session is no longer valid.");
    intent.signature = await signIntent(intent);
    await completePayment();
  } catch(e) {
    console.error(e);
    alert("Cryptographic authorization failed. Payment blocked.");
  } finally {
    paymentInProgress = false;
  }
}

async function checkSuspiciousPaymentPattern(payment) {
  const windowMs = 10 * 60 * 1000;
  const now = Date.now();
  const requiredCount = Math.max(5, Math.ceil(100 / Number(payment.amount || 1)));
  const snap = await getDocs(query(collection(db, "transactions"), where("fromUid", "==", payment.fromUid), limit(50)));
  const recentSameAmount = snap.docs.filter(d => {
    const t = d.data();
    const created = t.createdAt?.toMillis ? t.createdAt.toMillis() : (t.createdAt?.seconds ? t.createdAt.seconds * 1000 : 0);
    return created > now - windowMs && Number(t.amount) === Number(payment.amount) && t.fromUid === payment.fromUid;
  });
  const attemptCount = recentSameAmount.length + 1;
  return { suspicious: attemptCount >= requiredCount, count: attemptCount, requiredCount };
}

async function completePayment() {
  // Snapshot the payment intent immediately. The continuous Identity Guard can
  // invalidate the global intent while async Firestore operations are running.
  // This prevents a null.fromUid error during a legitimate payment.
  const payment = intent ? { ...intent } : null;
  if (!payment) {
    alert("Payment session is no longer valid. Please start the payment again.");
    return;
  }

  try {
    // Validate authorization BEFORE changing either balance.
    if (!payment.signature || !payment.nonce || Date.now() > payment.expiresAt) {
      alert("Authorization invalid or expired — payment blocked.");
      return;
    }

    // Replay protection: the nonce must never have been used before.
    // This check happens before ANY balance update.
    const replay = await getDocs(query(
      collection(db, "transactions"), where("nonce", "==", payment.nonce), limit(1)
    ));
    if (!replay.empty) {
      $("blockedTitle").textContent = "Replay Attack Blocked";
      $("blockedReason").textContent = "🚨 REPLAY ATTACK DETECTED";
      $("blockText").textContent = `Replayed transaction ${payment.id} was rejected. Nonce ${payment.nonce} has already been consumed.`;
      $("blockedDetail").textContent = "Payment FAILED • ₹0 deducted • ₹0 received • No new transaction created.";
      show("blocked");
      return;
    }

    // Read both users from the shared database before changing balances.
    const fromRef = doc(db, "users", payment.fromUid);
    const toRef = doc(db, "users", payment.toUid);
    const [fromSnap, toSnap] = await Promise.all([getDoc(fromRef), getDoc(toRef)]);
    if (!fromSnap.exists() || !toSnap.exists()) throw new Error("User account missing.");

    const from = fromSnap.data();
    if (Number(from.balance) < payment.amount) throw new Error("Insufficient balance.");

    // Suspicious repeated-payment protection — always before balance changes.
    const pattern = await checkSuspiciousPaymentPattern(payment);
    if (pattern.suspicious) {
      $("blockedTitle").textContent = "Suspicious Activity Blocked";
      $("blockedReason").textContent = "🚨 REPEATED PAYMENT PATTERN DETECTED";
      $("blockText").textContent = `SecurePay detected ${pattern.count} attempts of ₹${payment.amount} within a short period.`;
      $("blockedDetail").textContent = `Payment FAILED • ₹0 deducted • ₹0 received • Security threshold: ${pattern.requiredCount} repeated payments.`;
      if (intent && intent.id === payment.id) intent = null;
      show("blocked");
      return;
    }

    // Demo transfer. Production must use an atomic trusted-backend operation.
    await updateDoc(fromRef, { balance: increment(-payment.amount) });
    await updateDoc(toRef, { balance: increment(payment.amount) });

    await addDoc(collection(db, "transactions"), {
      intentId: payment.id,
      nonce: payment.nonce,
      sessionId: payment.sessionId,
      fromUid: payment.fromUid,
      fromUpi: payment.fromUpi,
      toUid: payment.toUid,
      toUpi: payment.toUpi,
      amount: payment.amount,
      signature: payment.signature,
      algorithm: "ECDSA-P256-SHA256",
      participants: [payment.fromUid, payment.toUid],
      createdAt: serverTimestamp()
    });

    if (currentProfile && currentProfile.uid === payment.fromUid) {
      currentProfile.balance = Number(from.balance) - payment.amount;
    }

    // Clear the global intent only after all payment operations have completed.
    if (intent && intent.id === payment.id) intent = null;

    $("successText").textContent =
      `${money(payment.amount)} sent to ${toSnap.data().name} (${payment.toUpi}).`;
    show("success");
  } catch (e) {
    console.error(e);
    alert("Payment failed: " + (e?.message || e));
  }
}


async function renderKeyStatus() {
  const el=$("keyStatus");
  if(!el || !currentProfile){return;}
  const k=await getPrivateKey(currentProfile.uid);
  el.textContent=k
    ? "✓ Private signing key present on this device (non-exportable CryptoKey)"
    : "⚠ No private signing key on this device — recovery verification required";
}

async function renderHistory() {
  const box = $("historyList");
  if (!box || !currentProfile) return;
  box.innerHTML = '<div class="card"><p class="muted">Loading transaction history…</p></div>';

  try {
    // Avoid requiring a composite Firestore index. Fetch this user's
    // transactions, then sort them locally by the server timestamp.
    const snap = await getDocs(query(
      collection(db, "transactions"),
      where("participants", "array-contains", currentProfile.uid),
      limit(50)
    ));

    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
      });

    if (!transactions.length) {
      box.innerHTML = `
        <div class="card center">
          <div style="font-size:48px">🧾</div>
          <h3>No transactions yet</h3>
          <p class="muted">Completed SecurePay payments will appear here.</p>
        </div>`;
      return;
    }

    box.innerHTML = transactions.map(t => {
      const sent = t.fromUid === currentProfile.uid;
      const direction = sent ? '↗ Sent' : '↙ Received';
      const counterparty = sent ? t.toUpi : t.fromUpi;
      const date = t.createdAt?.toDate
        ? t.createdAt.toDate().toLocaleString('en-IN', {
            day:'2-digit', month:'short', year:'numeric',
            hour:'2-digit', minute:'2-digit'
          })
        : 'Processing timestamp…';
      const status = t.nonce ? 'Verified • Nonce recorded' : 'Completed';

      return `
        <div class="card" style="margin-bottom:12px">
          <div class="between">
            <b>${direction}</b>
            <span class="amount" style="font-size:22px">${money(t.amount)}</span>
          </div>
          <p style="margin:8px 0 3px"><b>${sent ? 'To' : 'From'}:</b> ${counterparty || 'Unknown'}</p>
          <p class="muted tiny" style="margin:3px 0">${date}</p>
          <p class="tiny" style="margin:8px 0 0">🛡 ${status}</p>
          <details style="margin-top:8px">
            <summary class="tiny" style="cursor:pointer">Transaction security details</summary>
            <p class="tiny muted" style="word-break:break-all;margin-bottom:3px">Transaction ID: ${t.intentId || t.id}</p>
            <p class="tiny muted" style="word-break:break-all;margin:3px 0">Nonce: ${t.nonce || '—'}</p>
            <p class="tiny muted" style="margin:3px 0">Algorithm: ${t.algorithm || 'SecurePay'}</p>
          </details>
        </div>`;
    }).join('');
  } catch(e) {
    console.error('Transaction history error:', e);
    box.innerHTML = `
      <div class="alert">
        <b>Could not load transaction history.</b>
        <p class="tiny">Check Firebase Authentication, Firestore access rules, and your internet connection.</p>
      </div>`;
  }
}

function lockQRIntent() {
  const upi = $("qrIntentUpi").value.trim().toLowerCase();
  const amount = Number($("qrIntentAmount").value);

  if (!upi || !amount || amount <= 0) {
    alert("Enter the receiver UPI ID and a valid amount first.");
    return;
  }

  qrIntent = {
    receiverUpi: upi,
    amount,
    intentId: crypto.randomUUID(),
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 120000
  };

  $("qrIntentStatus").textContent =
    `🔒 Locked: ${money(amount)} → ${upi} • expires in 2 minutes`;
  $("qrIntentStatus").style.color = "#15803d";
  $("qrUploadCard").classList.remove("hidden");
  $("qrFile").value = "";
  $("qrPreview").innerHTML = "";
  $("qrReadStatus").textContent = "Upload the receiver's unique SecurePay QR.";
  $("verifyQRButton").classList.add("hidden");
  uploadedQrData = null;
}

function renderProfileQR() {
  const boxes = [$("myQr"), $("homeMyQr")].filter(Boolean);
  if (!currentProfile || !boxes.length) return;

  const qrId = currentProfile.qrId || currentProfile.uid;
  // Compact payload makes the QR easier to decode from screenshots/photos.
  // Format: SECUREPAY|version|qrId|upi
  const payload = `SECUREPAY|1|${qrId}|${currentProfile.upi}`;

  boxes.forEach(box => {
    box.innerHTML = "";
    if (typeof QRCode !== "undefined") {
      new QRCode(box, {
        text: payload,
        width: 190,
        height: 190,
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      box.innerHTML = "<p class='muted'>QR generator unavailable. Check internet connection.</p>";
    }
  });
}

function generateMyQR() {
  renderProfileQR();
}

async function readUploadedQR(event) {
  if (!qrIntent) {
    alert("Lock the payment intent before uploading a QR.");
    event.target.value = "";
    return;
  }

  const file = event.target.files?.[0];
  if (!file) return;

  uploadedQrData = null;
  $("verifyQRButton").classList.add("hidden");
  $("qrReadStatus").textContent = "🔎 Reading QR and checking receiver…";

  const imageUrl = URL.createObjectURL(file);
  $("qrPreview").innerHTML =
    `<img id="uploadedQrImage" src="${imageUrl}" style="max-width:220px;border-radius:14px;border:1px solid #dbe3ef">`;

  try {
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not load the QR image."));
    });

    let raw = null;

    // 1) qr-scanner: searches the whole image and is good for screenshots/photos.
    if (!raw && typeof QrScanner !== "undefined") {
      try {
        const result = await QrScanner.scanImage(img, {
          returnDetailedScanResult: true,
          alsoTryWithoutScanRegion: true,
          maxScansPerSecond: 5
        });
        raw = result?.data || result;
      } catch (e) {
        console.warn("qr-scanner failed", e);
      }
    }

    // 2) BarcodeDetector where supported.
    if (!raw && "BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({formats:["qr_code"]});
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        if (codes.length) raw = codes[0].rawValue;
      } catch (e) {
        console.warn("BarcodeDetector failed", e);
      }
    }

    // 3) jsQR fallback with multiple preprocessing attempts.
    if (!raw && typeof jsQR === "function") {
      const canvas = document.createElement("canvas");
      const maxSize = 1800;
      const scale = Math.max(1, Math.min(3, maxSize / Math.max(img.naturalWidth, img.naturalHeight)));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d", {willReadFrequently:true});
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const attempts = [
        [0, 0, canvas.width, canvas.height],
        [0.05, 0.05, 0.90, 0.90],
        [0.10, 0.10, 0.80, 0.80]
      ];
      for (const [x,y,w,h] of attempts) {
        const sx=Math.round(canvas.width*x), sy=Math.round(canvas.height*y);
        const sw=Math.max(1,Math.round(canvas.width*w)), sh=Math.max(1,Math.round(canvas.height*h));
        const data=ctx.getImageData(sx,sy,sw,sh);
        const code=jsQR(data.data, data.width, data.height, {inversionAttempts:"attemptBoth"});
        if (code) { raw=code.data; break; }
      }
    }

    // 4) Final fallback for browsers where the local QR decoders fail.
    // This sends only the selected QR image to QRServer's decoder for this prototype.
    if (!raw) {
      try {
        $("qrReadStatus").textContent = "🔎 Local scanner unavailable. Trying secure QR decoder…";
        const form = new FormData();
        form.append("file", file, file.name || "qr.jpg");
        const response = await fetch("https://api.qrserver.com/v1/read-qr-code/?outputformat=json", {
          method: "POST",
          body: form
        });
        if (response.ok) {
          const result = await response.json();
          const symbol = result?.[0]?.symbol?.[0];
          if (symbol?.data) raw = symbol.data;
        }
      } catch (e) {
        console.warn("QRServer fallback failed", e);
      }
    }

    if (!raw) {
      uploadedQrData = null;
      $("qrReadStatus").innerHTML =
        "❌ <b>QR could not be decoded.</b><br>Make sure the complete SecurePay QR is visible, then upload the original QR image.";
      return;
    }

    // Accept both the new compact format and older JSON SecurePay QRs.
    const text = String(raw).trim();
    if (text.startsWith("SECUREPAY|")) {
      const parts=text.split("|");
      if (parts.length >= 4) {
        uploadedQrData={type:"SECUREPAY_RECEIVER",version:Number(parts[1])||1,qrId:parts[2],upi:parts.slice(3).join("|")};
      }
    } else {
      try { uploadedQrData = JSON.parse(text); }
      catch { uploadedQrData = {rawValue:text}; }
    }

    $("qrReadStatus").textContent = "✓ QR decoded. Checking UPI ID…";
    await verifyQR();
  } catch (e) {
    console.error(e);
    uploadedQrData = null;
    $("qrReadStatus").textContent = "❌ QR reading failed: " + (e.message || e);
  } finally {
    setTimeout(() => URL.revokeObjectURL(imageUrl), 1000);
  }
}
async function verifyQR() {
  if (!qrIntent) {
    alert("Lock the payment intent first.");
    return;
  }
  if (Date.now() > qrIntent.expiresAt) {
    alert("The locked payment intent has expired. Create a new one.");
    return;
  }
  if (!uploadedQrData) {
    alert("Upload and decode a valid SecurePay QR first.");
    return;
  }

  const qrUpi = String(uploadedQrData.upi || "").trim().toLowerCase();
  const qrId = String(uploadedQrData.qrId || "").trim();

  if (uploadedQrData.type !== "SECUREPAY_RECEIVER" || !qrId || qrUpi !== qrIntent.receiverUpi) {
    $("blockText").textContent =
      `Locked receiver: ${qrIntent.receiverUpi}. Uploaded QR receiver: ${qrUpi || "unknown"}.`;
    show("blocked");
    return;
  }

  try {
    // Resolve the QR's unique ID to the real Firebase user UID.
    const receiverSnap = await getDocs(query(
      collection(db, "users"),
      where("qrId", "==", qrId),
      limit(1)
    ));

    if (receiverSnap.empty) {
      $("blockText").textContent = "This QR is not linked to a registered SecurePay user.";
      show("blocked");
      return;
    }

    const receiver = receiverSnap.docs[0].data();
    if (receiver.uid === currentProfile.uid || receiver.upi.toLowerCase() !== qrIntent.receiverUpi) {
      $("blockText").textContent = "The scanned QR does not match the locked receiver.";
      show("blocked");
      return;
    }

    // The amount is never taken from the QR. It stays locked to the payer's intent.
    intent = {
      id: qrIntent.intentId,
      fromUid: currentProfile.uid,
      fromUpi: currentProfile.upi,
      toUid: receiver.uid,
      toUpi: receiver.upi,
      amount: qrIntent.amount,
      nonce: qrIntent.nonce,
      sessionId: crypto.randomUUID(),
      deviceId: currentProfile.deviceId,
      expiresAt: qrIntent.expiresAt
    };

    $("confirmAmount").textContent = money(qrIntent.amount);
    $("confirmReceiver").textContent = "✓ QR MATCHED — To " + receiver.name + " • " + receiver.upi;
    $("qrReadStatus").textContent = "✓ QR matched the locked UPI ID. Payment is ready.";
    show("confirm");
  } catch (e) {
    console.error(e);
    alert("Could not resolve the scanned SecurePay QR: " + e.message);
  }
}

function stopRegistrationCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

async function startCamera() {
  registrationFaceDescriptor = null;
  $("photoPreview").removeAttribute("src");
  $("photoPreview").classList.add("hidden");

  if (!window.isSecureContext && location.protocol !== "file:") {
    $("faceStatus").textContent = "✕ Camera requires HTTPS or localhost.";
    alert("Run SecurePay through localhost (use Run-SecurePay.bat), not an ordinary HTTP website.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    $("faceStatus").textContent = "✕ Camera API is unavailable in this browser.";
    alert("Use Chrome or Edge and open SecurePay through localhost.");
    return;
  }

  try {
    $("faceStatus").textContent = "Opening camera…";
    stopRegistrationCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    const video = $("video");
    video.srcObject = stream;
    await video.play();
    await waitForVideoReady(video, 10000);

    $("faceStatus").textContent = "Camera active. Loading face recognition…";
    await loadFaceModels();
    $("faceStatus").textContent = "✓ Face recognition ready. Center exactly one face, then Capture Face.";
  } catch(e) {
    console.error(e);
    stopRegistrationCamera();
    $("faceStatus").textContent = "✕ Camera/face model error: " + (e?.message || e);
    alert("Camera/face recognition could not start. Use Chrome/Edge on localhost and make sure internet access and camera permission are enabled.");
  }
}

async function detectLocation() {
  const input = $("rLocation");
  const status = $("locationStatus");

  if (!navigator.geolocation) {
    status.textContent = "✕ Your browser does not support location.";
    alert("Location is not supported by this browser. Use Chrome or Edge.");
    return;
  }

  status.textContent = "📍 Requesting location permission…";

  // On localhost Chrome/Edge will show the native permission prompt.
  // If permission was previously blocked, tell the user exactly how to reset it.
  try {
    if (navigator.permissions?.query) {
      const permission = await navigator.permissions.query({name: "geolocation"});
      if (permission.state === "denied") {
        status.textContent = "✕ Location is blocked for this site.";
        alert("Location is blocked. Click the 🔒 icon beside the address bar → Site settings → Location → Allow, then reload SecurePay and tap Detect again.");
        return;
      }
    }
  } catch (_) {}

  navigator.geolocation.getCurrentPosition(
    position => {
      const {latitude, longitude, accuracy} = position.coords;
      registrationLocation = {lat: latitude, lng: longitude, accuracy};
      input.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      status.textContent = `✓ Location captured (±${Math.round(accuracy)} m). It will be saved with your profile.`;
    },
    error => {
      let msg;
      if (error.code === 1) {
        msg = "Location permission was denied. Allow Location for localhost in the browser site settings and tap Detect again.";
      } else if (error.code === 2) {
        msg = "Your device could not determine a location. Turn on Windows Location Services and try again.";
      } else {
        msg = "Location request timed out. Make sure Location Services are enabled and try again.";
      }
      status.textContent = "✕ " + msg;
      alert(msg);
    },
    {enableHighAccuracy: true, timeout: 30000, maximumAge: 0}
  );
}
async function capturePhoto() {
  const video = $("video");
  const canvas = $("photoCanvas");
  const preview = $("photoPreview");

  if (!stream || !video.videoWidth || video.readyState < 2) {
    alert("Open the camera first and wait until the live video appears.");
    return;
  }

  try {
    $("faceStatus").textContent = "Capturing face and running recognition…";
    await waitForVideoReady(video, 8000);
    await loadFaceModels();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Recognition happens on the captured frame itself.
    const descriptor = await getFaceDescriptor(canvas);
    registrationFaceDescriptor = descriptor;

    preview.src = canvas.toDataURL("image/jpeg", 0.9);
    preview.classList.remove("hidden");
    $("faceStatus").textContent = "✓ Face captured and recognized. You can now press Register & Continue.";
  } catch (e) {
    registrationFaceDescriptor = null;
    preview.removeAttribute("src");
    preview.classList.add("hidden");
    console.error(e);
    $("faceStatus").textContent = "✕ Face capture failed: " + (e?.message || e);
    alert("Face capture failed. Keep exactly one face centered, look toward the camera, improve lighting, and try again.");
  }
}
function copyUPI() {
  navigator.clipboard?.writeText(currentProfile.upi);
  alert("UPI ID copied.");
}

async function logout() {
  stopFaceGuard();
  if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }
  if (verifyStream) { verifyStream.getTracks().forEach(t=>t.stop()); verifyStream=null; }
  if (firebaseReady) await signOut(auth);

  // Clear all authentication/login fields so no previous user's details
  // remain visible after logout.
  ["loginUpi", "loginPhone", "loginPassword"].forEach(id => {
    const el = $(id);
    if (el) el.value = "";
  });

  // Clear temporary security/recovery inputs as well.
  ["faceGuardSecret", "verifySecret", "inheritSecret", "search"].forEach(id => {
    const el = $(id);
    if (el) el.value = "";
  });

  currentProfile = null;
  selected = null;
  intent = null;
  paymentInProgress = false;
  qrIntent = null;
  show("login");
}

window.show=show; window.register=register; window.login=login; window.searchUsers=searchUsers;
window.selectUser=selectUser; window.createIntent=createIntent; window.authenticate=authenticate;
window.verifyQR=verifyQR; window.lockQRIntent=lockQRIntent; window.readUploadedQR=readUploadedQR; window.generateMyQR=generateMyQR; window.startCamera=startCamera; window.copyUPI=copyUPI; window.logout=logout;
window.startInheritanceLogin=startInheritanceLogin;
window.startInheritanceCamera=startInheritanceCamera;
window.runInheritanceFaceCheck=runInheritanceFaceCheck;
window.verifyInheritanceSecret=verifyInheritanceSecret;
window.cancelInheritance=cancelInheritance; window.startVerifyCamera=startVerifyCamera; window.verifyFaceDemo=verifyFaceDemo; window.verifySecretFallback=verifySecretFallback; window.startFaceGuard=startFaceGuard; window.unlockFaceGuard=unlockFaceGuard;

if (firebaseReady) {
  setStatus("Firebase configured", true);
  onAuthStateChanged(auth, loadCurrentProfile);
} else {
  setStatus("Firebase setup required");
}


// IMPORTANT: this file uses <script type="module">, so functions are not
// automatically visible to inline onclick/oninput/onchange handlers.
// Expose the UI functions explicitly on window.
Object.assign(window, {
  show, register, login, startInheritanceLogin, logout,
  startCamera, capturePhoto, detectLocation,
  startInheritanceCamera, runInheritanceFaceCheck, verifyInheritanceSecret,
  startVerifyCamera, verifyFaceDemo, verifySecretFallback,
  searchUsers, selectUser, createIntent, authenticate,
  lockQRIntent, readUploadedQR, verifyQR, copyUPI, cancelInheritance,
  startFaceGuard, unlockFaceGuard
});

// Register the PWA service worker.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
