package com.aianimationstudio.runtime

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

private enum class StudioScriptMode { NATURAL_LANGUAGE, DETERMINISTIC }

@UnstableApi
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    NativeStudioApp()
                }
            }
        }
    }
}

@UnstableApi
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeStudioApp() {
    val context = LocalContext.current
    val sourceStore = remember(context) { NativeSourceStore(context) }
    val scenePlanStore = remember(context) {
        NativeScenePlanStore(File(context.filesDir, "m57/compiled-scene-plan.bin"))
    }
    val exportScope = rememberCoroutineScope()
    var projectName by rememberSaveable { mutableStateOf("Untitled project") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var scriptMode by rememberSaveable { mutableStateOf(StudioScriptMode.NATURAL_LANGUAGE) }
    var pendingImportUri by remember { mutableStateOf<Uri?>(null) }
    var reference by remember { mutableStateOf<PersistedReferenceAsset?>(null) }
    var referenceError by remember { mutableStateOf<String?>(null) }
    var restoringReference by remember { mutableStateOf(true) }
    var productionSnapshot by remember { mutableStateOf<NativeProductionSnapshot?>(null) }
    var persistedPlanSha by remember { mutableStateOf<String?>(null) }
    var exportPreflight by remember { mutableStateOf<NativeExportReadinessResult?>(null) }
    var exportResult by remember { mutableStateOf<NativeExportPipelineResult?>(null) }
    var exportRunning by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) {
            // Persistence of the provider URI is optional because production owns a private byte-for-byte copy.
        }
        productionSnapshot = null
        persistedPlanSha = null
        pendingImportUri = uri
    }

    LaunchedEffect(Unit) {
        reference = withContext(Dispatchers.IO) { sourceStore.restoreVerified() }
        restoringReference = false
    }

    LaunchedEffect(pendingImportUri) {
        val uri = pendingImportUri ?: return@LaunchedEffect
        referenceError = null
        runCatching { withContext(Dispatchers.IO) { sourceStore.importFrom(uri) } }
            .onSuccess {
                reference = it
                productionSnapshot = null
                persistedPlanSha = null
                pendingImportUri = null
            }
            .onFailure {
                referenceError = it.message ?: "Unable to persist the selected reference image."
                pendingImportUri = null
            }
    }

    LaunchedEffect(reference?.sha256, prompt, scriptMode, restoringReference, pendingImportUri, productionSnapshot) {
        val exactReference = reference
        if (
            productionSnapshot == null &&
            scriptMode == StudioScriptMode.NATURAL_LANGUAGE &&
            exactReference != null &&
            prompt.isNotBlank() &&
            !restoringReference &&
            pendingImportUri == null
        ) {
            val persisted = withContext(Dispatchers.IO) {
                scenePlanStore.restoreVerified(
                    script = prompt,
                    referenceSha256 = exactReference.sha256,
                    sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
                )
            }
            if (persisted != null) {
                persistedPlanSha = persisted.payloadSha256
                productionSnapshot = withContext(Dispatchers.Default) {
                    NativeCompiledSceneRuntime.prepareVerified(
                        chatId = projectName,
                        prompt = prompt,
                        reference = exactReference,
                        sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
                        persisted = persisted,
                    )
                }
            }
        }
    }

    LaunchedEffect(productionSnapshot) {
        exportResult = null
        val snapshot = productionSnapshot
        if (
            snapshot != null &&
            snapshot.stage == NativeProductionStage.READY_FOR_RENDER &&
            snapshot.sceneSemanticStatus == NativeSceneSemanticStatus.VALID_EXECUTABLE &&
            snapshot.sceneIr != null &&
            snapshot.sceneTimeline != null
        ) {
            persistedPlanSha = runCatching {
                withContext(Dispatchers.IO) {
                    scenePlanStore.persist(snapshot.sceneIr, snapshot.sceneTimeline)
                }
            }.getOrNull()
        } else if (snapshot?.sceneSemanticStatus != null) {
            withContext(Dispatchers.IO) { scenePlanStore.clear() }
            persistedPlanSha = null
        }
        exportPreflight = if (snapshot == null) {
            null
        } else {
            withContext(Dispatchers.Default) { NativeExportReadiness.check(snapshot) }
        }
    }

    val intakeReady = reference != null && prompt.isNotBlank() && !restoringReference && pendingImportUri == null
    val exportReady = exportPreflight is NativeExportReadinessResult.Ready && pendingImportUri == null && !restoringReference

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("AI Animation Studio")
                        Text("Native Android · Compose · M57 Scene IR", style = MaterialTheme.typography.labelSmall)
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatusCard()

            StudioCard(title = "Project") {
                OutlinedTextField(
                    value = projectName,
                    onValueChange = {
                        projectName = it
                        productionSnapshot = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !exportRunning,
                    label = { Text("Project name") },
                    singleLine = true,
                )
            }

            StudioCard(title = "Reference image") {
                Button(onClick = { picker.launch(arrayOf("image/*")) }, enabled = pendingImportUri == null && !exportRunning) {
                    Text(
                        when {
                            pendingImportUri != null -> "Importing exact bytes…"
                            reference == null -> "Choose image"
                            else -> "Replace image"
                        },
                    )
                }
                if (restoringReference) Text("Verifying persisted source bytes…")
                reference?.let { asset ->
                    Text(asset.displayName, fontWeight = FontWeight.SemiBold)
                    Text("${asset.mimeType} · ${formatBytes(asset.sizeBytes)}")
                    Text("${asset.width} × ${asset.height} px")
                    Text("SHA-256 ${asset.sha256.take(16)}…", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "Lifecycle source continuity: VERIFIED · exact bytes in app-private storage",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                referenceError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }

            StudioCard(title = "Animation script") {
                Text("Mode: ${if (scriptMode == StudioScriptMode.NATURAL_LANGUAGE) "Natural Language" else "Deterministic"}", fontWeight = FontWeight.SemiBold)
                Button(
                    onClick = {
                        scriptMode = StudioScriptMode.NATURAL_LANGUAGE
                        productionSnapshot = null
                    },
                    enabled = scriptMode != StudioScriptMode.NATURAL_LANGUAGE && !exportRunning,
                ) { Text("Natural Language") }
                Button(
                    onClick = {
                        scriptMode = StudioScriptMode.DETERMINISTIC
                        productionSnapshot = null
                    },
                    enabled = scriptMode != StudioScriptMode.DETERMINISTIC && !exportRunning,
                ) { Text("Deterministic / regression") }
                OutlinedTextField(
                    value = prompt,
                    onValueChange = {
                        prompt = it
                        productionSnapshot = null
                        persistedPlanSha = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !exportRunning,
                    label = { Text(if (scriptMode == StudioScriptMode.NATURAL_LANGUAGE) "Natural-language scene" else "Deterministic shot script") },
                    minLines = 4,
                )
                Text(
                    if (scriptMode == StudioScriptMode.NATURAL_LANGUAGE) {
                        "Armenian/English/Russian Scene IR boundary is fail-closed. This APK includes a bounded offline supported-subset semantic probe for deterministic CI/device proof; broad language understanding must use the secure provider-neutral server/proxy model backend and never an API secret inside the APK. Example: Կերպարը հանգիստ սպասում է 24 վայրկյան։ Ելքը՝ 320×240, 12 կադր/վրկ։"
                    } else {
                        "Legacy deterministic regression path. Example: ACTOR WAIT 2 seconds 320x240 12 fps."
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            StudioCard(title = "Production") {
                Text(
                    if (intakeReady) "Native intake: READY" else "Native intake: waiting for verified reference + script",
                    fontWeight = FontWeight.SemiBold,
                )
                Button(
                    onClick = {
                        productionSnapshot = if (scriptMode == StudioScriptMode.NATURAL_LANGUAGE) {
                            NativeProductionCoordinator.prepareNaturalLanguage(
                                chatId = projectName,
                                prompt = prompt,
                                reference = reference,
                                sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
                                backend = NativeSupportedSubsetSemanticProbe,
                            )
                        } else {
                            NativeProductionCoordinator.prepare(
                                chatId = projectName,
                                prompt = prompt,
                                reference = reference,
                                sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
                            )
                        }
                    },
                    enabled = intakeReady && !exportRunning,
                ) {
                    Text(if (scriptMode == StudioScriptMode.NATURAL_LANGUAGE) "Compile Scene IR + prepare" else "Prepare deterministic production")
                }

                productionSnapshot?.let { snapshot ->
                    snapshot.sceneSemanticStatus?.let { status ->
                        Text("Semantic status: $status", fontWeight = FontWeight.SemiBold)
                    }
                    snapshot.sceneIr?.let { ir ->
                        Text("Language: ${ir.detectedLanguage} · Scene IR v${ir.schemaVersion}")
                        Text("Semantic provenance: ${ir.semanticProvider} / ${ir.semanticModel}", style = MaterialTheme.typography.bodySmall)
                        Text("Script SHA-256 ${ir.scriptSha256}", style = MaterialTheme.typography.bodySmall)
                        Text(
                            "Plan: ${ir.actions.joinToString(" → ") { action -> action.concept.name }} · ${ir.output.durationSeconds}s · ${ir.output.width}×${ir.output.height} · ${ir.output.frameRate} fps",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        ir.warnings.forEach { Text("Warning: $it", style = MaterialTheme.typography.bodySmall) }
                    }
                    snapshot.sceneTimeline?.let { timeline ->
                        Text(
                            "Timeline: ${timeline.shots.size} shot(s) · ${timeline.durationSeconds}s · source ${timeline.sourceCommit}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            "Timeline identity: script ${timeline.scriptSha256} · reference ${timeline.referenceSha256}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    persistedPlanSha?.let { sha ->
                        Text("Persisted compiled-plan SHA-256 $sha", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Stage: ${snapshot.stage}", fontWeight = FontWeight.SemiBold)
                    if (snapshot.sceneSemanticStatus != null) GateLine("Scene timeline", snapshot.sceneTimeline != null)
                    GateLine("Blocking", snapshot.blockingReady)
                    GateLine("Performance", snapshot.performanceReady)
                    GateLine("Camera visibility", snapshot.cameraReady)
                    GateLine("Render + codecs", exportReady)
                    snapshot.camera?.let {
                        Text(
                            "Camera: ${it.keyframes.size} keyframes · ${it.visibilitySamples.size} temporal frustum samples · exact source continuity",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    snapshot.diagnostics.forEach { item ->
                        Text(
                            "${item.code}: ${item.message}",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (snapshot.stage == NativeProductionStage.READY_FOR_RENDER) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                        )
                    }
                }

                when (val preflight = exportPreflight) {
                    null -> {
                        if (productionSnapshot?.stage == NativeProductionStage.READY_FOR_RENDER) {
                            Text("Checking exact-source temporal render and native H.264 + Opus codecs…", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    is NativeExportReadinessResult.Rejected -> preflight.diagnostics.forEach { diagnostic ->
                        Text(
                            "${diagnostic.code}: ${diagnostic.message}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    is NativeExportReadinessResult.Ready -> {
                        val artifact = preflight.artifact
                        Text(
                            "Render preflight PASS · ${artifact.renderArtifact.temporalEvidence.size} temporal samples · ${artifact.videoEncoderName} + ${artifact.audioEncoderName}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }

                Spacer(Modifier.height(4.dp))
                Text("UI runtime: NATIVE_COMPOSE")
                Text("WebView runtime: NOT USED")
                Text("Browser DOM/event state: NOT USED")
                Text("Scene model secret in APK: NOT ALLOWED")
                Text("Source identity: APP_PRIVATE_SHA256 + exact build SHA")
                Spacer(Modifier.height(4.dp))

                Button(
                    onClick = {
                        if (exportRunning) return@Button
                        val snapshot = productionSnapshot ?: return@Button
                        val displayStem = projectName
                        exportRunning = true
                        exportResult = null
                        exportScope.launch {
                            try {
                                val result = withContext(Dispatchers.IO) {
                                    NativeExportPipeline.export(
                                        context = context,
                                        snapshot = snapshot,
                                        displayStem = displayStem,
                                    )
                                }
                                exportResult = if (productionSnapshot == snapshot && projectName == displayStem) {
                                    result
                                } else {
                                    NativeExportPipelineResult.Rejected(
                                        listOf(
                                            NativeDiagnostic(
                                                "EXPORT_UI_IDENTITY_CHANGED",
                                                "Project or production identity changed while native export was running; the saved file is not admitted as the current MP4_READY result.",
                                            ),
                                        ),
                                    )
                                }
                            } finally {
                                exportRunning = false
                            }
                        }
                    },
                    enabled = exportReady && !exportRunning,
                ) {
                    Text(if (exportRunning) "Encoding + verifying H.264 + Opus…" else "Export H.264 + Opus MP4")
                }

                when (val result = exportResult) {
                    null -> Text(
                        "MP4_READY requires durable MediaStore save, saved SHA-256, H.264/Opus track inspection, first-frame decode and full-stream native verification.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    is NativeExportPipelineResult.Rejected -> result.diagnostics.forEach { diagnostic ->
                        Text(
                            "${diagnostic.code}: ${diagnostic.message}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    is NativeExportPipelineResult.Ready -> {
                        val artifact = result.artifact
                        Text("MP4_READY · native save and verification PASS", fontWeight = FontWeight.SemiBold)
                        Text("${artifact.width} × ${artifact.height} · ${artifact.durationMs} ms · ${formatBytes(artifact.sizeBytes)}")
                        Text("${artifact.videoMimeType} + ${artifact.audioMimeType} · ${artifact.videoSampleCount} video / ${artifact.audioSampleCount} audio samples")
                        Text("SHA-256 ${artifact.sha256}")
                        Text("Saved ${artifact.uri}", style = MaterialTheme.typography.bodySmall)
                        Text(
                            "First-frame decode: ${if (artifact.firstVideoFrameDecoded) "PASS" else "FAIL"} · full-stream deterministic decode: ${if (artifact.deterministicPlaybackVerified) "PASS" else "FAIL"}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text("Source ${artifact.sourceCommit} · reference ${artifact.referenceSha256}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun GateLine(label: String, passed: Boolean) {
    Text("${if (passed) "✓" else "○"} $label: ${if (passed) "PASS" else "PENDING"}")
}

@Composable
private fun StatusCard() {
    StudioCard(title = "Runtime identity") {
        val device = listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .ifBlank { "Android device" }
        Text(device, fontWeight = FontWeight.SemiBold)
        Text("Android ${Build.VERSION.RELEASE} · API ${Build.VERSION.SDK_INT}")
        Text("Source SHA ${BuildConfig.STUDIO_COMMIT_SHA}", style = MaterialTheme.typography.bodySmall)
        Text("Runtime ${BuildConfig.STUDIO_RUNTIME_KIND}")
    }
}

@Composable
private fun StudioCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                content()
            },
        )
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1_048_576L -> String.format(Locale.ROOT, "%.1f MB", bytes / 1_048_576.0)
    bytes >= 1_024L -> String.format(Locale.ROOT, "%.1f KB", bytes / 1_024.0)
    else -> "$bytes B"
}
