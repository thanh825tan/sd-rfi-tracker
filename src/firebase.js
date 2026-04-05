import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push, remove, update } from "firebase/database";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  // const firebaseConfig = {
  apiKey: "AIzaSyDNRRwe-8eX7JNGTpEHNhe_FFW3qR-bk6c",
  authDomain: "wealthcons-sd-rfi.firebaseapp.com",
  projectId: "wealthcons-sd-rfi",
  storageBucket: "wealthcons-sd-rfi.firebasestorage.app",
  messagingSenderId: "307981863049",
  appId: "1:307981863049:web:7c08dcf30b4b930a3a5e58"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { ref, onValue, set, push, remove, update, signInWithPopup, signOut, onAuthStateChanged };