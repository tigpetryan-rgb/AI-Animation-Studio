package com.aianimationstudio.runtime

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
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

private data class ReferenceAsset(
    val uri: Uri,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val width: Int,
    val height: Int,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeStudioApp() {
    val context = LocalContext.current
    var projectName by rememberSaveable { mutableStateOf("Untitled project") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var referenceUriText by rememberSaveable { mutableStateOf<String?>(null) }
    var reference by remember { mutableStateOf<ReferenceAsset?>(null) }
    var referenceError by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) {
            // Some document providers do not grant persistence; the URI still works for this session.
        }
        referenceUriText = uri.toString()
    }

    LaunchedEffect(referenceUriText) {
        val uriText = referenceUriText
        if (uriText == null) {
            reference = null
            referenceError = null
            return@LaunchedEffect
        }
        runCatching { loadReferenceAsset(context, Uri.parse(uriText)) }
            .onSuccess {
                reference = it
                referenceError = null
            }
            .onFailure {
                reference = null
                referenceError = it.message ?: "Unable to read the selected reference image."
            }
    }

    val intakeReady = reference != null && prompt.isNotBlank()

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
                Button(onClick = { picker.launch(arrayOf("image/*")) }) {
                    Text(if (reference == null) "Choose image" else "Replace image")
                }
                reference?.let { asset ->
                    Text(asset.displayName, fontWeight = FontWeight.SemiBold)
                    Text("${asset.mimeType} · ${formatBytes(asset.sizeBytes)}")
                    Text("${asset.width} × ${asset.height} px")
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
                    if (intakeReady) "Native intake: READY" else "Native intake: waiting for reference + prompt",
                    fontWeight = FontWeight.SemiBold,
                )
                Text("UI runtime: NATIVE_COMPOSE")
                Text("WebView runtime: NOT USED")
                Text("Browser DOM/event state: NOT USED")
                Spacer(Modifier.height(4.dp))
                Text(
                    "Native render/export port is not enabled yet. Export stays blocked until the existing source-bound renderer and MP4 verification contract are ported and tested natively.",
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

private suspend fun loadReferenceAsset(context: android.content.Context, uri: Uri): ReferenceAsset =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var name = "reference-image"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        require(mime.startsWith("image/")) { "The selected file is not an image." }

        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: error("Unable to open the selected image.")
        require(options.outWidth > 0 && options.outHeight > 0) { "Unable to decode image dimensions." }

        ReferenceAsset(
            uri = uri,
            displayName = name,
            mimeType = mime,
            sizeBytes = size.coerceAtLeast(0L),
            width = options.outWidth,
            height = options.outHeight,
        )
    }

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1_048_576L -> String.format(Locale.ROOT, "%.1f MB", bytes / 1_048_576.0)
    bytes >= 1_024L -> String.format(Locale.ROOT, "%.1f KB", bytes / 1_024.0)
    else -> "$bytes B"
}
