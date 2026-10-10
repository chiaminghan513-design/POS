# Eduvo POS on Android

Open `C:\IonicExercise\EduvoPOS\android` in Android Studio, not the member app's Android directory.
The app is named **Eduvo POS** and uses package ID `com.eduvo.pos`, separate from `com.eduvo.rewards`.

## Local USB testing

Keep EduvoBackend running on the laptop on port 3000, connect the phone with USB debugging enabled, then run:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:3000 tcp:3000
```

Select the phone in Android Studio and run the **app** debug configuration. Accept the camera permission on the phone when scanning. The rear camera scans the member QR displayed on the laptop webpage or member app emulator. Manual member lookup remains available.

Reapply USB forwarding after reconnecting the phone. The app does not contain upstream JWT credentials: requests still go through EduvoBackend. This debug build permits HTTP only to localhost/127.0.0.1; release deployment needs an HTTPS backend URL.

## Update the packaged POS after web changes

Run from `C:\IonicExercise\EduvoPOS`:

```powershell
npm run build
npx cap sync android
npx cap open android
```

Then rebuild/run in Android Studio. Starting the web dev server alone does not update an installed Android app.
