plugins {
    id("com.android.application")
}

val zeroSha = "0000000000000000000000000000000000000000"
val sha40 = Regex("^[0-9a-f]{40}$")
val studioCommitSha = providers.gradleProperty("studioCommitSha").orElse(zeroSha)
val studioSourceDate = providers.gradleProperty("studioSourceDate").orElse("1970-01-01T00:00:00.000Z")
val runtimeVersion = providers.gradleProperty("runtimeVersion").orElse("0.1.0-dev")
val runtimeVersionCode = providers.gradleProperty("runtimeVersionCode").orElse("1").map { value ->
    value.toIntOrNull()?.takeIf { it > 0 }
        ?: throw GradleException("runtimeVersionCode must be a positive integer.")
}

if (!sha40.matches(studioCommitSha.get())) {
    throw GradleException("studioCommitSha must be a 40-character lowercase hexadecimal commit SHA.")
}

fun quotedBuildConfig(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val repoRoot = rootProject.projectDir.resolve("../..").canonicalFile
val generatedStudioAssets = layout.buildDirectory.dir("generated/studio-assets")
val m55UpdateKeystore = rootProject.file("keystore/m55-update-debug.jks")

android {
    namespace = "com.aianimationstudio.runtime"
    compileSdk = 36

    signingConfigs {
        getByName("debug") {
            // Development-only stable key: keeps M55 test APKs update-compatible across CI runners.
            // Production releases must use a separate protected signing identity.
            storeFile = m55UpdateKeystore
            storePassword = "m55devupdate"
            keyAlias = "m55-dev-update"
            keyPassword = "m55devupdate"
        }
    }

    defaultConfig {
        applicationId = "com.aianimationstudio.runtime"
        minSdk = 29
        targetSdk = 36
        versionCode = runtimeVersionCode.get()
        versionName = runtimeVersion.get()

        buildConfigField("String", "STUDIO_REPOSITORY", quotedBuildConfig("tigpetryan-rgb/AI-Animation-Studio"))
        buildConfigField("String", "STUDIO_COMMIT_SHA", quotedBuildConfig(studioCommitSha.get()))
        buildConfigField("String", "STUDIO_SOURCE_DATE", quotedBuildConfig(studioSourceDate.get()))
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    sourceSets["main"].assets.srcDir(generatedStudioAssets)
}

val buildStudioWeb by tasks.registering(Exec::class) {
    workingDir = repoRoot
    val npmExecutable = if (System.getProperty("os.name").lowercase().contains("windows")) "npm.cmd" else "npm"
    commandLine(npmExecutable, "run", "build:web")
    environment("AISTUDIO_SOURCE_SHA", studioCommitSha.get())
    environment("AISTUDIO_SOURCE_DATE", studioSourceDate.get())
}

val syncStudioWeb by tasks.registering(Sync::class) {
    dependsOn(buildStudioWeb)
    from(repoRoot.resolve("apps/studio-web/dist")) {
        into("studio")
    }
    into(generatedStudioAssets)
}

tasks.named("preBuild").configure {
    dependsOn(syncStudioWeb)
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.0")
}
