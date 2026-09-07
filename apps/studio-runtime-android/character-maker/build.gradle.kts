plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val sourceSha = providers.gradleProperty("studioCommitSha").orElse("0000000000000000000000000000000000000000")
val sourceDate = providers.gradleProperty("studioSourceDate").orElse("1970-01-01T00:00:00Z")
val runtimeVersion = providers.gradleProperty("runtimeVersion").orElse("0.1.0-character-shell")
val runtimeVersionCode = providers.gradleProperty("runtimeVersionCode").orElse("1").map {
    it.toIntOrNull()?.takeIf { code -> code > 0 } ?: throw GradleException("runtimeVersionCode must be positive")
}
require(Regex("^[0-9a-f]{40}$").matches(sourceSha.get())) { "studioCommitSha must be a 40-character lowercase SHA" }
fun buildString(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    // Keep the engine namespace so its existing internal contracts and BuildConfig are reused.
    // The application ID is separate, so this APK does not replace the full Studio installation.
    namespace = "com.aianimationstudio.runtime"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.aianimationstudio.charactermaker"
        minSdk = 29
        targetSdk = 36
        versionCode = runtimeVersionCode.get()
        versionName = runtimeVersion.get()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "STUDIO_REPOSITORY", buildString("tigpetryan-rgb/AI-Animation-Studio"))
        buildConfigField("String", "STUDIO_COMMIT_SHA", buildString(sourceSha.get()))
        buildConfigField("String", "STUDIO_SOURCE_DATE", buildString(sourceDate.get()))
        buildConfigField("String", "STUDIO_RUNTIME_KIND", buildString("NATIVE_ANDROID_COMPOSE"))
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            // Development-only installable shell. Public release signing is a separate gate.
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "../app/proguard-rules.pro")
        }
    }
}

kotlin {
    jvmToolchain(17)
    sourceSets.getByName("main").kotlin.apply {
        // Reuse the M58 native engine without copying or changing its implementation.
        // Only the new launcher is reachable; release R8 removes unused production engines.
        srcDir("../app/src/main/java")
        exclude("**/MainActivity.kt")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.02.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    // Retained engine compilation dependency; the shell does not expose a media workflow.
    implementation("androidx.media3:media3-muxer:1.11.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
