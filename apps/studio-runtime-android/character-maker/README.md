# Character Maker — isolated Android shell

This is the explicitly requested small character-modeling product, not a replacement for the canonical full Studio. The full Studio remains on its own production plan and entry point.

## Step 1 scope

- Separate `:characterMaker` application and `com.aianimationstudio.charactermaker` installation identity.
- Own `CharacterMakerActivity`, own manifest and image-picker/preview screen.
- Reuse the M58 native engine's source files without copying or rewriting them. The full Studio `MainActivity.kt` is excluded from this module. Release R8 removes unreachable production functionality.
- No WebView, browser bridge, provider key, video editor, MP4 action or full Studio navigation in the shell UI.
- The Create 3D action is deliberately disabled until the real reconstruction adapter is connected and tested. The preview is a 2D source preview, not a claimed 3D result.

## Build

From `apps/studio-runtime-android`:

```bash
./gradlew :characterMaker:testReleaseUnitTest :characterMaker:lintRelease :characterMaker:assembleRelease \
  -PstudioCommitSha=<exact-source-sha> \
  -PstudioSourceDate=<iso-8601-date> \
  -PruntimeVersion=0.1.0-character-shell \
  -PruntimeVersionCode=1
```

Use JDK 17 and Android SDK 36. The isolated CI uses a development signing key only. Its APK is an installable shell, not a final character-generator release or physical-device certification. Build success, source identity and signing must be verified before calling even the shell artifact ready.

## Next implementation

Connect exact reference import to the existing `NativeReferenceDrivenCharacterModel3DBuilder`, rig/model validation and reusable `NativeCharacterDefinition3D` storage. Only then enable Create 3D. A later step adds a real rotatable native mesh viewer; no image-only substitute is acceptable. Existing heuristic reconstruction is a stylized source-bound proxy, not photogrammetry.
