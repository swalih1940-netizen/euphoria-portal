# Euphoria '26 - Dedicated Android TV Standalone Wrapper

This directory contains a complete native Android application designed specifically for **Android TV**, **Google TV**, and **Fire TV** displays. It wraps the Euphoria Portal `/tv` route into a native, standalone kiosk application that bypasses mobile browser limitations, URL address bars, navigation bars, and captcha issues.

---

## 🌟 Key Features

1. **Android TV Leanback Launcher**:
   - Declares `LEANBACK_LAUNCHER` and includes a 16:9 widescreen TV banner (`tv_banner`).
   - Appears directly on the Android TV home screen apps row.

2. **Kiosk Mode (Zero Sleep / Always On)**:
   - Uses `FLAG_KEEP_SCREEN_ON` and sticky immersive mode (`SYSTEM_UI_FLAG_IMMERSIVE_STICKY`).
   - The TV display will never sleep, dim, or show system navigation bars during the event.

3. **Remote Control Configurable Portal URL**:
   - You can switch between production cloud (`https://euphoria.sirajulirfan.com/tv`) and a local festival LAN server (e.g. `http://192.168.1.100:3001/tv`) directly on the TV using your remote!
   - Press **MENU**, **INFO**, **SETTINGS**, or **Long-press BACK** on the TV remote to open the on-screen URL configuration modal.
   - Saves settings persistently in `SharedPreferences`.

4. **Network Drop & Auto-Recovery**:
   - If the venue Wi-Fi drops or the server restarts, instead of showing an ugly browser 404 or crash, the app shows a sleek dark-mode reconnect screen and automatically retries every few seconds until the feed resumes.

5. **Hardware Accelerated HTML5 Display**:
   - Full WebGL, DOM Storage, unrestricted media/audio playback for celebration fanfares, and desktop TV User-Agent to bypass any anti-bot or browser incompatibility checks.

---

## 🚀 How to Build the APK

### Option 1: 1-Click Cloud Build with GitHub Actions (Recommended - No SDK needed!)
This repository includes `.github/workflows/build-tv-apk.yml`.
1. Push your repository to GitHub.
2. In your GitHub repo, go to **Actions** → **Build Euphoria Android TV APK**.
3. Click **Run workflow**.
4. In ~2 minutes, download the compiled `euphoria-tv-standalone-apk` zip containing `app-release-unsigned.apk` or `app-debug.apk` directly from the workflow summary page!

---

### Option 2: Open in Android Studio
1. Open **Android Studio**.
2. Select **File > Open...** and select the `android-tv` folder.
3. Wait for Gradle sync to complete.
4. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. The output APK will be located at:
   `android-tv/app/build/outputs/apk/debug/app-debug.apk`

---

### Option 3: Command Line (Gradle)
If you have Java and Android SDK installed on your system:
```bash
cd android-tv
./gradlew assembleDebug
```
The output file will be generated in `app/build/outputs/apk/debug/app-debug.apk`.

---

## 📺 How to Install on Android TV

### Method 1: Using the "Downloader" App (Easiest)
1. On your Android TV, install the **Downloader by AFTVnews** app from the Google Play Store.
2. Host the built `.apk` on a cloud link (Google Drive, GitHub Releases, or local server).
3. Type the download link or code into Downloader and click **Install**.

### Method 2: Via USB Drive
1. Copy `app-debug.apk` to a USB flash drive.
2. Plug the USB drive into your Android TV's USB port.
3. Open a file manager (like **FX File Explorer** or **File Commander** on TV) and click the APK to install.

### Method 3: Via Wireless ADB
1. Enable **Developer Options** and **USB/Network Debugging** in your TV Settings.
2. Connect to the TV from your computer:
   ```bash
   adb connect <TV_IP_ADDRESS>:5555
   adb install app-debug.apk
   ```

---

## 🎮 TV Remote Button Controls

| Remote Button | Action |
|---|---|
| **MENU / INFO / SETTINGS** | Opens on-screen Portal URL Settings dialog |
| **Long-Press BACK** | Opens on-screen Portal URL Settings dialog |
| **Double-Press BACK** | Exit application confirmation |
| **REFRESH (if present)** | Force-reloads the TV live page |
| **D-Pad / OK / Enter** | Navigate through UI and interactive items |
