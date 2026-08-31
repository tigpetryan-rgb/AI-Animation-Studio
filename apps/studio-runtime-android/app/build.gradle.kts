plugins {
    id("com.android.application")
}

val zeroSha = "0000000000000000000000000000000000000000"
val sha40 = Regex("^[0-9a-f]{40}$")
val studioCommitSha = providers.gradleProperty("studioCommitSha").orElse(zeroSha)
val studioSourceDate = providers.gradleProperty("studioSourceDate").orElse("1970-01-01T00:00:00.000Z")
val runtimeVersion = providers.gradleProperty("runtimeVersion").orElse("0.1.0-dev")
val generationApiBaseUrl = providers.gradleProperty("generationApiBaseUrl").orElse("").map { it.trim().trimEnd('/') }

if (!sha40.matches(studioCommitSha.get())) {
    throw GradleException("studioCommitSha must be a 40-character lowercase hexadecimal commit SHA.")
}

val generationApiBaseUrlValue = generationApiBaseUrl.get()
if (generationApiBaseUrlValue.isNotEmpty()) {
    val generationUri = try {
        java.net.URI(generationApiBaseUrlValue)
    } catch (error: java.net.URISyntaxException) {
        throw GradleException("generationApiBaseUrl must be a valid HTTPS URL.", error)
    }
    if (
        generationUri.scheme != "https"
        || generationUri.host.isNullOrBlank()
        || generationUri.userInfo != null
        || generationUri.query != null
        || generationUri.fragment != null
    ) {
        throw GradleException("generationApiBaseUrl must be an HTTPS origin/path without credentials, query, or fragment.")
    }
}

fun quotedBuildConfig(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val repoRoot = rootProject.projectDir.resolve("../..").canonicalFile
val generatedStudioAssets = layout.buildDirectory.dir("generated/studio-assets")

android {
    namespace = "com.aianimationstudio.runtime"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.aianimationstudio.runtime"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = runtimeVersion.get()

        buildConfigField("String", "STUDIO_REPOSITORY", quotedBuildConfig("tigpetryan-rgb/AI-Animation-Studio"))
        buildConfigField("String", "STUDIO_COMMIT_SHA", quotedBuildConfig(studioCommitSha.get()))
        buildConfigField("String", "STUDIO_SOURCE_DATE", quotedBuildConfig(studioSourceDate.get()))
        buildConfigField("String", "GENERATION_API_BASE_URL", quotedBuildConfig(generationApiBaseUrlValue))
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
