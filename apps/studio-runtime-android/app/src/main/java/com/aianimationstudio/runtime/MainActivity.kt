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
import java.util.Locale

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
    val exportScope = rememberCoroutineScope()
    var projectName by rememberSaveable { mutableStateOf("Untitled project") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var pendingImportUri by remember { mutableStateOf<Uri?>(null) }
    var reference by remember { mutableStateOf<PersistedReferenceAsset?>(null) }
    var referenceError by remember { mutableStateOf<String?>(null) }
    var restoringReference by remember { mutableStateOf(true) }
    var productionSnapshot by remember { mutableStateOf<NativeProductionSnapshot?>(null) }
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
                pendingImportUri = null
            }
            .onFailure {
                referenceError = it.message ?: "Unable to persist the selected reference image."
                pendingImportUri = null
            }
    }

    LaunchedEffect(productionSnapshot) {
        exportResult = null
        val snapshot = productionSnapshot
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
                        Text("Native Android · Compose", style = MaterialTheme.typography.labelSmall)
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
                OutlinedTextField(
                    value = prompt,
                    onValueChange = {
                        prompt = it
                        productionSnapshot = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !exportRunning,
                    label = { Text("Deterministic shot script") },
                    minLines = 4,
                )
                Text(
                    "Current native semantic parser stays fail-closed. Example: ACTOR WAIT 2 seconds 320x240 12 fps.",
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
                        productionSnapshot = NativeProductionCoordinator.prepare(
                            chatId = projectName,
                            prompt = prompt,
                            reference = reference,
                            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
                        )
                    },
                    enabled = intakeReady && !exportRunning,
                ) {
                    Text("Prepare native production")
                }

                productionSnapshot?.let { snapshot ->
                    Text("Stage: ${snapshot.stage}", fontWeight = FontWeight.SemiBold)
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
        Text("Source ${BuildConfig.STUDIO_COMMIT_SHA.take(12)}")
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
