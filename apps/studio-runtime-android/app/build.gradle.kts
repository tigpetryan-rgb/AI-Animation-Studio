plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val zeroSha = "0000000000000000000000000000000000000000"
val sha40 = Regex("^[0-9a-f]{40}$")
val studioCommitSha = providers.gradleProperty("studioCommitSha").orElse(zeroSha)
val studioSourceDate = providers.gradleProperty("studioSourceDate").orElse("1970-01-01T00:00:00.000Z")
val runtimeVersion = providers.gradleProperty("runtimeVersion").orElse("0.2.0-native-dev")
val runtimeVersionCode = providers.gradleProperty("runtimeVersionCode").orElse("1").map { value ->
    value.toIntOrNull()?.takeIf { it > 0 }
        ?: throw GradleException("runtimeVersionCode must be a positive integer.")
}

if (!sha40.matches(studioCommitSha.get())) {
    throw GradleException("studioCommitSha must be a 40-character lowercase hexadecimal commit SHA.")
}

fun quotedBuildConfig(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// Historical filename retained only to preserve the stable CI/development update identity.
// It is not a production/public signing key and does not imply that M55/WebView is current.
val developmentUpdateKeystore = rootProject.file("keystore/m55-update-debug.jks")

android {
    namespace = "com.aianimationstudio.runtime"
    compileSdk = 36

    signingConfigs {
        getByName("debug") {
            storeFile = developmentUpdateKeystore
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
        buildConfigField("String", "STUDIO_RUNTIME_KIND", quotedBuildConfig("NATIVE_ANDROID_COMPOSE"))
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
            // Device-proof artifacts are production-like R8 builds. Final public signing is a
            // separate Phase 11 concern and must use a protected key outside this repository.
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    jvmToolchain(17)
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

    // In-app MP4 muxer supports the native H.264 + Opus MP4 production contract.
    implementation("androidx.media3:media3-muxer:1.11.0")

    testImplementation("junit:junit:4.13.2")
}
