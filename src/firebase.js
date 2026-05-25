import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDjSCkQyj-M_vb4ch4S1tJ_6WhywgEbX30",
  authDomain: "lustrum-reis.firebaseapp.com",
  projectId: "lustrum-reis",
  storageBucket: "lustrum-reis.firebasestorage.app",
  messagingSenderId: "299144782700",
  appId: "1:299144782700:web:e34e4b1d2fa0ea9adb8949",
  measurementId: "G-3PSM5BTK34"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
