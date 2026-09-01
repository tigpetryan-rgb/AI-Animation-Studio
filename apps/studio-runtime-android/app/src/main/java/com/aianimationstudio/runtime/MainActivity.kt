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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeStudioApp() {
    val context = LocalContext.current
    val sourceStore = remember(context) { NativeSourceStore(context) }
    var projectName by rememberSaveable { mutableStateOf("Untitled project") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var pendingImportUri by remember { mutableStateOf<Uri?>(null) }
    var reference by remember { mutableStateOf<PersistedReferenceAsset?>(null) }
    var referenceError by remember { mutableStateOf<String?>(null) }
    var restoringReference by remember { mutableStateOf(true) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) {
            // Persistence of the provider URI is optional because production owns a private byte-for-byte copy.
        }
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
                pendingImportUri = null
            }
            .onFailure {
                referenceError = it.message ?: "Unable to persist the selected reference image."
                pendingImportUri = null
            }
    }

    val intakeReady = reference != null && prompt.isNotBlank() && !restoringReference

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
                    onValueChange = { projectName = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Project name") },
                    singleLine = true,
                )
            }

            StudioCard(title = "Reference image") {
                Button(onClick = { picker.launch(arrayOf("image/*")) }, enabled = pendingImportUri == null) {
                    Text(
                        when {
                            pendingImportUri != null -> "Importing exact bytes…"
                            reference == null -> "Choose image"
                            else -> "Replace image"
                        },
                    )
                }
                if (restoringReference) {
                    Text("Verifying persisted source bytes…")
                }
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

            StudioCard(title = "Animation prompt") {
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Describe the shot") },
                    minLines = 4,
                )
            }

            StudioCard(title = "Production") {
                Text(
                    if (intakeReady) "Native intake: READY" else "Native intake: waiting for verified reference + prompt",
                    fontWeight = FontWeight.SemiBold,
                )
                Text("UI runtime: NATIVE_COMPOSE")
                Text("WebView runtime: NOT USED")
                Text("Browser DOM/event state: NOT USED")
                Text("Source identity: APP_PRIVATE_SHA256")
                Spacer(Modifier.height(4.dp))
                Text(
                    "Native render/export port is not enabled yet. Export stays blocked until the source-bound renderer and native MP4 verification contract are wired end-to-end.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = {}, enabled = false) {
                    Text("Export MP4 · native engine pending")
                }
            }
        }
    }
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
